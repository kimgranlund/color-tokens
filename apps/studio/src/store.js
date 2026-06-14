// apps/studio/src/store.js — the studio store: the SINGLE writer of spec state
// (PLAN M3.1, §3.4) + URL-hash persistence (PLAN M3.4; SPEC §11 "URL-encodable").
//
// ESM module singleton per D-20a: components import these signals/actions
// directly; the context protocol remains available for ancestor-scoped cases.
//
// THE invariant (D-20a): `spec` only ever holds ENGINE-VALIDATED PaletteSpecs.
// Every mutation builds a candidate spec, lets the engine validate it
// (`validateSpec`, or a mutating engine fn that throws `CurveRampError`), and
// commits ONLY on success. On `CurveRampError` the action records
// `{message, field}` in `lastError` and leaves `spec` untouched — so the
// `palette` computed can never throw. Unexpected (non-CurveRampError) errors
// rethrow: they are bugs, not user input. Every successful spec commit goes
// through `commitCandidate`, which ALSO auto-clears `lastError` (D-21 council
// #5: a stale banner must not describe a rejected edit from the past while
// later edits visibly succeed) AND records undo history (ROADMAP R-7 — see
// the "Undo/redo history" section).
//
// Candidates are built with spreads / engine copy-returning fns — the spec
// held in the signal is never mutated (SPEC §3 "layered, never baked";
// engine purity convention).

import { signal, computed, batch, effect } from '@curve-ramp/base'
import {
  CurveRampError,
  IDENTITY_WARP,
  bakeBezier,
  cusp,
  defaultSpec,
  flattenChannel,
  generate,
  parseSpec,
  peakC,
  reconcileCount,
  resetOverride,
  sampleChannel,
  setBezier,
  setPointOverride,
  toe,
  toeInv,
  validateSpec,
  withScale,
  SCALE_PRESETS,
  SCALE_IDS,
  defaultPaletteSet,
  parsePaletteSet,
} from '@curve-ramp/curve-engine'

/** @typedef {import('@curve-ramp/curve-engine').PaletteSpec} PaletteSpec */
/** @typedef {import('@curve-ramp/curve-engine').Palette} Palette */
/** @typedef {import('@curve-ramp/curve-engine').Channel} Channel */
/** @typedef {import('@curve-ramp/curve-engine').ChannelStack} ChannelStack */
/** @typedef {import('@curve-ramp/curve-engine').BaseFamily} BaseFamily */
/** @typedef {import('@curve-ramp/curve-engine').Gamut} Gamut */
/** @typedef {import('@curve-ramp/curve-engine').ViewState} ViewState */
/** @typedef {import('@curve-ramp/curve-engine').SampleCtx} SampleCtx */
/** @typedef {{ message: string, field?: string }} StoreError */

const DEFAULT_HUE = 235
// The studio SHIPS at scale 25 — the SEMANTIC-COMPLETE grid (v0.13): every surface,
// accent and scrim role lands on an EXACT key (¼-ends minus 225/775 + the
// 350/450/550/650 accent tones + 250/500/750 scrim anchors). The app boot +
// initFromUrl fallback use BOOT_SCALE; the ENGINE default `defaultSpec` stays count
// 11 (SPEC §8) — this is a studio choice.
const BOOT_SCALE = 25
// The UNIT-TEST reset baseline stays count 11: the reconcile/index fixtures are
// written at N=11 (the behavior is count-agnostic — pinned at a convenient N, not
// the shipped default). `_resetForTests` uses this; the app never does.
const DEFAULT_COUNT = 11
const DEFAULT_SCALE = 11

// ── State ────────────────────────────────────────────────────────────────────

// ── Multi-family palette set (D-33) ──────────────────────────────────────────
// Seed all 8 INDEPENDENT family specs ONCE at boot; the ACTIVE primary family's
// spec becomes the live editable signal `spec`, so the GLOBAL light rails (Lr
// 0.15–1.0) and per-family chroma the set applies are present from first paint.
// `currentSet` overlays the live `spec` onto the active family, so export/overview
// always see the in-progress edit. Derived hues (neutral) are seeded from brand
// ONCE; `reDeriveFromBrand` re-runs the seed on demand (D-24: gesture, not cascade).
const DEFAULT_FAMILY = 'primary' // the brand/primary family (v0.10: renamed brand → primary)
/** @typedef {import('@curve-ramp/curve-engine').PaletteFamily} PaletteFamily */
const bootSet = defaultPaletteSet(DEFAULT_HUE, { scale: BOOT_SCALE })
/** The studio's boot spec — the primary family from the seeded set (carries the
 *  global light rails + per-family chroma). */
const BOOT_SPEC = /** @type {PaletteSpec} */ (
  bootSet.find((f) => f.name === DEFAULT_FAMILY)?.spec ?? defaultSpec(DEFAULT_HUE, BOOT_SCALE)
)

/** Validated truth (PLAN §3.4). Only engine-validated specs ever enter here.
 *  `spec` is the ACTIVE family's live, editable spec — every existing action,
 *  undo/redo and persistence operate on it unchanged (D-33: the multi-family
 *  layer rides ON TOP, it does not replace the spec-centric core). */
export const spec = signal(BOOT_SPEC)

/** All family specs (the active one's entry is kept current via `currentSet`). */
export const families = signal(/** @type {PaletteFamily[]} */ (bootSet))
/** Name of the family `spec` currently mirrors. */
export const activeFamily = signal(DEFAULT_FAMILY)
/** The live set — active family reflects the in-progress `spec`, others stored. */
export const currentSet = computed(() =>
  families.value.map((f) => (f.name === activeFamily.value ? { name: f.name, spec: spec.value } : f)),
)
/** Ordered family names — for the menu + overview. */
export const familyNames = computed(() => families.value.map((f) => f.name))

/** Switch the active family: save the live `spec` into the set, load the target,
 *  reset undo/redo (history is per editing session — cross-family undo would
 *  apply one family's spec to another). No-op if already active or unknown.
 *  @param {string} name */
export function selectFamily(name) {
  if (name === activeFamily.peek()) return
  const target = families.peek().find((f) => f.name === name)
  if (!target) return
  batch(() => {
    // commit the active family's live spec back into the set (no validation —
    // it was already validated on the way into `spec`)
    families.value = families.peek().map((f) => (f.name === activeFamily.peek() ? { name: f.name, spec: spec.peek() } : f))
    activeFamily.value = name
    spec.value = target.spec
    undoStack.value = []
    redoStack.value = []
    lastError.value = null
  })
  lastCommitAt = -Infinity
}

/** Re-seed the derived families from the current brand — the D-24 "re-derive from
 *  brand" gesture (not a live cascade). neutral re-tracks the brand hue (tinted
 *  gray); secondary/tertiary RESET to their owner-pinned hues (285/175 — v0.13:
 *  they no longer track the brand). Preserves brand + the system families.
 *  If a re-seeded family is active, its `spec` is refreshed too. */
export function reDeriveFromBrand() {
  const cur = currentSet.peek()
  const brand = cur.find((f) => f.name === 'primary')
  if (!brand) return
  const Lb = brand.spec.channels.L.bounds // preserve the current global light range (D-37)
  const seed = defaultPaletteSet(brand.spec.hue, {
    scale: scaleOf(brand.spec) ?? BOOT_SCALE,
    minLight: Lb.min,
    maxLight: typeof Lb.max === 'number' ? Lb.max : 1,
  })
  const pick = (/** @type {string} */ n) => seed.find((f) => f.name === n)
  batch(() => {
    families.value = cur.map((f) => {
      if (f.name === 'neutral' || f.name === 'secondary' || f.name === 'tertiary') {
        const fresh = pick(f.name)
        return fresh ? { name: f.name, spec: fresh.spec } : f
      }
      return f
    })
    const active = activeFamily.peek()
    if (active === 'neutral' || active === 'secondary' || active === 'tertiary') {
      const fresh = pick(active)
      if (fresh) spec.value = fresh.spec
    }
    undoStack.value = []
    redoStack.value = []
  })
  lastCommitAt = -Infinity
}

