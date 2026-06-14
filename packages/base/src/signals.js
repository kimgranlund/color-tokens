/**
 * Signals core (CR-BASE-001 §2): two-way-linked dependency edges with version
 * counters and per-run stale-edge cleanup (§2.2); eager-mark / lazy-compute
 * notification (§2.3); lazy, equality-gated, disposable, exception-caching
 * computeds (§2.4); glitch-freedom via pull-based computeds plus
 * validate-before-run (§2.5); microtask / rAF / idle schedulers with the
 * cross-scheduler consistency model (§2.6).
 *
 * The ONLY module that changes if TC39 `Signal.State` ships (D-2). Host
 * scheduling primitives are resolved from `globalThis` AT CALL TIME so test
 * stubs work (note, budget header).
 */

// ── internal graph ──────────────────────────────────────────────────────────

const KIND_COMPUTED = 1
const STALE = 1 //    computed: possibly-stale mark (§2.3)
const ERRORED = 2 //  computed: settled state is a cached exception (§2.4)
const NEVER = 4 //    computed never settled / effect never ran
const DISPOSED = 8
const RUNNING = 16 // computed recompute in progress (cycle guard, see settleComputed)

let runIdCounter = 0
/** @type {Node | null} the consumer currently running (dependency capture) */
let activeConsumer = null

const DEV = () => /** @type {any} */ (globalThis).__BASE_DEV__ === true

/**
 * One dependency edge, shared by the source's subscriber list and the
 * consumer's dependency list (§2.2 two-way link → O(1) unlink from either
 * side). `version` = source version the consumer last observed; `runId` =
 * consumer run that last stamped the edge.
 */
class Edge {
  /** @param {Node} source @param {Node} consumer */
  constructor(source, consumer) {
    this.source = source
    this.consumer = consumer
    this.version = -1
    this.runId = 0
    /** @type {Edge | null} */ this.prevSub = null
    /** @type {Edge | null} */ this.nextSub = null
    /** @type {Edge | null} */ this.prevDep = null
    /** @type {Edge | null} */ this.nextDep = null
  }
}

/** Internal node: signal (source), computed (source + consumer) or effect (consumer). */
class Node {
  /** @param {0 | 1 | 2} kind */
  constructor(kind) {
    this.kind = kind
    this.version = 0 // bumped on accepted write / value-changing recompute (§2.2)
    this.flags = 0
    this.runId = 0
    /** @type {Edge | null} */ this.subsHead = null
    /** @type {Edge | null} */ this.subsTail = null
    /** @type {Edge | null} */ this.depsHead = null
    /** @type {Edge | null} */ this.depsTail = null
    /** @type {any} */ this.value = undefined
    /** @type {any} */ this.error = undefined
    /** @type {(() => any) | null} */ this.fn = null
    /** @type {((e: unknown) => void) | null} */ this.onError = null
    this.label = 'effect'
    /** @type {((n: Node) => void) | null} */ this.schedule = null
  }
}

/**
 * Record the edge `src → activeConsumer` (§2.2): reuse an existing edge
 * (restamping run id + last-observed version — one edge per source), else
 * append a new one to both lists. A DISPOSED consumer never gains edges —
 * reads after self-dispose within the consumer's own run must not re-link
 * (§2.2 "disposing unlinks all edges synchronously and permanently"; F4).
 * @param {Node} src
 */
function track(src) {
  const c = activeConsumer
  if (c === null || c.flags & DISPOSED) return
  for (let e = c.depsHead; e !== null; e = e.nextDep) {
    if (e.source === src) { e.runId = c.runId; e.version = src.version; return }
  }
  const e = new Edge(src, c)
  e.runId = c.runId; e.version = src.version
  e.prevDep = c.depsTail
  if (c.depsTail) c.depsTail.nextDep = e; else c.depsHead = e
  c.depsTail = e
  e.prevSub = src.subsTail
  if (src.subsTail) src.subsTail.nextSub = e; else src.subsHead = e
  src.subsTail = e
}

/** Unlink an edge from both lists in O(1) (§2.2). @param {Edge} e */
function unlink(e) {
  const s = e.source, c = e.consumer
  if (e.prevSub) e.prevSub.nextSub = e.nextSub; else s.subsHead = e.nextSub
  if (e.nextSub) e.nextSub.prevSub = e.prevSub; else s.subsTail = e.prevSub
  if (e.prevDep) e.prevDep.nextDep = e.nextDep; else c.depsHead = e.nextDep
  if (e.nextDep) e.nextDep.prevDep = e.prevDep; else c.depsTail = e.prevDep
}

