/**
 * UIElement — reactive light-DOM custom-element base (CR-BASE-001 §4):
 * parser registry (§4.1), upgrade dance (§4.2), reflect re-entry guards
 * (§4.3), render-once template + per-class adopted styles (§4.4), auto-
 * disposed bindings incl. keyed `bindList` (§4.5) with R-12 error containment
 * (a throwing callback disposes that one binding; `opts.onError` observes,
 * else one console.error — never silent), events/composition/context (§4.6),
 * and the connect/disconnect lifecycle (§4.7).
 */

import { signal, effect, effectRaf, effectIdle, untracked } from './signals.js'

const DEV = () => /** @type {any} */ (globalThis).__BASE_DEV__ === true

// ── parser registry (§4.1) ──────────────────────────────────────────────────

/**
 * @typedef {object} Parser
 * @property {(v: string | null) => any} parse - `parse(null)` is invoked only on attribute REMOVAL, never to initialize
 * @property {(v: any) => string | null} [reflect] - a `null` return always removes the attribute
 * @property {any} [default] - seeds the property's initial value
 */

/**
 * Parse-time context for the B7 dev warning (which names tag, attribute, raw
 * value). The Parser shape is frozen at one argument (§4.1), so the element
 * layer publishes the context here around ACC parses — note-silent mechanism,
 * minimal choice that keeps custom parsers plug-in-by-shape.
 * @type {{ tag: string, attr: string } | null}
 */
let parseCtx = null

/** Invalid attribute → default + console.warn in dev (B7). @param {string | null} v */
function warnInvalid(v) {
  if (DEV()) console.warn(`base: <${parseCtx?.tag ?? '?'}> invalid value ${JSON.stringify(v)} for attribute "${parseCtx?.attr ?? '?'}" — using default`)
}

/** String parser: removal → default. @param {string} [def] @returns {Parser} */
export const asString = (def = '') => ({
  parse: (v) => (v === null ? def : v),
  reflect: (v) => String(v),
  default: def,
})

/** Number parser: invalid (null, blank after trim, or NaN) → default. @param {number} def @returns {Parser} */
export const asNumber = (def) => ({
  /** @param {string | null} v */
  parse: (v) => (v === null ? def : v.trim() === '' || Number.isNaN(Number(v)) ? (warnInvalid(v), def) : Number(v)),
  reflect: (v) => String(v),
  default: def,
})

/** Integer parser: `asNumber`'s validity rule, then `Math.trunc`. @param {number} def @returns {Parser} */
export const asInteger = (def) => {
  const num = asNumber(def)
  return { parse: (v) => Math.trunc(num.parse(v)), reflect: (v) => String(v), default: def }
}

/** Boolean parser: presence semantics — `def` seeds the property's INITIAL value only. @param {boolean} [def] @returns {Parser} */
export const asBoolean = (def = false) => ({
  parse: (v) => v !== null,
  reflect: (v) => (v ? '' : null),
  default: def,
})

/** Enum parser: member of `values` or → default. @param {readonly string[]} values @param {string} [def] @returns {Parser} */
export const asEnum = (values, def = values[0]) => ({
  /** @param {string | null} v */
  parse: (v) => (v !== null && values.includes(v) ? v : (v !== null && warnInvalid(v), def)),
  reflect: (v) => String(v),
  default: def,
})

/** JSON parser: removal or syntax error → default; `JSON.stringify(undefined)` reflects as removal. @param {any} def @returns {Parser} */
export const asJSON = (def) => ({
  /** @param {string | null} v */
  parse: (v) => { if (v === null) return def; try { return JSON.parse(v) } catch { warnInvalid(v); return def } },
  reflect: (v) => JSON.stringify(v) ?? null,
  default: def,
})

// ── per-class maps + per-instance state (§4.1) ──────────────────────────────

/**
 * @typedef {object} PropConfig
 * @property {Parser} [parse]
 * @property {boolean} [reflect]
 * @property {string} [attribute] - defaults to the property name lowercased
 */
/**
 * @typedef {object} PropEntry
 * @property {string} key
 * @property {string} attr
 * @property {Parser} parser
 * @property {boolean} reflect
 */
/** @typedef {import('./signals.js').Signal<any>} AnySignal */
/**
 * @typedef {object} Inst
 * @property {Map<string, AnySignal>} sigs - each property IS a signal (§4.1)
 * @property {Set<string>} pending - pending-reflect prop keys (§4.2)
 * @property {string | null} reflecting - prop→attr re-entry guard (§4.3)
 * @property {string | null} applying - attr→prop re-entry guard (§4.3)
 * @property {Array<() => void>} scope - element disposal scope (§4.5.1)
 * @property {boolean} ready - first-connect work done (§4.4 `#initialized`)
 */