/** Ephemeral UI state — NOT persisted (SPEC §8.1, §11). */
export const view = signal(/** @type {ViewState} */ ({ canvasMode: 'overlay', activeChannel: 'L' }))

/** Pure, deterministic derivation (AC A1). Never throws: `spec` is always valid. */
export const palette = computed(() => generate(spec.value))

/** Keys dropped by the LAST count reconcile (AC A8 → toast); `[]` when none. */
export const dropped = signal(/** @type {string[]} */ ([]))

/** Overrides RELOCATED by the LAST count reconcile (D-21 council #1b —
 *  relocation reporting): `{ key, to }` pairs where `key` is the override's
 *  old stop key and `to` the key it landed on after losing its ideal slot to
 *  a collision. Same lifecycle as `dropped`: written by setCount in the SAME
 *  batch (even when `[]` — every reconcile replaces the whole report) and
 *  cleared together with it by `clearDropped()`. `[]` when none. */
export const relocated = signal(/** @type {{ key: string, to: string }[]} */ ([]))

/** The last CurveRampError surfaced by an action. Cleared two ways:
 *  - `clearError()` — explicit dismissal (the UI's Dismiss button);
 *  - automatically by ANY successfully-committed spec action (D-21 council
 *    #5 "goes stale": the old contract — "successful actions do NOT
 *    auto-clear" — left a rejected gamma's banner up while later hue edits
 *    visibly succeeded). View-only writes (setCanvasMode/setActiveChannel)
 *    commit no spec and do NOT clear: the error still describes the last
 *    edit attempt; tab switches only move WHICH surface shows it. */
export const lastError = signal(/** @type {StoreError | null} */ (null))

export function clearError() {
  lastError.value = null
}

/** @typedef {{ message: string, field?: string, at: number }} StoreErrorLogEntry */

/** How many entries the diagnostic error ring keeps (I-4). */
const ERROR_LOG_CAP = 10

/** Diagnostic ring of the last 10 CurveRampErrors recorded by actions (I-4):
 *  `{ message, field?, at }`, oldest-first, appended by recordCurveRampError
 *  on EVERY failure. `at` is a session-monotonic counter — NOT Date.now
 *  (determinism; it restarts with `_resetForTests`) — so rapid-fire
 *  rejections keep their order and identity even though `lastError` (a
 *  single slot; its {message, field?}|null contract is UNCHANGED) only shows
 *  the newest. The ring is HISTORY, not a banner: successful commits and
 *  `clearError()` leave it alone; only `_resetForTests` empties it. */
// NOTE: boot-decode failures in initFromUrl write lastError DIRECTLY and
// deliberately bypass this ring (I-4 / D-26) — only action-path
// recordCurveRampError appends here.
export const errorLog = signal(/** @type {StoreErrorLogEntry[]} */ ([]))

/** Monotonic source for StoreErrorLogEntry.at (I-4) — see errorLog. */
let errorSeq = 0

/** Clear the WHOLE reconcile report — `dropped` AND `relocated` (D-21 #1b).
 *  The name predates the relocation signal and is kept because components
 *  already call it (toast dismiss + auto-dismiss); the two signals are one
 *  report with one lifecycle, so dismissing one dismisses both. */
export function clearDropped() {
  batch(() => {
    if (dropped.peek().length > 0) dropped.value = []
    if (relocated.peek().length > 0) relocated.value = []
  })
}

// ── Undo/redo history (ROADMAP R-7) ──────────────────────────────────────────
//
// A bounded stack of COMMITTED PaletteSpec snapshots, hooked INSIDE
// commitCandidate — the single spec-commit gate — so every successful commit
// participates, bespoke sites included. Only the SPEC is historized: view
// state (activeChannel/canvasMode/theme), the reconcile report
// (dropped/relocated), lastError, and the errorLog ring describe the session,
// not the palette — undo leaves them alone. The D-24 tentCoupling bookkeeping
// is likewise NOT restored: it is ephemeral, and its own still-ours check
// (live delta gone/changed → orphaned, deferred) makes a post-undo spec safe.
//
// GESTURE COALESCING: drags commit per pointermove, but undo must be
// gesture-grained. A commit landing within COALESCE_MS of the PREVIOUS commit
// MERGES into the current undo entry — no new snapshot is pushed, so the
// entry's "before" stays the OLDEST pre-gesture spec; every merged commit
// re-arms the window, so an entire drag (each move < 400 ms apart) is ONE
// undo step regardless of total duration. Recorded consequences:
//   - a drag (many rapid commits) = ONE undo step;
//   - two deliberate edits ≥ 400 ms apart = TWO steps;
//   - rapid typing in the hue field (per-keystroke commits) = one step;
//   - an Esc-cancelled drag (drag commits + the replaceChannel restore, all
//     inside one window) leaves a near-no-op entry whose before == after —
//     acceptable; undoing it re-commits an identical spec.
// Time source: performance.now() through the `now` indirection below — NOT
// Date.now (the I-4 ring's determinism discipline): tests inject a fake
// monotonic clock via _setNowForTests; _resetForTests restores the real one.

/** How many undo entries the history keeps (R-7). */
const HISTORY_CAP = 50

/** Gesture-coalescing window, ms (R-7 recorded design constant): commits
 *  closer than this to the previous commit merge into the open undo entry. */
const COALESCE_MS = 400

/** @type {() => number} */
const realNow = () => performance.now()
/** Monotonic clock for coalescing — swapped only by _setNowForTests. */
let now = realNow

/** Undo history: the spec that was CURRENT immediately before each committed
 *  edit group, oldest → newest. Private — UI consumes canUndo/canRedo. */
const undoStack = signal(/** @type {PaletteSpec[]} */ ([]))

/** Redo history: specs displaced by undo(), in re-apply (pop) order. Cleared
 *  by any NEW committed edit (history forks forward, never branches). */
const redoStack = signal(/** @type {PaletteSpec[]} */ ([]))

/** FROZEN R-7 surface: boolean signals the header buttons disable on. */
export const canUndo = computed(() => undoStack.value.length > 0)
export const canRedo = computed(() => redoStack.value.length > 0)

/** now() of the last history-participating commit. −Infinity forces the next
 *  commit to open a NEW undo entry — set at boot/reset AND after every
 *  undo/redo, so time travel never coalesces into a pre-travel entry. */
let lastCommitAt = -Infinity

/** Re-entrancy flag: true while undo()/redo() commit through the gate — their
 *  commits must neither push history nor clear the redo stack. */
let timeTravel = false

/** Undo the last committed edit group (R-7): re-commits the entry's "before"
 *  snapshot WHOLESALE through the normal gate — validateSpec'd (these are
 *  previously-valid specs), lastError auto-cleared per the success contract,
 *  URL synced by the existing persistence effect. The displaced spec moves to
 *  the redo stack. Empty history → silent no-op (the button disables; this
 *  only guards programmatic calls — lastError is the rejection surface, not
 *  an info channel). */
export function undo() {
  const stack = undoStack.peek()
  const target = stack[stack.length - 1]
  if (target == null) return // bottom of the stack — nothing to undo
  const current = spec.peek()
  timeTravel = true
  try {
    commitCandidate(target, () => {
      undoStack.value = stack.slice(0, -1)
      redoStack.value = [...redoStack.peek(), current]
    })
    lastCommitAt = -Infinity // time travel breaks coalescing — see above
  } catch (e) {
    recordCurveRampError(e)
  } finally {
    timeTravel = false
  }
}