/**
 * Run-completion cleanup (§2.2): unlink every dep edge of `c` not stamped
 * with the current run id — the dep set becomes exactly the sources read.
 * @param {Node} c @param {boolean} all — true unlinks everything (disposal)
 */
function pruneDeps(c, all) {
  let e = c.depsHead
  while (e !== null) { const next = e.nextDep; if (all || e.runId !== c.runId) unlink(e); e = next }
}

/** Synchronous disposal; a computed also drops its subscriber edges (§2.2 "all of its edges"). @param {Node} n */
function disposeNode(n) {
  if (n.flags & DISPOSED) return
  n.flags |= DISPOSED
  pruneDeps(n, true)
  let e = n.subsHead
  while (e !== null) { const next = e.nextSub; unlink(e); e = next }
}

/**
 * Eager mark, lazy compute (§2.3): walk subscriber edges WITHOUT recomputing.
 * Computeds are marked possibly-stale (a marked computed propagates the mark
 * exactly once, until it next settles); effects join their scheduler's dedupe
 * set (already-queued → Set no-op).
 * @param {Node} src
 */
function notifySubs(src) {
  for (let e = src.subsHead; e !== null; e = e.nextSub) {
    const c = e.consumer
    if (c.flags & DISPOSED) continue
    if (c.kind === KIND_COMPUTED) {
      if (!(c.flags & STALE)) { c.flags |= STALE; notifySubs(c) }
    } else if (c.schedule) c.schedule(c)
  }
}

/**
 * True iff any dependency's version advanced past the edge's record —
 * computed deps are settled (recursively) first (§2.4 / §2.5).
 * @param {Node} c
 */
function validate(c) {
  for (let e = c.depsHead; e !== null; e = e.nextDep) {
    const s = e.source
    if (s.kind === KIND_COMPUTED) settleComputed(s)
    if (s.version !== e.version) return true
  }
  return false
}

/**
 * Settle a computed (§2.4): validate-then-recompute; never throws (exceptions
 * become the cached settled state). RUNNING: §2.4 is silent on cycles — a
 * computed read during its own recompute observes the previous settled state
 * (minimal, non-exploding choice).
 * @param {Node} c
 */
function settleComputed(c) {
  if (c.flags & (DISPOSED | RUNNING)) return
  if (c.flags & NEVER) recompute(c)
  else if (c.flags & STALE) {
    if (validate(c)) recompute(c)
    else c.flags &= ~STALE // no dep advanced: keep cache, clear mark, no bump
  }
}

/** Recompute under tracking (per-run cleanup applies); cache value or exception; equality-gate the version bump (§2.4). @param {Node} c */
function recompute(c) {
  const prev = activeConsumer
  activeConsumer = c
  c.runId = ++runIdCounter
  c.flags |= RUNNING
  let value, err, threw = false
  try { value = /** @type {() => any} */ (c.fn)() }
  catch (ex) { threw = true; err = ex }
  // end-of-run prune drops ALL edges when the node finished its run already DISPOSED (F4, §2.2)
  finally { activeConsumer = prev; c.flags &= ~RUNNING; pruneDeps(c, (c.flags & DISPOSED) !== 0) }
  const wasNeverOrErrored = (c.flags & (NEVER | ERRORED)) !== 0
  c.flags &= ~(STALE | NEVER)
  if (threw) {
    // an error is always a change; errors never compare equal (§2.4)
    c.error = err; c.flags |= ERRORED; c.version++
  } else if (wasNeverOrErrored || !Object.is(c.value, value)) {
    c.value = value; c.error = undefined; c.flags &= ~ERRORED; c.version++
  }
  // else: Object.is-equal recompute — keep cache, do NOT bump version (B10)
}

/** Validate-and-run one queued effect; disposed entries are skipped; a never-run effect always runs (§2.5). @param {Node} n */
function runEffect(n) {
  if (n.flags & DISPOSED) return
  if (!(n.flags & NEVER) && !validate(n)) return // validate-before-run skip
  runEffectNow(n, false)
}