const MAPS = Symbol('base.maps')

/** Per-instance state (conceptually the note's `#`-fields; a WeakMap lets the prototype accessors built in classMaps reach it). @type {WeakMap<UIElement, Inst>} */
const INST = new WeakMap()

/** @param {UIElement} el @returns {Inst} */
const inst = (el) => /** @type {Inst} */ (INST.get(el))

/** Module-level current-disposal-scope pointer (§4.5.1). @type {Array<() => void> | null} */
let currentScope = null

/**
 * Build the attr↔prop maps + prototype accessors ONCE per class — own-key
 * check so subclasses build their own (§4.1); runs on the first of
 * {first construction, `observedAttributes` read}.
 * @param {typeof UIElement} ctor
 * @returns {{ byProp: Map<string, PropEntry>, byAttr: Map<string, PropEntry> }}
 */
function classMaps(ctor) {
  const c = /** @type {any} */ (ctor)
  if (!Object.hasOwn(c, MAPS)) {
    /** @type {Map<string, PropEntry>} */ const byProp = new Map()
    /** @type {Map<string, PropEntry>} */ const byAttr = new Map()
    for (const [key, cfg] of Object.entries(ctor.properties)) {
      /** @type {PropEntry} */
      const entry = {
        key,
        attr: cfg.attribute ?? key.toLowerCase(),
        // note-silent: missing `parse` falls back to asString('') (reference String-type continuity)
        parser: cfg.parse ?? asString(),
        reflect: cfg.reflect === true,
      }
      byProp.set(key, entry)
      byAttr.set(entry.attr, entry)
      Object.defineProperty(ctor.prototype, key, {
        /** @this {UIElement} */
        get() { return /** @type {AnySignal} */ (inst(this).sigs.get(key)).value },
        /** @this {UIElement} @param {any} v */
        set(v) { setProp(this, entry, v) },
        configurable: true,
      })
    }
    c[MAPS] = { byProp, byAttr }
  }
  return c[MAPS]
}

/** Property setter path (§4.1–§4.3). @param {UIElement} el @param {PropEntry} entry @param {any} v */
function setProp(el, entry, v) {
  const i = inst(el)
  const sig = /** @type {AnySignal} */ (i.sigs.get(entry.key))
  if (Object.is(sig.peek(), v)) return
  sig.value = v
  // attr→prop guard: a normalizing parser must not re-write the attribute (§4.3)
  if (!entry.reflect || i.applying === entry.attr) return
  if (i.ready) reflectNow(el, entry, v)
  else i.pending.add(entry.key) // before first connect: pending-reflect set (§4.2)
}

/** Write (or remove) the attribute with the prop→attr guard up — the ACC echo is inert (§4.3). @param {UIElement} el @param {PropEntry} entry @param {any} v */
function reflectNow(el, entry, v) {
  const out = entry.parser.reflect ? entry.parser.reflect(v) : v == null ? null : String(v)
  const i = inst(el)
  i.reflecting = entry.attr
  try {
    if (out === null) el.removeAttribute(entry.attr)
    else el.setAttribute(entry.attr, out)
  } finally { i.reflecting = null }
}

/** @type {WeakSet<Function>} adopted-styles bookkeeping (§4.4) */
const adopted = new WeakSet()

/** Adopt `static styles` once per class at document level, deduplicated (§4.4, D-8). @param {typeof UIElement} ctor */
function adoptStyles(ctor) {
  if (adopted.has(ctor)) return
  adopted.add(ctor)
  const styles = ctor.styles
  if (!styles) return
  const list = Array.isArray(styles) ? styles : [styles]
  const have = document.adoptedStyleSheets
  document.adoptedStyleSheets = [...have, ...list.filter((s) => !have.includes(s))]
}

/**
 * Answer one-shot `context-request` events (WCCG protocol, §4.6/Δ9) for `key`
 * on `el`: `e.stopPropagation()` + `e.callback(valueFn())`. Keys compare by
 * identity; no subscriptions — reactivity comes from reading the provided
 * signal/store inside effects. Returns an unlisten disposer (note-silent; minimal).
 * @param {EventTarget} el @param {unknown} key @param {() => any} valueFn
 * @returns {() => void}
 */