/** Redo the last undone edit group — undo's exact inverse: same gate, same
 *  re-entrancy rules, same coalescing break. Empty redo stack → silent no-op. */
export function redo() {
  const stack = redoStack.peek()
  const target = stack[stack.length - 1]
  if (target == null) return // top of the stack — nothing to redo
  const current = spec.peek()
  timeTravel = true
  try {
    commitCandidate(target, () => {
      redoStack.value = stack.slice(0, -1)
      undoStack.value = [...undoStack.peek(), current]
    })
    lastCommitAt = -Infinity
  } catch (e) {
    recordCurveRampError(e)
  } finally {
    timeTravel = false
  }
}

/** Test hook (R-7): inject a fake monotonic clock for coalescing tests; call
 *  with no argument to restore performance.now (or let _resetForTests do it).
 *  @param {(() => number)} [fn] */
export function _setNowForTests(fn) {
  now = fn ?? realNow
}

/** Test hook (R-7): history DEPTHS only — the snapshots stay private.
 *  @returns {{ undo: number, redo: number }} */
export function _historyForTests() {
  return { undo: undoStack.peek().length, redo: redoStack.peek().length }
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/** @param {number} h @returns {number} */
const wrapHue = (h) => ((h % 360) + 360) % 360

/** CurveRampError → lastError {message, field} + an errorLog ring append
 *  (I-4; one batch — observers never see the slot ahead of the ring);
 *  anything else rethrows. The ring entry is a SEPARATE object carrying
 *  `at` — `lastError` keeps its exact {message, field?} shape (frozen
 *  contract; consumers compare it structurally). @param {unknown} e */
function recordCurveRampError(e) {
  if (!(e instanceof CurveRampError)) throw e
  /** @type {StoreError} */
  const err = e.field != null ? { message: e.message, field: e.field } : { message: e.message }
  errorSeq += 1
  const entry = { ...err, at: errorSeq }
  batch(() => {
    errorLog.value = [...errorLog.peek(), entry].slice(-ERROR_LOG_CAP)
    lastError.value = err
  })
}

/** THE store-level enum guard (D-21 council #13 — guard unification): a
 *  garbage value surfaces as the house CurveRampError → lastError, never an
 *  ad-hoc `lastError.value = …` write or a TypeError deep in the engine.
 *  Message shape matches the engine's: `<name> must be 'a' | 'b'`.
 *  @param {string} value @param {readonly string[]} allowed @param {string} field */
function requireEnum(value, allowed, field) {
  if (!allowed.includes(value)) {
    const name = /** @type {string} */ (field.split('.').pop()) // a dotted field always has a last segment
    throw new CurveRampError('invalid-field', `${name} must be ${allowed.map((a) => `'${a}'`).join(' | ')}`, field)
  }
}

/** Store-level guard so a garbage channel id surfaces as lastError, not a
 *  TypeError deep in the engine. @param {Channel} ch */
function requireChannel(ch) {
  requireEnum(ch, ['L', 'C', 'H'], 'channel')
}

/** Immutable single-channel replacement (fresh channels record, inputs untouched).
 *  @param {PaletteSpec} s @param {Channel} ch @param {ChannelStack} stack @returns {PaletteSpec} */
function withChannel(s, ch, stack) {
  const channels = { L: s.channels.L, C: s.channels.C, H: s.channels.H }
  channels[ch] = stack
  return { ...s, channels }
}

/** THE spec-commit gate — every action that lands a candidate in `spec` goes
 *  through here (commitSpec AND the bespoke sites: setCount, dragPoint,
 *  dragHandle, replaceChannel, setBase, bakeWarp, flattenChannelAction,
 *  dragTentPeak, resets, and undo/redo — time-travel re-entrant, see the R-7
 *  section). Validates,
 *  then commits the candidate and AUTO-CLEARS `lastError` in one batch: a
 *  successful commit proves any displayed rejection is stale (D-21 council
 *  #5). Being the single gate is what makes it the R-7 history hook point:
 *  the pre-commit spec is pushed as an undo snapshot (coalesced by
 *  COALESCE_MS) and the redo stack is cleared — unless `timeTravel` is set,
 *  in which case undo/redo manage the stacks themselves via `also`. `also`
 *  lets a bespoke site write its coupled signals (setCount's
 *  `dropped`/`relocated`) inside the same batch. Throws on invalid candidates
 *  — callers route through recordCurveRampError (nothing, history included,
 *  moves on a rejected candidate).
 *  @param {PaletteSpec} candidate @param {() => void} [also] */
function commitCandidate(candidate, also) {
  validateSpec(candidate)
  const prev = spec.peek()
  batch(() => {
    if (!timeTravel) {
      // R-7 history hook. MERGE inside the coalescing window: no push — the
      // open entry's "before" stays the oldest pre-gesture spec. The
      // empty-stack guard is defensive (boot/reset set lastCommitAt to
      // −Infinity, so it should be unreachable): a fresh edit must always be
      // undoable.
      const t = now()
      if (t - lastCommitAt >= COALESCE_MS || undoStack.peek().length === 0) {
        undoStack.value = [...undoStack.peek(), prev].slice(-HISTORY_CAP)
      }
      lastCommitAt = t
      if (redoStack.peek().length > 0) redoStack.value = [] // a new edit forks history — redo dies
    }
    spec.value = candidate
    if (also) also()
    if (lastError.peek() != null) lastError.value = null
  })
}

/** The action pattern: build candidate → validateSpec → commit on success
 *  (auto-clearing lastError, see commitCandidate); CurveRampError →
 *  lastError, spec untouched. @param {() => PaletteSpec} build */
function commitSpec(build) {
  try {
    commitCandidate(build())
  } catch (e) {
    recordCurveRampError(e)
  }
}

// ── Actions — spec ───────────────────────────────────────────────────────────

/** Set the seed hue (wrapped mod 360 — SPEC §10's sanctioned coercion).
 *  Updates `spec.hue`, TRANSLATES the H channel's sine `base.a` by the hue
 *  delta — `a_new = wrapHue(h) + (a_old − oldHue)` — preserving the drift
 *  mean (D-22; b/c/d untouched; a non-sine H base is left untouched), and
 *  recenters the H drift bounds `wrapHue(h) ± 30` (mirrors `defaultSpec` —
 *  SPEC §8). When the old offset was 0 this reduces to the pre-D-22 pin
 *  `a = wrappedHue`. Non-finite input fails validation (`hue` field) and
 *  commits nothing. @param {number} h */
export function setHue(h) {
  commitSpec(() => {
    const s = spec.peek()
    const hue = wrapHue(typeof h === 'number' ? h : NaN) // NaN flows to validateSpec — no silent coercion
    const H = s.channels.H
    const base = H.base.kind === 'sine' ? { ...H.base, a: hue + (H.base.a - s.hue) } : H.base
    return withChannel({ ...s, hue }, 'H', { ...H, base, bounds: { min: hue - 30, max: hue + 30 } })
  })
}

/** Derive the drift offsets (degrees, RELATIVE to `spec.hue`) from a spec's H
 *  channel (D-22). For the sine base: endpoints are a−b (t=0, dark) and a+b
 *  (t=1, light) when c=0.5/d=0.5; for the flat default ({a, b:0, c:0, d:0})
 *  both offsets are a − hue (usually 0). Do NOT generalize over arbitrary c/d:
 *  if b === 0 → dark = light = a − hue; else ASSUME the drift form (c=0.5,
 *  d=0.5) and read { dark: (a − b) − hue, light: (a + b) − hue }. If the H
 *  base is somehow not sine (impossible via this UI; possible via URL),
 *  return { dark: 0, light: 0 }. Pure.
 *  @param {PaletteSpec} s @returns {{ dark: number, light: number }} */
export function hueDriftOf(s) {
  const base = s.channels.H.base
  if (base.kind !== 'sine') return { dark: 0, light: 0 }
  if (base.b === 0) {
    const offset = base.a - s.hue
    return { dark: offset, light: offset }
  }
  return { dark: base.a - base.b - s.hue, light: base.a + base.b - s.hue }
}

/** Set the drift endpoints (degrees relative to `spec.hue`) — D-22. Rebuilds
 *  the H base as { kind:'sine', a: hue + (dark+light)/2, b: (light−dark)/2,
 *  c: 0.5, d: 0.5 } — endpoints land EXACTLY at hue+dark / hue+light;
 *  symmetric ±x is the golden-fixture drift shape. dark===light===0 still
 *  writes the c:0.5/d:0.5 form (the value is constant — fine). Bézier +
 *  overrides PRESERVED (AC A2). Candidate → validateSpec → commit;
 *  CurveRampError → lastError, spec untouched (house action pattern). NO
 *  clamping here — the canvas's drag range is the ±30° viewport and the
 *  picker inputs are the caller's responsibility; values that push a±b
 *  outside bounds simply flatten at the rails when sampled.
 *  @param {number} dark @param {number} light */
export function setHueDrift(dark, light) {
  commitSpec(() => {
    const s = spec.peek()
    const H = s.channels.H
    /** @type {BaseFamily} */
    const base = { kind: 'sine', a: s.hue + (dark + light) / 2, b: (light - dark) / 2, c: 0.5, d: 0.5 }
    return withChannel(s, 'H', { ...H, base })
  })
}

/** Change the stop count via `reconcileCount` (fraction-nearest re-anchoring,
 *  SPEC §6). Commits spec + the reconcile report (`dropped` AND `relocated`,
 *  D-21 #1b) together; both are set even when `[]` — every reconcile replaces
 *  the previous report wholesale. Out-of-range counts (D-11: [2, 91]) throw
 *  inside the engine → lastError, report untouched.
 *  @param {number} n */
export function setCount(n) {
  try {
    const r = reconcileCount(spec.peek(), n)
    commitCandidate(r.spec, () => {
      dropped.value = r.dropped
      relocated.value = r.relocated
    })
  } catch (e) {
    recordCurveRampError(e)
  }
}

/** Switch to a fixed scale preset (D-32): 11 / 19 / 23 / 39. Like setCount it
 *  goes through `withScale` (reconciles overrides fraction-nearest + applies the
 *  scale's stops) and commits spec + reconcile report together.
 *  @param {import('@curve-ramp/curve-engine').ScaleId} id */
export function setScale(id) {
  try {
    const r = withScale(spec.peek(), id)
    commitCandidate(r.spec, () => {
      dropped.value = r.dropped
      relocated.value = r.relocated
    })
  } catch (e) {
    recordCurveRampError(e)
  }
}

/** The active family's L-channel light range (Lr) — for the global lightness
 *  control to reflect. `max` is always a number on L (only C's max can be
 *  'gamut'); the fallback is defensive. */
export const lightRange = computed(() => {
  const b = spec.value.channels.L.bounds
  return { min: b.min, max: typeof b.max === 'number' ? b.max : 1 }
})

/** Set the GLOBAL light range — the L-channel bounds (Lr `min`/`max`) applied to
 *  EVERY family (the owner's "global min/max lightness", D-37), so it's one knob
 *  across the whole set. The ACTIVE family commits through the house gate (R-7
 *  undoable; validated min < max + finite — else `lastError`, nothing moves); the
 *  stored non-active families are synced inside the SAME batch. Undo reverts the
 *  active family's range (the visible one); the set re-syncs on the next call.
 *  @param {number} min @param {number} max */
export function setLightRange(min, max) {
  try {
    const s = spec.peek()
    const withL = (/** @type {PaletteSpec} */ x) => withChannel(x, 'L', { ...x.channels.L, bounds: { min, max } })
    commitCandidate(withL(s), () => {
      const active = activeFamily.peek()
      families.value = families.peek().map((f) => (f.name === active ? f : { name: f.name, spec: withL(f.spec) }))
    })
  } catch (e) {
    recordCurveRampError(e)
  }
}

/** Which fixed scale (if any) the current spec matches — for the selector's
 *  active state; null when a bespoke count/stops doesn't match a preset.
 *  @param {PaletteSpec} s @returns {import('@curve-ramp/curve-engine').ScaleId | null} */
export function scaleOf(s) {
  for (const id of SCALE_IDS) {
    const p = SCALE_PRESETS[id]
    if (p.count !== s.count) continue
    const a = p.stops ?? null
    const b = s.stops ?? null
    if (a === null && b === null) return id
    if (a && b && a.length === b.length && a.every((v, i) => v === b[i])) return id
  }
  return null
}

// ── Export config (D-32) — UI-only; family/scrims are output formatting, NOT in
//    the PaletteSpec (the spec stays the curve definition; export-only scope ruling).
export const exportFamily = signal('')
// Scrims are ALWAYS included in CSS output (v0.7 owner directive) — default true,
// no toggle in the UI. The signal is kept so the export effect/tests can read it.
export const exportScrims = signal(true)
/** @param {string} f */
export function setExportFamily(f) {
  exportFamily.value = String(f).trim()
}
/** @param {boolean} on */
export function setExportScrims(on) {
  exportScrims.value = !!on
}
/** Scrim anchors [250,500,750] filtered to keys present in the current scale, so
 *  toCssVars never throws (scale 11 lacks 250/750 — falls back to whatever exists). */
export const scrimAnchors = computed(() => {
  const keys = new Set(palette.value.swatches.map((s) => s.key))
  return [250, 500, 750].filter((a) => keys.has(String(a).padStart(3, '0')))
})

/** Display-gamut toggle — writes `spec.displayGamut`, the ONE source of truth
 *  (D-14): generate re-clamps C, OOG flags / cap line / exports all follow.
 *  @param {Gamut} g */
export function setGamut(g) {
  commitSpec(() => ({ ...spec.peek(), displayGamut: g }))
}

// ── Actions — view (ephemeral; never persisted) ──────────────────────────────

/** View-only — commits no spec, so it neither auto-clears nor goes through
 *  commitCandidate. Guarded by the house requireEnum (D-21 #13: this used to
 *  write lastError directly with a bespoke pattern). @param {ViewState['canvasMode']} m */
export function setCanvasMode(m) {
  try {
    requireEnum(m, ['overlay', 'single'], 'view.canvasMode')
    view.value = { ...view.peek(), canvasMode: m }
  } catch (e) {
    recordCurveRampError(e)
  }
}

/** @param {Channel} ch */
export function setActiveChannel(ch) {
  try {
    requireChannel(ch)
    view.value = { ...view.peek(), activeChannel: ch }
  } catch (e) {
    recordCurveRampError(e)
  }
}

// ── Actions — curve edits ────────────────────────────────────────────────────

/** Drag stop `i` of channel `ch` to `value` — in CHANNEL UNITS (L: **Lr**, not
 *  OKLab L; C: chroma; H: degrees). Builds the SampleCtx exactly like
 *  `engine.generate` (same ordering dependency, CLAUDE.md): t = i/(count−1);
 *  L and H sample against the seed hue; C samples against the stop's RESOLVED
 *  H and OKLab L (read off the current palette — fit() preserves ideal L/H)
 *  with `cap = peakC(L, H, displayGamut)` threaded (M0.7 cap threading).
 *  `setPointOverride` back-solves the delta — base and bézier untouched
 *  (SPEC §6, AC A3/A5). @param {Channel} ch @param {number} i @param {number} value */
export function dragPoint(ch, i, value) {
  try {
    requireChannel(ch)
    const s = spec.peek()
    if (!Number.isInteger(i) || i < 0 || i >= s.count) {
      throw new CurveRampError('invalid-field', `stop index must be an integer in [0, ${s.count})`, 'stopIndex')
    }
    const t = i / (s.count - 1)
    /** @type {SampleCtx} */
    let ctx
    if (ch === 'C') {
      const sw = palette.peek().swatches[i]
      if (sw == null) {
        throw new CurveRampError('degenerate', `no swatch at index ${i}`, 'stopIndex')
      }
      const { L, H } = sw.oklch
      ctx = { t, hue: H, L, cap: peakC(L, H, s.displayGamut), stopIndex: i, gamut: s.displayGamut }
    } else {
      ctx = { t, hue: s.hue, stopIndex: i, gamut: s.displayGamut }
    }
    commitCandidate(withChannel(s, ch, setPointOverride(s.channels[ch], i, value, ctx)))
  } catch (e) {
    recordCurveRampError(e)
  }
}

/** Set channel `ch`'s Bézier warp handles. The canvas pre-clamps x to (0,1)
 *  monotone (M4.3); engine `validateWarp` inside `setBezier` is the backstop —
 *  an invalid warp lands in lastError, spec untouched. Overrides are preserved
 *  and re-apply on top (AC A4). @param {Channel} ch
 *  @param {{x: number, y: number}} p1 @param {{x: number, y: number}} p2 */
export function dragHandle(ch, p1, p2) {
  try {
    requireChannel(ch)
    const s = spec.peek()
    const warped = setBezier(s.channels[ch], { p1: { x: p1.x, y: p1.y }, p2: { x: p2.x, y: p2.y } })
    commitCandidate(withChannel(s, ch, warped))
  } catch (e) {
    recordCurveRampError(e)
  }
}

/** Replace channel `ch` wholesale — the Esc-cancel restore path (a snapshot
 *  taken before a drag goes back in). The full candidate is validated before
 *  commit; a stack whose `.channel` doesn't match the slot is rejected.
 *  @param {Channel} ch @param {ChannelStack} stack */
export function replaceChannel(ch, stack) {
  try {
    requireChannel(ch)
    if (stack == null || typeof stack !== 'object' || stack.channel !== ch) {
      throw new CurveRampError('invalid-field', `replacement stack.channel must be '${ch}'`, `channels.${ch}.channel`)
    }
    commitCandidate(withChannel(spec.peek(), ch, stack))
  } catch (e) {
    recordCurveRampError(e)
  }
}

/** Swap channel `ch`'s base family/params. Overrides AND bézier are PRESERVED
 *  (AC A2 — edits stay local to their layer); invalid params (gamma ≤ 0,
 *  falloff out of [0.5, 3], …) fail validation → lastError.
 *  @param {Channel} ch @param {BaseFamily} base */
export function setBase(ch, base) {
  try {
    requireChannel(ch)
    const s = spec.peek()
    commitCandidate(withChannel(s, ch, { ...s.channels[ch], base: { ...base } }))
  } catch (e) {
    recordCurveRampError(e)
  }
}

// ── Layer ops: bake / flatten (SPEC §6 optional ops, D-15 un-deferred) ───────

/** Is `warp` the identity easing (1/3,1/3)/(2/3,2/3)? Exported for the UI's
 *  bake affordance: the bake button DISABLES on an identity warp instead of
 *  surfacing a no-op "error" through lastError (lastError is the rejection
 *  surface, not an info channel). ±1e-9 — the house exact-match epsilon
 *  (drift/tent preset chips). @param {import('@curve-ramp/curve-engine').BezierWarp} warp
 *  @returns {boolean} */
export function isIdentityWarp(warp) {
  const EPS = 1e-9
  return (
    Math.abs(warp.p1.x - IDENTITY_WARP.p1.x) <= EPS &&
    Math.abs(warp.p1.y - IDENTITY_WARP.p1.y) <= EPS &&
    Math.abs(warp.p2.x - IDENTITY_WARP.p2.x) <= EPS &&
    Math.abs(warp.p2.y - IDENTITY_WARP.p2.y) <= EPS
  )
}

/** Bake channel `ch`'s warp into its base (SPEC §6 "Bake Bézier → base"):
 *  engine `bakeBezier` folds base⊗bézier into a `lookup` base with an identity
 *  warp; overrides are PRESERVED verbatim and re-apply on top (A2-adjacent —
 *  the override layer is untouched). Identity warp → silent no-op (nothing to
 *  bake; the UI disables the button, so this only guards programmatic calls).
 *
 *  CTX NOTE (the C approximation): bakeBezier samples internally across t but
 *  takes ONE ctx for cap resolution, so for C — whose `'gamut'` max needs a
 *  resolved cap exactly like baseBezier — a SINGLE cap stands in for every
 *  sample. That approximation is the ENGINE's (documented on bakeBezier); the
 *  store's job is to pass a representative one: the MID-STOP (count>>1)
 *  palette-derived L/H/cap, built exactly like dragPoint's C ctx. L and H need
 *  no cap — seed-hue ctx, as everywhere.
 *
 *  House candidate pattern: validateSpec via commitCandidate (auto-clears
 *  lastError on success); CurveRampError → lastError, spec untouched.
 *  @param {Channel} ch */
export function bakeWarp(ch) {
  try {
    requireChannel(ch)
    const s = spec.peek()
    const stack = s.channels[ch]
    if (isIdentityWarp(stack.bezier)) return // nothing to bake — no-op, no error
    const mid = s.count >> 1
    const t = mid / (s.count - 1)
    /** @type {SampleCtx} */
    let ctx
    if (ch === 'C') {
      const sw = palette.peek().swatches[mid]
      if (sw == null) {
        throw new CurveRampError('degenerate', `no swatch at index ${mid}`, 'stopIndex')
      }
      const { L, H } = sw.oklch
      ctx = { t, hue: H, L, cap: peakC(L, H, s.displayGamut), gamut: s.displayGamut }
    } else {
      ctx = { t, hue: s.hue, gamut: s.displayGamut }
    }
    commitCandidate(withChannel(s, ch, bakeBezier(stack, ctx)))
  } catch (e) {
    recordCurveRampError(e)
  }
}

/** Flatten channel `ch` (SPEC §6 "snapshot for hand-off"): engine
 *  `flattenChannel` replaces the base with the channel's CURRENT per-stop
 *  output as a `lookup`, resets the warp to identity, and CLEARS the
 *  overrides — output identical at every stop, layers collapsed to one.
 *  DESTRUCTIVE to the override layer by design (the deltas are folded into
 *  the lookup); confirmation-free per SPEC §6 — the UI's flatten button
 *  carries a `title` warning, and the shareable-URL history holds the
 *  previous state. House pattern: validated commit (auto-clears lastError);
 *  CurveRampError → lastError, spec untouched. Named `flattenChannelAction`
 *  to keep the engine's `flattenChannel` import unshadowed.
 *  @param {Channel} ch */
export function flattenChannelAction(ch) {
  try {
    requireChannel(ch)
    commitCandidate(flattenChannel(spec.peek(), ch))
  } catch (e) {
    recordCurveRampError(e)
  }
}

// ── Tent base + the coupled peak gesture (PLAN D-24) ─────────────────────────
//
// D-24's live-2D amendment: the Chroma+Lightness coupling is a STORE GESTURE
// (`dragTentPeak`) that writes two ORDINARY per-layer edits in one batch —
// tent params on C plus a normal per-stop L override via `setPointOverride`.
// The engine stays fully decoupled (no cascade); the L bend shows up as a
// regular dot on the L tab, resettable and Esc-restorable like any other edit.

/** @typedef {{ x: number, y: number }} TentPoint */
/** @typedef {{ peakT: number, peakC: number, low: TentPoint, high: TentPoint }} TentParams */
/** @typedef {{ peakT?: number, peakC?: number, low?: TentPoint, high?: TentPoint }} TentPatch */

/** D-24 gesture bookkeeping: the ONE L override WE wrote for the tent peak
 *  (`delta` = the override value setPointOverride produced). Module-level
 *  ephemeral state — NOT persisted, NOT part of the spec. A user edit at the
 *  same stop changes the delta and orphans this record (user edits win).
 *  @type {{ stop: number, delta: number } | null} */
let tentCoupling = null

/** Shallow-merge a tent patch into the CURRENT tent base. Throws the house
 *  CurveRampError when the C base is not tent. Absent keys keep the current
 *  value; present-but-invalid values flow to validateSpec untouched (no
 *  silent coercion). @param {PaletteSpec} s @param {TentPatch} patch
 *  @returns {BaseFamily} */
function mergedTentBase(s, patch) {
  const base = s.channels.C.base
  if (base.kind !== 'tent') {
    throw new CurveRampError('invalid-field', 'C base is not tent', 'channels.C.base.kind')
  }
  return {
    kind: 'tent',
    peakT: patch.peakT !== undefined ? patch.peakT : base.peakT,
    peakC: patch.peakC !== undefined ? patch.peakC : base.peakC,
    low: patch.low !== undefined ? { x: patch.low.x, y: patch.low.y } : base.low,
    high: patch.high !== undefined ? { x: patch.high.x, y: patch.high.y } : base.high,
  }
}

/** The C channel's tent params, or null when the C base is not tent. Pure —
 *  reads only `s`; returned points are fresh objects (the spec stays
 *  untouchable through them). @param {PaletteSpec} s @returns {TentParams | null} */
export function tentOf(s) {
  const base = s.channels.C.base
  if (base.kind !== 'tent') return null
  return {
    peakT: base.peakT,
    peakC: base.peakC,
    low: { x: base.low.x, y: base.low.y },
    high: { x: base.high.x, y: base.high.y },
  }
}

/** Shallow-merge {peakT?, peakC?, low?, high?} into the current tent base.
 *  Non-tent C base → lastError ('C base is not tent'), no commit. House
 *  pattern: candidate → validateSpec → commit; CurveRampError → lastError.
 *  @param {TentPatch} patch */
export function setTent(patch) {
  commitSpec(() => {
    const s = spec.peek()
    return withChannel(s, 'C', { ...s.channels.C, base: mergedTentBase(s, patch) })
  })
}

/** Cusp readout for the CURRENT spec — what 'Peak at cusp' wants: the SEED
 *  hue's cusp {L, C} (engine `cusp`, OKLab L / max chroma) plus `t` = the stop
 *  position with the most chroma headroom, found by scanning the per-stop caps
 *  cap_i = peakC(L_i, H_i, displayGamut) over the current palette's swatches
 *  (argmax; first wins on ties). @returns {{ L: number, C: number, t: number }} */
export function cuspInfo() {
  const s = spec.value
  const swatches = palette.value.swatches
  let bestI = 0
  let bestCap = -Infinity
  for (let i = 0; i < swatches.length; i++) {
    const { L, H } = swatches[i].oklch
    const cap = peakC(L, H, s.displayGamut)
    if (cap > bestCap) {
      bestCap = cap
      bestI = i
    }
  }
  const c = cusp(s.hue, s.displayGamut)
  return { L: c.L, C: c.C, t: bestI / (s.count - 1) }
}

/** THE COUPLED GESTURE (D-24 live-2D): drag the tent's Peak Chroma Point to
 *  (tNorm, cValue). One validated candidate, one commit:
 *
 *  (1) C: tent peakT = tNorm (clamped [0.02, 0.98]), peakC = cValue (clamped
 *      ≥ 0.005) — same candidate machinery as setTent.
 *  (2) DEMAND-DRIVEN LIGHTNESS COUPLING at stop i = round(tNorm·(count−1)):
 *      when cValue exceeds the stop's gamut cap peakC(L_i, H_i) (+1e-6), move
 *      L_i minimally TOWARD cusp(H_i).L until the cap affords cValue.
 *      Lr/OKLab boundary: the search runs in OKLab L (peakC/cusp take OKLab L;
 *      L_i comes off the current palette — fit() preserves ideal L/H), the
 *      WRITE happens in Lr (engine `toe`) because the L channel's curve math
 *      is Lr (SPEC §7). ASSUMPTION (documented per D-24): peakC(·, H) is
 *      unimodal in L with its max at the cusp's L, so along the segment
 *      [L_i → cuspL] it is monotone non-decreasing — bisection (≤24 iters)
 *      finds the minimal move. Lr* is then clamped to keep L monotone between
 *      neighbor stops, (Lr_{i−1}+1e-3, Lr_{i+1}−1e-3) via sampleChannel
 *      (rails bounds.min/max at the ends); if the clamp can't fully afford
 *      cValue we take it anyway — the C clamp + amber surfaces the remainder
 *      honestly. Written as a NORMAL per-stop L override (setPointOverride) —
 *      layered, visible on the L tab, resettable.
 *  (3) BOOKKEEPING: remembers { stop, delta } it wrote. On the next call, if
 *      the peak moved stops OR cValue no longer needs the bend (≤ the unbent
 *      cap), OUR override is removed — but only iff the live override still
 *      equals our recorded delta (±1e-12; user edits win and orphan it).
 *
 *  CurveRampError anywhere → lastError; nothing (spec OR bookkeeping) applies.
 *  @param {number} tNorm @param {number} cValue */
export function dragTentPeak(tNorm, cValue) {
  try {
    if (
      typeof tNorm !== 'number' || !Number.isFinite(tNorm) ||
      typeof cValue !== 'number' || !Number.isFinite(cValue)
    ) {
      throw new CurveRampError('invalid-field', 'tNorm and cValue must be finite numbers', 'channels.C.base')
    }
    const s = spec.peek()
    const peakT = Math.min(0.98, Math.max(0.02, tNorm)) //  documented gesture clamps
    const want = Math.max(0.005, cValue)
    const tentBase = mergedTentBase(s, { peakT, peakC: want }) // throws when C base is not tent
    const n = s.count
    const gamut = s.displayGamut
    const i = Math.round(peakT * (n - 1))
    const sw = palette.peek().swatches[i]
    if (sw == null) {
      throw new CurveRampError('degenerate', `no swatch at index ${i}`, 'stopIndex')
    }
    const { L: Li, H } = sw.oklch // OKLab L + resolved H at the peak stop (CURRENT palette)
    /** L-channel SampleCtx at stop j — mirrors dragPoint/generate. @param {number} j @returns {SampleCtx} */
    const ctxAt = (j) => ({ t: j / (n - 1), hue: s.hue, stopIndex: j, gamut })

    // ── (3) reconcile bookkeeping FIRST: is the recorded override still OURS?
    let hasOurs = false
    let prevStop = -1
    if (tentCoupling != null) {
      const cur = s.channels.L.overrides[tentCoupling.stop]
      if (cur != null && Math.abs(cur - tentCoupling.delta) <= 1e-12) {
        hasOurs = true
        prevStop = tentCoupling.stop
      }
      // else: user edited/removed it — orphaned; we defer and never touch it.
    }
    let nextCoupling = hasOurs ? { stop: prevStop, delta: /** @type {number} */ (s.channels.L.overrides[prevStop]) } : null
    let candL = s.channels.L
    if (hasOurs && prevStop !== i) {
      candL = resetOverride(candL, prevStop) // peak moved — retract our old bend
      nextCoupling = null
    }

    // ── (2) demand check against the CURRENT palette's cap at stop i
    const cap = peakC(Li, H, gamut)
    let needBend = want > cap + 1e-6
    if (hasOurs && prevStop === i) {
      // The release test runs against the UNBENT cap (our override removed):
      const LrUnbent = sampleChannel(resetOverride(candL, i), ctxAt(i))
      const capUnbent = peakC(toeInv(LrUnbent), H, gamut)
      if (want <= capUnbent + 1e-6) {
        candL = resetOverride(candL, i) // bend no longer needed
        nextCoupling = null
        needBend = false
      }
      // else the bend is still needed: keep it (and deepen below if cap < want).
    }

    if (needBend) {
      const cu = cusp(H, gamut)
      let Lstar
      if (cu.C <= want) {
        Lstar = cu.L // even the cusp can't afford it — go all the way; C clamp + amber covers the rest
      } else {
        // Bisect s ∈ [0,1] over L(s) = Li + s·(cuspL − Li): invariant
        // peakC(L(lo)) < want ≤ peakC(L(hi)) (lo=0 by the demand check,
        // hi=1 by cu.C > want); ≤ 24 iters; take hi — the affording side.
        let lo = 0
        let hi = 1
        for (let k = 0; k < 24; k++) {
          const mid = (lo + hi) / 2
          if (peakC(Li + mid * (cu.L - Li), H, gamut) >= want) hi = mid
          else lo = mid
        }
        Lstar = Li + hi * (cu.L - Li)
      }
      // OKLab → Lr at the write boundary, then the monotonicity clamp.
      const loRail = i > 0 ? sampleChannel(candL, ctxAt(i - 1)) + 1e-3 : candL.bounds.min
      const hiRail =
        i < n - 1
          ? sampleChannel(candL, ctxAt(i + 1)) - 1e-3
          : typeof candL.bounds.max === 'number'
            ? candL.bounds.max
            : 1
      const LrStar = Math.min(hiRail, Math.max(loRail, toe(Lstar)))
      candL = setPointOverride(candL, i, LrStar, ctxAt(i)) // the layered edit (P2)
      nextCoupling = { stop: i, delta: /** @type {number} */ (candL.overrides[i]) }
    }

    // ── ONE full candidate (C tent + L overrides), ONE validated commit.
    commitCandidate({
      ...s,
      channels: { L: candL, C: { ...s.channels.C, base: tentBase }, H: s.channels.H },
    })
    tentCoupling = nextCoupling // bookkeeping only moves on success
  } catch (e) {
    recordCurveRampError(e)
  }
}

/** Test hook: the current D-24 coupling bookkeeping (a copy), or null.
 *  @returns {{ stop: number, delta: number } | null} */
export function _tentCouplingForTests() {
  return tentCoupling == null ? null : { stop: tentCoupling.stop, delta: tentCoupling.delta }
}

// ── Actions — resets (SPEC §6: "overrides → identity (scoped)") ─────────────

/** Reset one stop's override to identity; base + bézier untouched.
 *  @param {Channel} ch @param {number} i */
export function resetPoint(ch, i) {
  try {
    requireChannel(ch)
    const s = spec.peek()
    commitCandidate(withChannel(s, ch, resetOverride(s.channels[ch], i)))
  } catch (e) {
    recordCurveRampError(e)
  }
}

/** Reset ALL of channel `ch`'s overrides to identity; base + bézier untouched.
 *  @param {Channel} ch */
export function resetChannel(ch) {
  try {
    requireChannel(ch)
    const s = spec.peek()
    commitCandidate(withChannel(s, ch, resetOverride(s.channels[ch])))
  } catch (e) {
    recordCurveRampError(e)
  }
}

/** Reset every channel's overrides to identity (SPEC §6 "reset all" — scoped
 *  to the override layer: bases and béziers are untouched). */
export function resetAll() {
  try {
    const s = spec.peek()
    commitCandidate({
      ...s,
      channels: {
        L: resetOverride(s.channels.L),
        C: resetOverride(s.channels.C),
        H: resetOverride(s.channels.H),
      },
    })
  } catch (e) {
    recordCurveRampError(e)
  }
}

// ── URL-hash persistence (M3.4; SPEC §11 round-trip) ─────────────────────────

const SET_PREFIX = '#set=' // the FULL palette set (gzipped) — D-39
const HASH_PREFIX = '#s=' //  legacy single-spec (plain base64) — still PARSED for old links
const SYNC_DEBOUNCE_MS = 300

/** @type {(() => void) | null} */
let persistenceDispose = null
let persistenceStarted = false // async-boot idempotency (set before the #set= decode awaits)
/** @type {ReturnType<typeof setTimeout> | null} */
let syncTimer = null
/** @type {Promise<void> | null} The in-flight debounced hash write (tests await it). */
let pendingSync = null

/** gzip a string → base64 (CompressionStream, zero-dep, Baseline 2023). The full
 *  8-family set is ~17 KB of repetitive JSON → ~0.8 KB gzipped, so a share link
 *  stays short. @param {string} str @returns {Promise<string>} */
async function gzipB64(str) {
  const cs = new CompressionStream('gzip')
  const w = cs.writable.getWriter()
  w.write(new TextEncoder().encode(str))
  w.close()
  /** @type {Uint8Array[]} */
  const chunks = []
  const r = cs.readable.getReader()
  for (;;) {
    const { done, value } = await r.read()
    if (done) break
    chunks.push(value)
  }
  let bin = ''
  for (const c of chunks) for (let i = 0; i < c.length; i++) bin += String.fromCharCode(c[i])
  return btoa(bin)
}
/** Inverse of gzipB64. Throws on a corrupt payload (bad base64 / bad gzip).
 *  @param {string} b64 @returns {Promise<string>} */
async function gunzipB64(b64) {
  const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))
  const ds = new DecompressionStream('gzip')
  const w = ds.writable.getWriter()
  w.write(bytes)
  w.close()
  /** @type {Uint8Array[]} */
  const chunks = []
  const r = ds.readable.getReader()
  for (;;) {
    const { done, value } = await r.read()
    if (done) break
    chunks.push(value)
  }
  let total = new Uint8Array(0)
  for (const c of chunks) {
    const t = new Uint8Array(total.length + c.length)
    t.set(total)
    t.set(c, total.length)
    total = t
  }
  return new TextDecoder().decode(total)
}