/** @param {Node} n @param {boolean} sync — true only for `effect()`'s synchronous first run */
function runEffectNow(n, sync) {
  n.flags &= ~NEVER
  const prev = activeConsumer
  activeConsumer = n
  n.runId = ++runIdCounter
  try {
    ;/** @type {() => any} */ (n.fn)()
  } catch (ex) {
    if (n.onError) {
      n.onError(ex) // effect stays live; deps read before the throw stay tracked (§2.6)
    } else {
      disposeNode(n)
      if (sync) throw ex // sync first run throws to the caller (§2.6)
      globalThis.queueMicrotask(() => { throw ex }) // uncaught async error (reference behavior)
    }
  } finally {
    activeConsumer = prev
    // a run that ended DISPOSED (self-dispose or error-dispose) drops ALL edges,
    // including any stamped with the current run id before the dispose (F4, §2.2)
    pruneDeps(n, (n.flags & DISPOSED) !== 0)
  }
}

// ── schedulers (§2.6) ───────────────────────────────────────────────────────

/** @type {Set<Node>} */ const microQueue = new Set()
let microDraining = false, batchDepth = 0

/** @param {Node} n */
function scheduleMicro(n) {
  if (!microDraining && microQueue.size === 0) globalThis.queueMicrotask(drainMicro)
  microQueue.add(n)
}

/**
 * Microtask drain (§2.6): loop — snapshot + clear, validate-and-run; effects
 * scheduled during runs join the next iteration. Bounded by the 100-iteration
 * drain guard (Δ10): abort, console.error (culprit labels in dev mode),
 * pending cleared. A drain that finds an empty queue is a no-op.
 */
function drainMicro() {
  if (microDraining) return
  microDraining = true
  try {
    let loops = 0
    while (microQueue.size > 0) {
      if (++loops > 100) {
        const labels = DEV() ? `; pending: ${[...microQueue].map((n) => n.label).join(', ')}` : ''
        microQueue.clear()
        console.error(`base: effect drain exceeded 100 iterations — pending cleared${labels}`)
        break
      }
      const queue = [...microQueue]
      microQueue.clear()
      for (const n of queue) runEffect(n)
    }
  } finally { microDraining = false }
}

/**
 * Deferred-scheduler factory — rAF and idle drains have the identical §2.6
 * shape but each owns its OWN dedupe set and drain: (1) synchronously drain
 * the microtask queue first, so deferred effects observe only post-flush,
 * settled state; (2) snapshot + clear, validate-and-run. The armed flag drops
 * BEFORE running, so a write during a deferred effect lands in the new queue
 * with a fresh host callback — the NEXT frame/idle, never re-entering the
 * current one. Relative order of the rAF and idle queues is unspecified.
 * @param {(cb: () => void) => void} prim — host primitive, resolved at call time
 * @returns {(n: Node) => void}
 */
function deferredScheduler(prim) {
  /** @type {Set<Node>} */ const queue = new Set()
  let armed = false
  function drain() {
    armed = false
    drainMicro()
    const snap = [...queue]
    queue.clear()
    for (const n of snap) runEffect(n)
  }
  return (n) => {
    queue.add(n)
    if (!armed) { armed = true; prim(drain) }
  }
}

const scheduleRaf = deferredScheduler((cb) => {
  const g = /** @type {any} */ (globalThis)
  typeof g.requestAnimationFrame === 'function' ? g.requestAnimationFrame(cb) : setTimeout(cb, 16)
})

// idle host primitive (§2.6): requestIdleCallback when present, else setTimeout 0 (Safari, happy-dom, node).
// timeout: 200 is load-bearing — rIC is tied to the frame scheduler, and on a
// fully quiescent page (zero rAF re-arms) headless Chromium produces no frames
// and therefore NO idle callbacks, starving idle effects forever (measured
// during M5 integration: a static studio page never fired rIC in >1s). The
// timeout forces delivery as a regular task; effects stay deferred+coalesced.
const scheduleIdle = deferredScheduler((cb) => {
  const g = /** @type {any} */ (globalThis)
  typeof g.requestIdleCallback === 'function'
    ? g.requestIdleCallback(cb, { timeout: 200 })
    : setTimeout(cb, 0)
})

// ── public API (§2.1) ───────────────────────────────────────────────────────

const BRAND = Symbol('base.signal')

/** @template T @typedef {{ value: T, peek(): T }} Signal */
/** @template T @typedef {{ readonly value: T, peek(): T, dispose(): void }} Computed */
/** @typedef {{ onError?: (e: unknown) => void, label?: string }} EffectOptions */

/**
 * A writable reactive value: read `.value` to subscribe (track + read), write
 * it to notify (`Object.is`-gated); `peek()` reads without subscribing.
 * @template T @param {T} v @returns {Signal<T>}
 */