export function provideContext(el, key, valueFn) {
  /** @param {any} e */
  const handler = (e) => {
    if (e.context === key) { e.stopPropagation(); e.callback(valueFn()) }
  }
  el.addEventListener('context-request', handler)
  return () => el.removeEventListener('context-request', handler)
}

// ── UIElement (§4) ──────────────────────────────────────────────────────────

export class UIElement extends HTMLElement {
  /** Reactive property declarations (§4.1). @type {Record<string, PropConfig>} */
  static properties = {}
  /** Render-once scaffold: evaluated on FIRST connect only, untracked (§4.4, D-9). @type {((el: any) => unknown) | null} */
  static template = null
  /** One sheet or an array, adopted once per class (§4.4). @type {CSSStyleSheet | CSSStyleSheet[] | null} */
  static styles = null

  static get observedAttributes() {
    return [...classMaps(this).byAttr.keys()]
  }

  /** @type {ElementInternals} */
  #internals

  constructor() {
    super()
    const ctor = /** @type {typeof UIElement} */ (this.constructor)
    const maps = classMaps(ctor) // build once per class (§4.1)
    // Once, in the constructor (Δ6) — native path primary. F1: feature-guard for
    // hosts without ElementInternals (happy-dom 20): fall back to an inert
    // Set-like `states` so bindState wiring still works (no-op styling); real
    // `:state()` verification is the Playwright tier (D-19).
    this.#internals = typeof this.attachInternals === 'function'
      ? this.attachInternals()
      : /** @type {ElementInternals} */ (/** @type {unknown} */ ({ states: new Set() }))
    /** @type {Inst} */
    const i = { sigs: new Map(), pending: new Set(), reflecting: null, applying: null, scope: [], ready: false }
    INST.set(this, i)
    // Upgrade dance (§4.2): capture pre-upgrade own values + unshadow the
    // prototype accessors; install the per-instance signals; re-apply each
    // captured value through the setter in declaration order — reflection
    // suppressed (i.ready=false routes it into the pending-reflect set,
    // because a constructor must not add attributes).
    /** @type {Array<[string, any]>} */
    const captured = []
    for (const key of maps.byProp.keys()) {
      if (Object.hasOwn(this, key)) {
        captured.push([key, /** @type {any} */ (this)[key]])
        delete (/** @type {any} */ (this)[key])
      }
    }
    for (const entry of maps.byProp.values()) i.sigs.set(entry.key, signal(entry.parser.default))
    for (const [key, v] of captured) /** @type {any} */ (this)[key] = v
  }

  connectedCallback() {
    const ctor = /** @type {typeof UIElement} */ (this.constructor)
    const i = inst(this)
    if (!i.ready) {
      // first-connect order (§4.4): adopt styles → class map → drain pending reflects → template → connected()
      adoptStyles(ctor)
      const maps = classMaps(ctor)
      for (const key of i.pending) reflectNow(this, /** @type {PropEntry} */ (maps.byProp.get(key)), /** @type {AnySignal} */ (i.sigs.get(key)).peek())
      i.pending.clear()
      const t = ctor.template
      if (typeof t === 'function') {
        const result = untracked(() => t(this)) // a scaffold, not a render loop
        if (typeof result === 'string') this.innerHTML = result
      }
      i.ready = true // the scaffold persists across reparenting (§4.4)
    }
    // every connect: push the element scope; setup runs untracked (§4.7)
    const prev = currentScope
    currentScope = i.scope
    try { untracked(() => this.connected()) } finally { currentScope = prev }
  }

  disconnectedCallback() {
    const i = inst(this)
    const scope = i.scope
    i.scope = []
    for (const d of scope) d() // dispose ALL effects/listeners/bindings (§4.7, B2)
    this.disconnected()
  }

  /** @param {string} name @param {string | null} _old @param {string | null} val */
  attributeChangedCallback(name, _old, val) {
    const i = INST.get(this)
    if (!i || i.reflecting === name) return // our own reflect echo is inert (§4.3)
    const entry = classMaps(/** @type {typeof UIElement} */ (this.constructor)).byAttr.get(name)
    if (!entry) return
    i.applying = name
    parseCtx = { tag: this.localName, attr: name }
    try {
      ;/** @type {any} */ (this)[entry.key] = entry.parser.parse(val)
    } finally { i.applying = null; parseCtx = null }
  }