/** Encode the WHOLE palette set + the active family name into the `#set=` hash
 *  (gzipped JSON, D-39). @param {PaletteFamily[]} set @param {string} active */
async function encodeSetHash(set, active) {
  return SET_PREFIX + (await gzipB64(JSON.stringify({ v: 1, active, families: set })))
}
/** Decode a `#set=` hash → { families, active }, validated through `parsePaletteSet`
 *  (throws CurveRampError on a bad shape). @param {string} hash */
async function decodeSetHash(hash) {
  const obj = JSON.parse(await gunzipB64(hash.slice(SET_PREFIX.length)))
  const fams = parsePaletteSet(/** @type {{ families: unknown }} */ (obj).families)
  const wanted = /** @type {{ active?: unknown }} */ (obj).active
  const active = typeof wanted === 'string' && fams.some((f) => f.name === wanted) ? wanted : fams[0].name
  return { families: fams, active }
}

/** Apply a boot decode failure (C1-#4 split): a typed CurveRampError surfaces
 *  verbatim; a raw atob/JSON/gzip exception renders as the human "damaged link"
 *  sentence with the raw detail in console.warn. Falls back to the default spec.
 *  @param {unknown} e */
function applyDecodeError(e) {
  const message = e instanceof Error ? e.message : String(e)
  batch(() => {
    spec.value = BOOT_SPEC
    if (e instanceof CurveRampError) {
      lastError.value = e.field != null ? { message, field: e.field } : { message }
    } else {
      console.warn(`curve-ramp: share-link decode failed — ${message}`)
      lastError.value = { message: 'this share link is damaged — showing defaults' }
    }
  })
}