export function signal(v) {
  const n = new Node(0)
  n.value = v
  return /** @type {Signal<T>} */ (/** @type {unknown} */ ({
    [BRAND]: n,
    get value() { track(n); return n.value },
    set value(next) {
      if (Object.is(n.value, next)) return
      n.value = next
      n.version++ // accepted write (§2.2)
      notifySubs(n)
    },
    peek() { return n.value },
  }))
}

/**
 * A lazy, equality-gated, disposable, exception-caching derived value (§2.4).
 * `peek()` settles (never returns a stale cache, rethrows a cached exception)
 * but does not subscribe the reader (Δ2). `dispose()` freezes the computed at
 * its last settled state — no tracking in either direction afterwards.
 * @template T @param {() => T} fn @returns {Computed<T>}
 */
export function computed(fn) {
  const n = new Node(KIND_COMPUTED)
  n.fn = fn
  n.flags = NEVER
  /** @param {boolean} sub */
  const read = (sub) => {
    settleComputed(n)
    if (sub && !(n.flags & DISPOSED)) track(n)
    if (n.flags & ERRORED) throw n.error
    return n.value
  }
  return /** @type {Computed<T>} */ (/** @type {unknown} */ ({
    [BRAND]: n,
    get value() { return read(true) },
    peek() { return read(false) },
    dispose() { disposeNode(n) },
  }))
}

/** @param {() => void} fn @param {EffectOptions | undefined} opts @param {(n: Node) => void} schedule */
function makeEffect(fn, opts, schedule) {
  const n = new Node(2)
  n.fn = fn
  n.flags = NEVER
  n.onError = opts?.onError ?? null
  n.label = opts?.label ?? 'effect'
  n.schedule = schedule
  return n
}

/**
 * Run `fn` now (synchronous first run, §2.6) and re-run it on the next
 * microtask whenever a dependency changes. Disposal is synchronous and
 * cancels any scheduled run.
 * @param {() => void} fn @param {EffectOptions} [opts] @returns {() => void} disposer
 */
export function effect(fn, opts) {
  const n = makeEffect(fn, opts, scheduleMicro)
  runEffectNow(n, true)
  return () => disposeNode(n)
}

/**
 * Frame-coalesced effect (§2.6): first run on the NEXT animation frame; N
 * writes/frame → 1 run (B5). Disposing before the first run means `fn` never executes.
 * @param {() => void} fn @param {EffectOptions} [opts] @returns {() => void} disposer
 */
export function effectRaf(fn, opts) {
  const n = makeEffect(fn, opts, scheduleRaf)
  scheduleRaf(n)
  return () => disposeNode(n)
}

/**
 * Idle-coalesced effect (§2.6): first run on the next idle callback.
 * @param {() => void} fn @param {EffectOptions} [opts] @returns {() => void} disposer
 */
export function effectIdle(fn, opts) {
  const n = makeEffect(fn, opts, scheduleIdle)
  scheduleIdle(n)
  return () => disposeNode(n)
}

/**
 * Coalesce writes: at the close of the OUTERMOST batch the microtask queue is
 * drained synchronously — callers observe effect results right after `batch()`
 * returns (B6). rAF/idle queues stay on their own timers. Nested batches are
 * inert pass-throughs.
 * @template T @param {() => T} fn @returns {T}
 */
export function batch(fn) {
  if (batchDepth > 0) return fn()
  batchDepth++
  try { return fn() } finally { batchDepth--; drainMicro() }
}

/**
 * Run `fn` with dependency capture suspended — reads create no subscriptions (§2.6).
 * @template T @param {() => T} fn @returns {T}
 */
export function untracked(fn) {
  const prev = activeConsumer
  activeConsumer = null
  try { return fn() } finally { activeConsumer = prev }
}

/** True for `signal()` and `computed()` instances (shared brand symbol). @param {unknown} v @returns {boolean} */
export function isSignal(v) {
  return v !== null && typeof v === 'object' && /** @type {any} */ (v)[BRAND] instanceof Node
}

/**
 * Number of live direct subscriber edges (effects + computeds) — O(edges),
 * zero bookkeeping when unused; works regardless of dev mode (B2).
 * @param {Signal<any> | Computed<any>} sig @returns {number}
 */
export function subscriberCount(sig) {
  const n = /** @type {any} */ (sig)[BRAND]
  if (!(n instanceof Node)) throw new TypeError('base: subscriberCount expects a signal or computed')
  let count = 0
  for (let e = n.subsHead; e !== null; e = e.nextSub) count++
  return count
}