  /** Create an instance of this element with properties applied (§4.4, reference continuity). @param {Record<string, any>} [props] */
  static create(props = {}) {
    const tag = customElements.getName(/** @type {CustomElementConstructor} */ (/** @type {unknown} */ (this)))
    if (!tag) throw new Error('base: component is not registered')
    const el = document.createElement(tag)
    for (const [k, v] of Object.entries(props)) /** @type {any} */ (el)[k] = v
    return el
  }

  // ── bindings (§4.5): each one an auto-disposed effect touching one node ──

  /** Register a disposer into the current scope — a bindList item's scope during `create()`, else this element's (§4.5.1). @param {() => void} d */
  #register(d) {
    ;(currentScope ?? inst(this).scope).push(d)
    return d
  }

  /**
   * Error-contained, auto-labeled, scope-registered effect — the shared path
   * under every instance helper (§4.5; R-12/I-6). A throwing callback ALWAYS
   * disposes that one effect (deterministic; siblings stay live; recovery =
   * disconnect + reconnect, which re-runs `connected()`). `opts.onError`
   * OBSERVES the error; absent it, ONE `console.error` names the tag + helper
   * — always, not dev-gated (silent death was the I-6 bug). The throw is
   * contained, never rethrown. NOTE: this deliberately diverges from the
   * barrel `effect()` (§2.6, stays-live onError) — element-scoped effects are
   * reconnect-recoverable, so dispose-on-throw is safe here.
   * @param {string} name @param {() => void} run
   * @param {import('./signals.js').EffectOptions | undefined} opts
   * @param {typeof effect} make
   */
  #guarded(name, run, opts, make = effect) {
    /** @type {(() => void) | null} */ let dispose = null
    let dead = false // set when fail() ran during the synchronous first run, before `dispose` exists
    /** @param {unknown} ex */
    const fail = (ex) => {
      dead = true
      try {
        if (opts?.onError) opts.onError(ex)
        else console.error(`base: <${this.localName}> ${name} threw — binding disposed (reconnect to recover)`, ex)
      } finally {
        if (dispose) dispose() // try/finally: disposed even when the onError handler itself throws
      }
    }
    dispose = make(run, { label: `${this.localName}.${name}`, ...opts, onError: fail })
    if (dead) dispose()
    return this.#register(dispose)
  }

  /**
   * Scope-registered `effect()` (§4.5.1/§4.7, F5): disconnect tears it down;
   * the next `connected()` re-creates it. Auto-labeled (`opts.label`
   * overrides); R-12 error containment — a throw disposes it, `opts.onError`
   * observes (else one console.error). Returns the disposer.
   * @param {() => void} fn @param {import('./signals.js').EffectOptions} [opts] @returns {() => void}
   */
  effect(fn, opts) {
    return this.#guarded('effect', fn, opts)
  }

  /**
   * Scope-registered `effectRaf()` (§4.5.1/§4.7, F5): frame-coalesced,
   * auto-disposed on disconnect, R-12 error containment as `this.effect`.
   * @param {() => void} fn @param {import('./signals.js').EffectOptions} [opts] @returns {() => void}
   */
  effectRaf(fn, opts) {
    return this.#guarded('effectRaf', fn, opts, effectRaf)
  }

  /**
   * Scope-registered `effectIdle()` (§4.5.1/§4.7, R-13): idle-coalesced
   * (delivery forced within the 200 ms anti-starvation timeout, §2.6),
   * disposed on disconnect, re-created by the next `connected()`. Auto-labeled
   * `"<tag>.effectIdle"`; R-12 error containment as `this.effect`.
   * @param {() => void} fn @param {import('./signals.js').EffectOptions} [opts] @returns {() => void}
   */
  effectIdle(fn, opts) {
    return this.#guarded('effectIdle', fn, opts, effectIdle)
  }

  /** @typedef {{ onError?: (e: unknown) => void }} BindOptions R-12 error observer (§4.5). NOTE: instance semantics = observe-then-DISPOSE (diverges from the barrel's stay-live `effect` onError — §2.6/D-26); a THROWING handler aborts the current microtask drain (I-32) — keep handlers observe-only. */

  /** `node.textContent = v == null ? '' : String(v)` @param {Element} node @param {() => unknown} fn @param {BindOptions} [opts] */
  bindText(node, fn, opts) {
    return this.#guarded('bindText', () => { const v = fn(); node.textContent = v == null ? '' : String(v) }, opts)
  }

  /** `null`/`undefined`/`false` → remove; `true` → `''`; else `String(v)`. @param {Element} node @param {string} name @param {() => unknown} fn @param {BindOptions} [opts] */
  bindAttr(node, name, fn, opts) {
    return this.#guarded('bindAttr', () => {
      const v = fn()
      if (v == null || v === false) node.removeAttribute(name)
      else node.setAttribute(name, v === true ? '' : String(v))
    }, opts)
  }

  /** @param {Element} node @param {string} name @param {() => unknown} fn @param {BindOptions} [opts] */
  bindClass(node, name, fn, opts) {
    return this.#guarded('bindClass', () => { node.classList.toggle(name, !!fn()) }, opts)
  }

  /** Custom properties via setProperty, others via `style[prop]`; null removes. @param {HTMLElement} node @param {string} prop @param {() => unknown} fn @param {BindOptions} [opts] */
  bindStyle(node, prop, fn, opts) {
    return this.#guarded('bindStyle', () => {
      const v = fn()
      if (prop.startsWith('--')) {
        if (v == null) node.style.removeProperty(prop)
        else node.style.setProperty(prop, String(v))
      } else {
        ;/** @type {any} */ (node.style)[prop] = v == null ? '' : String(v)
      }
    }, opts)
  }

  /** `node[prop] = v`, skipped when `Object.is(node[prop], v)`. @param {Element} node @param {string} prop @param {() => unknown} fn @param {BindOptions} [opts] */
  bindProp(node, prop, fn, opts) {
    return this.#guarded('bindProp', () => {
      const v = fn(), n = /** @type {any} */ (node)
      if (!Object.is(n[prop], v)) n[prop] = v
    }, opts)
  }

  /** Drive the CustomStateSet → `:state(name)` styling, never class toggling (§4.5, B8). @param {string} name @param {() => unknown} fn @param {BindOptions} [opts] */
  bindState(name, fn, opts) {
    const states = this.#internals.states
    return this.#guarded('bindState', () => { fn() ? states.add(name) : states.delete(name) }, opts)
  }

  /**
   * Keyed list reconcile (§4.5.2, B11). One effect; only `itemsFn` is tracked
   * — `keyFn`/`create`/`update` run untracked (per-item reactivity is authored
   * via `bind*` inside `create`, scoped per §4.5.1). Existing keyed nodes are
   * MOVED (left→right insertBefore, no LIS — §4.5.2 rationale), never
   * recreated; `update` runs for every item on every run, including right
   * after its `create`. The container must be exclusively owned by this list.
   *
   * Errors (R-12): `opts.onError` observes `itemsFn`/`keyFn`/`update` throws
   * — NOT `create` throws, which keep their F3 contract (§4.5.2: item scope
   * disposed, exception PROPAGATES as an uncaught async error). Either way
   * the list effect is disposed; live item scopes/nodes stay until element
   * disposal (torn prefix, P5f). Recovery = reconnect.
   * @template T
   * @param {Element} container
   * @param {() => T[]} itemsFn
   * @param {(item: T, i: number) => unknown} keyFn
   * @param {(item: T) => Element} create - must return a single Element
   * @param {(node: Element, item: T, i: number) => void} update
   * @param {{ onError?: (e: unknown) => void }} [opts]
   * @returns {() => void}
   */
  bindList(container, itemsFn, keyFn, create, update, opts) {
    /** @type {Map<unknown, { node: Element, scope: Array<() => void> }>} */
    const live = new Map()
    const label = `${this.localName}.bindList`
    let createThrew = false
    /** @type {(() => void) | null} */ let stopFx = null
    let dead = false
    /** R-12 + F3: always dispose the list effect on a throw; create() errors
     * propagate (observed by nobody — AC c), the rest are observed or logged.
     * @param {unknown} ex */
    const fail = (ex) => {
      dead = true
      try {
        if (createThrew) { createThrew = false; globalThis.queueMicrotask(() => { throw ex }) }
        else if (opts?.onError) opts.onError(ex)
        else console.error(`base: <${this.localName}> bindList threw — list disposed (reconnect to recover)`, ex)
      } finally {
        if (stopFx) stopFx() // disposed even when the onError handler itself throws
      }
    }
    const stop = effect(() => {
      const items = itemsFn() // the ONLY tracked read
      untracked(() => {
        // 1. keys; duplicate key → dev error, later item skipped (deterministic)
        /** @type {unknown[]} */ const keys = []
        /** @type {T[]} */ const kept = []
        const seen = new Set()
        for (let idx = 0; idx < items.length; idx++) {
          const k = keyFn(items[idx], idx)
          if (seen.has(k)) { if (DEV()) console.error(`base: ${label} duplicate key ${String(k)}`); continue }
          seen.add(k); keys.push(k); kept.push(items[idx])
        }
        // 2. removals: dispose the item scope, remove its node
        for (const [k, rec] of live) {
          if (!seen.has(k)) {
            for (const d of rec.scope) d()
            rec.node.remove()
            live.delete(k)
          }
        }
        // 3. reconcile left→right (simple keyed reconcile)
        for (let idx = 0; idx < keys.length; idx++) {
          let rec = live.get(keys[idx])
          if (!rec) {
            /** @type {Array<() => void>} */ const scope = []
            const prev = currentScope
            currentScope = scope // item scope (§4.5.1)
            let node
            // F3 contract (§4.5.2): on create() throw, the in-progress item's
            // scope is disposed immediately (no unreachable disposers — B2) and
            // its node (if created) is never inserted; the exception then
            // propagates (the list effect is disposed by `fail`, which re-
            // throws create() errors as uncaught async — R-12 routes them past
            // `opts.onError`). Already-reconciled items stay live — torn-
            // prefix, never a silent swallow.
            try { node = create(kept[idx]) }
            catch (ex) { for (const d of scope) d(); createThrew = true; throw ex }
            finally { currentScope = prev }
            if (DEV() && !(node instanceof Element)) console.error(`base: ${label} create() must return a single Element`)
            rec = { node, scope }
            live.set(keys[idx], rec)
          }
          if (container.children[idx] !== rec.node) container.insertBefore(rec.node, container.children[idx] ?? null)
          // 4. data pass — every item, every run
          update(rec.node, kept[idx], idx)
        }
        if (DEV() && container.children.length !== keys.length) console.error(`base: ${label} container has foreign children`)
      })
    }, { label, onError: fail })
    stopFx = stop
    if (dead) stop()
    // one registered disposer: the list effect, then all live item scopes AND
    // their nodes — the scaffold persists across reparenting (§4.4), so leaving
    // item nodes behind would duplicate every row on the next connect (F2, §4.5.1)
    return this.#register(() => {
      stop()
      for (const rec of live.values()) {
        for (const d of rec.scope) d()
        rec.node.remove()
      }
      live.clear()
    })
  }

  // ── events, composition, context (§4.6) ──

  /** Light-DOM query. @param {string} sel */
  first(sel) { return this.querySelector(sel) }

  /** @param {string} sel @returns {Element[]} a real Array */
  all(sel) { return [...this.querySelectorAll(sel)] }

  /**
   * addEventListener with the disposer registered in the current scope.
   * @param {EventTarget} target @param {string} type @param {EventListener} fn
   * @param {AddEventListenerOptions | boolean} [opts] @returns {() => void}
   */
  on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts)
    return this.#register(() => target.removeEventListener(type, fn, opts))
  }

  /** Dispatch a bubbling+composed+cancelable CustomEvent; returns dispatchEvent's boolean. @param {string} type @param {unknown} [detail] */
  emit(type, detail) {
    return this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true, cancelable: true }))
  }

  /**
   * One effect per entry: `childEl[prop] = fn()`, Object.is write gate — child
   * props driven by effects (Δ8). Returns one disposer for all entries
   * (note-silent; minimal choice). R-12 containment applies per entry (a
   * throwing fn disposes only that entry's effect, console.error names `pass`).
   * @param {Element} childEl @param {Record<string, () => unknown>} map
   * @returns {() => void}
   */
  pass(childEl, map) {
    const disposers = Object.entries(map).map(([prop, fn]) =>
      this.#guarded('pass', () => {
        const v = fn(), c = /** @type {any} */ (childEl)
        if (!Object.is(c[prop], v)) c[prop] = v
      }, undefined))
    return () => { for (const d of disposers) d() }
  }

  /**
   * One-shot context request (§4.6, WCCG protocol; `subscribe` is never set):
   * the provided value, or undefined (+ dev warn) when no provider answered.
   * @param {unknown} key @returns {any}
   */
  consumeContext(key) {
    let value
    let answered = false
    const ev = /** @type {any} */ (new Event('context-request', { bubbles: true, composed: true }))
    ev.context = key
    ev.callback = (/** @type {any} */ v) => { value = v; answered = true }
    this.dispatchEvent(ev)
    if (!answered && DEV()) console.warn(`base: <${this.localName}> context request for ${String(key)} went unanswered`)
    return value
  }

  // ── lifecycle hooks (§4.7) — connected() MUST be written re-runnable ──
  connected() {}
  disconnected() {}
}