// ── Palette project files (D-41) ─────────────────────────────────────────────
// A "project" is the EDITABLE source — the family SPECS as JSON, NOT the generated
// OKLCh output (the app reproduces every color from the specs on load). Same shape
// as the #set= hash payload ({ v, active, families }), uncompressed + pretty so the
// file is human-readable and diffable.

/** Serialize the CURRENT palette set as a downloadable project (pretty JSON of the
 *  family specs). The dual of importProject. @returns {string} */
export function exportProject() {
  return JSON.stringify({ v: 1, active: activeFamily.peek(), families: currentSet.peek() }, null, 2)
}

/** Load a palette project from a file's JSON text. Validates the family specs via
 *  parsePaletteSet (colors regenerate from them); on success replaces the whole set
 *  + active family and resets undo. On a BAD file the current palette is LEFT INTACT
 *  and lastError carries the reason (typed engine errors verbatim; a raw parse error
 *  a friendly sentence). @param {string} jsonText @returns {boolean} loaded? */
export function importProject(jsonText) {
  try {
    const obj = JSON.parse(jsonText)
    const fams = parsePaletteSet(/** @type {{ families: unknown }} */ (obj).families)
    const wanted = /** @type {{ active?: unknown }} */ (obj).active
    const active = typeof wanted === 'string' && fams.some((f) => f.name === wanted) ? wanted : fams[0].name
    const activeFam = fams.find((f) => f.name === active) ?? fams[0]
    batch(() => {
      families.value = fams
      activeFamily.value = active
      spec.value = activeFam.spec
      undoStack.value = []
      redoStack.value = []
      lastError.value = null
    })
    lastCommitAt = -Infinity
    return true
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (e instanceof CurveRampError) {
      lastError.value = e.field != null ? { message, field: e.field } : { message }
    } else {
      console.warn(`curve-ramp: project import failed — ${message}`)
      lastError.value = { message: 'this file is not a valid palette project — keeping the current one' }
    }
    return false
  }
}

/** Compose a shareable URL of the CURRENT full set — through the SAME encoder the
 *  persistence effect uses (R-8/D-39). Composition (C2-F5): origin + pathname +
 *  search + '#set=<gzipped set>' — `location.search` is PRESERVED (only the hash
 *  is ours). Reads the live `currentSet`/`activeFamily` via peek, so it reflects
 *  the in-progress edit, never the ≤300 ms-stale `location.hash`. Async because
 *  gzip is (CompressionStream). @returns {Promise<string>} */
export async function currentShareUrl() {
  const hash = await encodeSetHash(currentSet.peek(), activeFamily.peek())
  return location.origin + location.pathname + location.search + hash
}

/** Boot the store from `location.hash` and start URL persistence (D-39: the WHOLE
 *  palette set round-trips, not just the active family).
 *  - `#set=<gzipped JSON>` → families + activeFamily + the active spec (async).
 *  - `#s=<base64 JSON>` (legacy single spec) → the active `spec`, families stay seeded.
 *  - No payload → the studio default (scale 25).
 *  - Malformed/invalid → `lastError` + default (C1-#4 message split, see applyDecodeError).
 *  Then starts the persistence effect: every committed set change schedules a
 *  debounced (300 ms, trailing) `#set=` write. The effect's initial run is skipped
 *  — boot state CAME from the URL. Idempotent. Async (the `#set=` decode awaits
 *  gzip); the sync paths still set `spec` synchronously before the function yields. */
export async function initFromUrl() {
  if (persistenceStarted) return // idempotent — already initialized (guards the async window)
  persistenceStarted = true
  const hash = location.hash
  if (hash.startsWith(SET_PREFIX)) {
    try {
      const { families: fams, active } = await decodeSetHash(hash)
      const activeFam = fams.find((f) => f.name === active) ?? fams[0]
      batch(() => {
        families.value = fams
        activeFamily.value = active
        spec.value = activeFam.spec
      })
    } catch (e) {
      applyDecodeError(e)
    }
  } else if (hash.startsWith(HASH_PREFIX)) {
    // Legacy single-spec link — load the active spec; the seeded family set stays.
    try {
      spec.value = parseSpec(JSON.parse(decodeURIComponent(atob(hash.slice(HASH_PREFIX.length)))))
    } catch (e) {
      applyDecodeError(e)
    }
  } else if (hash !== '' && hash !== '#') {
    // A non-empty hash that isn't a payload is a mangled share-link, not an anchor
    // (this app has none) — surface it rather than silently default (AP4 honesty).
    batch(() => {
      spec.value = BOOT_SPEC
      lastError.value = {
        message: `unrecognized URL hash (expected '${SET_PREFIX}…' or '${HASH_PREFIX}…') — showing defaults`,
      }
    })
  } else {
    spec.value = BOOT_SPEC // no hash → the studio default (scale 25)
  }
  // R-7: boot SEEDS the history baseline — nothing before it is undoable.
  batch(() => {
    if (undoStack.peek().length > 0) undoStack.value = []
    if (redoStack.peek().length > 0) redoStack.value = []
  })
  lastCommitAt = -Infinity
  let firstRun = true
  persistenceDispose = effect(
    () => {
      void currentSet.value // subscribe to the WHOLE set (families + activeFamily + live spec)
      if (firstRun) {
        firstRun = false // boot state came FROM the URL — don't rewrite it
        return
      }
      if (syncTimer != null) clearTimeout(syncTimer)
      syncTimer = setTimeout(() => {
        syncTimer = null
        pendingSync = encodeSetHash(currentSet.peek(), activeFamily.peek()).then((h) => {
          history.replaceState(null, '', h)
        })
      }, SYNC_DEBOUNCE_MS)
    },
    { label: 'store:url-hash-sync' },
  )
}

/** Test hook: the in-flight debounced hash write (gzip is async, so a faked-timer
 *  advance only STARTS it — await this to let `replaceState` land). */
export function _flushSyncForTests() {
  return pendingSync ?? Promise.resolve()
}

/** Test hook: decode a `#set=` hash → { families, active } (inverse of the share
 *  encoder). @param {string} hash */
export function _decodeSetForTests(hash) {
  return decodeSetHash(hash)
}

/** Test hook: tear down the persistence effect AND its pending debounce timer
 *  (nothing may fire after this returns), then restore defaults — or `s`, which
 *  must itself satisfy the invariant (validated; throws on a bad test fixture).
 *  @param {PaletteSpec} [s] */
export function _resetForTests(s) {
  if (persistenceDispose != null) {
    persistenceDispose()
    persistenceDispose = null
  }
  persistenceStarted = false // re-arm the async-boot idempotency guard for the next initFromUrl
  pendingSync = null
  if (syncTimer != null) {
    clearTimeout(syncTimer)
    syncTimer = null
  }
  const next = s ?? defaultSpec(DEFAULT_HUE, DEFAULT_COUNT)
  validateSpec(next)
  tentCoupling = null // D-24 gesture bookkeeping is ephemeral — never survives a reset
  errorSeq = 0 // the I-4 ring's `at` counter restarts with the ring — determinism
  now = realNow // R-7: restore the real clock (undoes any _setNowForTests)
  lastCommitAt = -Infinity // …and the coalescing window — the next commit opens a fresh entry
  timeTravel = false // defensive: a throwing test mid-undo must not leak the flag
  batch(() => {
    spec.value = next
    // D-33: re-seed the family set, with the active=brand family = the reset spec.
    families.value = defaultPaletteSet(DEFAULT_HUE, { scale: DEFAULT_SCALE }).map((f) =>
      f.name === DEFAULT_FAMILY ? { name: DEFAULT_FAMILY, spec: next } : f,
    )
    activeFamily.value = DEFAULT_FAMILY
    view.value = { canvasMode: 'overlay', activeChannel: 'L' }
    dropped.value = []
    relocated.value = []
    lastError.value = null
    errorLog.value = []
    undoStack.value = [] // R-7: history never survives a reset
    redoStack.value = []
  })
}
