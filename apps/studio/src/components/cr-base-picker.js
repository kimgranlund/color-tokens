/**
 * <cr-base-picker> — base family dropdown + per-family param fields for the
 * ACTIVE channel (PLAN §3.4, M4.7; SPEC §6 "change base family/params",
 * SPEC §10 *error state*, D-3 `published` selectable).
 *
 * Families per channel (D-3 / SPEC §5.1; D-24 adds tent): L = smoothstep ·
 * linear · gamma · published; C = sine · tent · cusp-anchored · gamut-max ·
 * published; H = sine only (constant/drift). All eight <option>s exist once
 * in the scaffold — channel switches toggle [hidden]/[disabled] bindings,
 * never rebuild DOM (same for the per-family param fields), so focus and
 * identity survive re-binds.
 * For H the family select and param fields are hidden ENTIRELY (D-22): the
 * drift editor below is H's whole base UI.
 *
 * Validation lives in the ENGINE (SPEC §11: gamma > 0, falloff ∈ [0.5, 3]):
 * any typed value is dispatched through `store.setBase`, which validates and
 * either commits or records `lastError` with `spec` untouched. The invalid
 * states are deliberately REACHABLE here (SPEC §10: "gamma ≤ 0 … rejected"),
 * and the rejection surfaces inline in [data-picker-error] — the
 * field-adjacent twin of <cr-app>'s global region — filtered to errors whose
 * field sits under `channels.<active>.base`. Each new attempt calls
 * `clearError()` first, so a later valid change dismisses the message.
 *
 * Switching family applies engine-sane defaults immediately (live preview,
 * SPEC §6 top-down edit): gamma 2.2; cusp-anchored falloff 1.5; published
 * tailwind-v4; sine = the channel's `defaultSpec` shape (C bell
 * a=0.01,b=0.13,c=0.5,d=-0.25; H constant a=hue). Overrides + bézier are
 * preserved by `setBase` (AC A2 — edits stay local to their layer).
 * Re-selecting the CURRENT family is a no-op so tuned params never reset.
 *
 * Hue drift editor (D-22, supersedes the M5.4 "Hue drift" checkbox): hue
 * drift IS two endpoints and a shape, so the H section edits exactly that.
 * Two Δ° inputs — dark end (t=0) and light end (t=1), degrees RELATIVE to
 * spec.hue — bind to `store.hueDriftOf(spec)` (focus-guarded like the seed
 * hue input) and dispatch `store.setHueDrift(dark, light)`; the store owns
 * the sine representation (endpoints land at hue+Δdark / hue+Δlight) and
 * the engine validates — nothing is clamped here, rejections land in
 * lastError → [data-picker-error] (the channels.H.base field filter already
 * covers them). A preset chip row (0°, ±5° … ±25°) applies symmetric drift
 * setHueDrift(−x, +x); a chip is aria-pressed only when the H base IS sine
 * (C1-#2: a baked/lookup base presses nothing — hueDriftOf's {0,0} fallback
 * is not a 0° preset) AND hueDriftOf matches {−x, +x} exactly (±1e-9) —
 * custom/asymmetric values press nothing.
 * URL-loaded exotic H specs still render: the editor shows hueDriftOf's
 * derivation of the current endpoints.
 *
 * Tent family (D-24, C only): the [data-param="tent"] row edits the movable
 * Peak Chroma Point — `peak-t` (WHERE the most chromatic stop sits) and
 * `peak-c` (how much) — bound focus-guarded to `store.tentOf(spec)` and
 * dispatched UNCLAMPED through `store.setTent(patch)`; the engine validates
 * (peakT ∈ [0.02, 0.98], peakC > 0) and rejections land in lastError →
 * the channels.C.base field filter above already covers tent field paths.
 * The [data-tent-presets] row holds 'Center peak' (peakT 0.5) and 'Peak at
 * cusp' (peakT = store.cuspInfo().t — the stop with the most chroma
 * headroom); aria-pressed marks an exact peakT match (±1e-9). The flank
 * shapers (low/high) get NO picker fields — they are canvas-only handles
 * (D-24's 2D peak/flank affordances belong on the curve canvas; the panel
 * stays lean). DEFAULT_TENT's peakC 0.14 = the default sine bell's peak
 * (a + b = 0.01 + 0.13) — same perceived intensity, now movable (D-24).
 *
 * Layer ops (SPEC §6 optional ops, D-15 un-deferred): the [data-base-ops]
 * row offers the ACTIVE channel's 'Bake warp → base' (store.bakeWarp — folds
 * base⊗bézier into a lookup base, warp → identity, overrides preserved) and
 * 'Flatten channel' (store.flattenChannelAction — base ← current per-stop
 * output, overrides AND warp cleared). Bake DISABLES while the channel's
 * warp is the identity (store.isIdentityWarp) — a no-op "error" through
 * lastError would abuse the rejection surface — and its title FLIPS with the
 * same predicate (C1-#5: disabled = 'nothing to bake — drag the blue warp
 * handles first'; enabled = the fold text). Flatten destroys the override
 * layer by design and stays confirmation-free per SPEC §6 ("snapshot for
 * hand-off"): its `title` carries the warning, and the URL-hash history is
 * the undo — the previous state's shareable URL sits one Back away.
 *
 * Lookup display (R-3 / ISSUES I-2): bake/flatten leave the channel on a
 * `lookup` base, which is produced, never picked — so the family select
 * carries a permanently-DISABLED 'Lookup (baked)' option that exists for
 * REFLECTION only (visible while the active base IS a lookup; without it
 * `family.value = 'lookup'` matched nothing and the control went blank,
 * misrepresenting the spec). Its "param row" [data-param="lookup"] is a
 * read-only note (node count + the way out); switching to a real family
 * goes through the ordinary defaults path above.
 *
 * Baked-H drift display (ISSUES I-3): when the H base is not sine (flatten
 * H → lookup; URL exotics), hueDriftOf derives 0°/0° while a drifted baked
 * curve renders — misleading. The Δ° inputs DISABLE with a note — 'baked
 * curve (N nodes) — set a drift to rebuild' when the lookup length is known
 * (C1-#8), aria-describedby-associated with the inputs' wrapper while shown
 * (C4-#9) — and the preset chips stay enabled (setHueDrift rebuilds the
 * sine form — the documented escape hatch — re-enabling the inputs).
 */
import { UIElement, html, css } from '@curve-ramp/base'
import * as store from '../store.js'
// CHANNEL_LABELS: single source in cr-readout-chip (D-21 council #13 dedup —
// this file used to carry a private duplicate of the same record).
import { CHANNEL_LABELS } from './cr-readout-chip.js'

/** @typedef {import('@curve-ramp/curve-engine').Channel} Channel */
/** @typedef {import('@curve-ramp/curve-engine').BaseFamily} BaseFamily */

/** Families offered per channel (D-3; SPEC §5.1 use column; D-24 tent is
 *  C-only). @type {Record<Channel, string[]>} */
const FAMILIES = {
  L: ['smoothstep', 'linear', 'gamma', 'published'],
  C: ['sine', 'tent', 'cusp-anchored', 'gamut-max', 'published'],
  H: ['sine'],
}

/** Defaults applied when SWITCHING family — the spec has no params for a
 *  not-yet-applied family (M4.7). Sine mirrors `defaultSpec` (SPEC §8).
 *  @param {string} kind @param {Channel} ch @returns {BaseFamily | null} */
function defaultBaseFor(kind, ch) {
  switch (kind) {
    case 'linear':
      return { kind: 'linear' }
    case 'smoothstep':
      return { kind: 'smoothstep' }
    case 'gamut-max':
      return { kind: 'gamut-max' }
    case 'gamma':
      return { kind: 'gamma', gamma: 2.2 }
    case 'cusp-anchored':
      return { kind: 'cusp-anchored', falloff: 1.5 }
    case 'tent':
      // DEFAULT_TENT (D-24): peakC 0.14 = the default sine bell's peak
      // (a + b = 0.01 + 0.13) — same perceived intensity, now movable.
      // Peak centered; flanks at segment-local midpoints (straight eases).
      // Fresh literal each call — setBase spreads shallowly, so low/high
      // must never be shared module-level objects.
      return { kind: 'tent', peakT: 0.5, peakC: 0.14, low: { x: 0.5, y: 0.5 }, high: { x: 0.5, y: 0.5 } }
    case 'published':
      return { kind: 'published', system: 'tailwind-v4', channel: ch }
    case 'sine':
      return ch === 'H'
        ? { kind: 'sine', a: store.spec.peek().hue, b: 0, c: 0, d: 0 }
        : { kind: 'sine', a: 0.01, b: 0.13, c: 0.5, d: -0.25 }
    default:
      return null
  }
}

let headingUid = 0
let driftNoteUid = 0

export class CrBasePicker extends UIElement {
  static template = () => html`
    <h3 data-picker-heading></h3>
    <div data-fields>
      <label data-family>
        <span>Family</span>
        <select name="family">
          <option value="smoothstep">Smoothstep</option>
          <option value="linear">Linear</option>
          <option value="gamma">Gamma</option>
          <option value="sine">Sine</option>
          <option value="tent">Tent (peak control)</option>
          <option value="cusp-anchored">Cusp-anchored</option>
          <option value="gamut-max">Gamut-max</option>
          <option value="published">Published</option>
          <option value="lookup" disabled>Lookup (baked)</option>
        </select>
      </label>
      <p data-param="lookup" hidden></p>
      <label data-param="gamma" hidden>
        <span>Gamma</span>
        <input name="gamma" type="number" step="0.1" inputmode="decimal" autocomplete="off">
      </label>
      <div data-param="sine" hidden role="group" aria-label="Sine parameters">
        <label>
          <span>Offset a</span>
          <input name="a" type="number" step="0.01" inputmode="decimal" autocomplete="off">
        </label>
        <label>
          <span>Amplitude b</span>
          <input name="b" type="number" step="0.01" inputmode="decimal" autocomplete="off">
        </label>
        <label>
          <span>Frequency c</span>
          <input name="c" type="number" step="0.01" inputmode="decimal" autocomplete="off">
        </label>
        <label>
          <span>Phase d</span>
          <input name="d" type="number" step="0.01" inputmode="decimal" autocomplete="off">
        </label>
      </div>
      <div data-param="tent" hidden role="group" aria-label="Tent parameters">
        <label>
          <span>Peak position</span>
          <input name="peak-t" type="number" step="0.01" inputmode="decimal" autocomplete="off">
        </label>
        <label>
          <span>Peak chroma</span>
          <input name="peak-c" type="number" step="0.005" inputmode="decimal" autocomplete="off">
        </label>
        <div data-tent-presets role="group" aria-label="Tent presets">
          <button type="button" data-tent-preset="center">Center peak</button>
          <button type="button" data-tent-preset="cusp"
            title="move the peak to the stop with the most chroma headroom">Peak at cusp</button>
        </div>
      </div>
      <label data-param="falloff" hidden>
        <span>Falloff</span>
        <input name="falloff" type="number" step="0.1" inputmode="decimal" autocomplete="off">
      </label>
      <label data-param="published" hidden>
        <span>System</span>
        <select name="system">
          <option value="tailwind-v4">Tailwind v4</option>
          <option value="radix-3">Radix 3</option>
        </select>
      </label>
    </div>
    <div data-drift-editor hidden role="group" aria-label="Hue drift">
      <div data-drift-fields>
        <label>
          <span>Dark end Δ°</span>
          <input name="drift-dark" type="number" step="1" inputmode="decimal" autocomplete="off">
        </label>
        <label>
          <span>Light end Δ°</span>
          <input name="drift-light" type="number" step="1" inputmode="decimal" autocomplete="off">
        </label>
      </div>
      <p data-drift-note hidden>baked curve — set a drift to rebuild</p>
      <div data-drift-presets role="group" aria-label="Drift presets">
        <button type="button" data-preset="0">0°</button>
        <button type="button" data-preset="5">±5°</button>
        <button type="button" data-preset="10">±10°</button>
        <button type="button" data-preset="15">±15°</button>
        <button type="button" data-preset="20">±20°</button>
        <button type="button" data-preset="25">±25°</button>
      </div>
    </div>
    <div data-base-ops role="group" aria-label="Channel layer operations">
      <button type="button" class="cr-btn" data-op="bake"
        title="fold the warp into this channel's base (a lookup); overrides stay">Bake warp → base</button>
      <button type="button" class="cr-btn" data-op="flatten"
        title="replaces this channel's base with its current output; clears overrides and the warp — the shareable URL preserves the previous state in your browser history">Flatten channel</button>
    </div>
    <p data-picker-error role="alert" hidden></p>
  `

  static styles = css`
    cr-base-picker {
      display: grid;
      gap: var(--space-3);
    }
    cr-base-picker [data-picker-heading] {
      margin: 0;
      font-size: var(--text-sm);
      font-weight: normal;
      color: var(--color-text-muted);
    }
    cr-base-picker [data-fields] {
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      gap: var(--space-4);
    }
    /* [hidden] always wins — display is only forced on :not([hidden]). */
    cr-base-picker label:not([hidden]) {
      display: grid;
      gap: var(--space-1);
      font-size: var(--text-sm);
      color: var(--color-text-muted);
    }
    cr-base-picker [data-param='sine']:not([hidden]) {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
    }
    /* D-24 tent param row — peak fields + preset pair (flank shapers are
       canvas-only; no fields here). [hidden] always wins, as above. */
    cr-base-picker [data-param='tent']:not([hidden]) {
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      gap: var(--space-3);
    }
    cr-base-picker [data-tent-presets] {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
    /* Lookup read-only row (R-3 / I-2) + the baked-H drift note (I-3): muted
       informational text, no fields. [hidden] hides via the UA sheet — no
       display override exists on <p> to fight it. */
    cr-base-picker [data-param='lookup'],
    cr-base-picker [data-drift-note] {
      margin: 0;
      align-self: center;
      font-size: var(--text-sm);
      color: var(--color-text-muted);
    }
    /* Disabled drift inputs (I-3 baked state) — match .cr-btn:disabled. */
    cr-base-picker input:disabled {
      opacity: 0.4;
      cursor: default;
    }
    /* D-22 hue drift editor — endpoint Δ° fields + preset chip row.
       [hidden] always wins; display is only forced on :not([hidden]). */
    cr-base-picker [data-drift-editor]:not([hidden]) {
      display: grid;
      gap: var(--space-3);
    }
    cr-base-picker [data-drift-fields] {
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      gap: var(--space-4);
    }
    cr-base-picker [data-drift-presets] {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
    /* Layer-ops row (D-15 un-deferred) — resting chrome comes from the shared
       .cr-btn recipe (tokens global layer, D-21 #12); only layout lives here. */
    cr-base-picker [data-base-ops] {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
    cr-base-picker [data-drift-presets] button,
    cr-base-picker [data-tent-presets] button {
      padding: var(--space-1) var(--space-2);
      background: var(--color-surface-raised);
      color: var(--color-text-muted);
      border: 1px solid var(--color-text-muted);
      border-radius: var(--radius-2);
      font-size: var(--text-sm);
      cursor: pointer;
    }
    cr-base-picker [data-drift-presets] button[aria-pressed='true'],
    cr-base-picker [data-tent-presets] button[aria-pressed='true'] {
      color: var(--color-text);
      border-color: var(--color-accent);
    }
    cr-base-picker select,
    cr-base-picker input {
      padding: var(--space-1) var(--space-2);
      background: var(--color-surface-raised);
      color: var(--color-text);
      border: 1px solid var(--color-text-muted);
      border-radius: var(--radius-2);
      font-size: var(--text-sm);
    }
    cr-base-picker input[type='number'] {
      inline-size: calc(var(--space-8) * 2);
    }
    /* SPEC §10 error state — field-adjacent inline surface (cr-app pattern). */
    cr-base-picker [data-picker-error]:not([hidden]) {
      display: block;
    }
    cr-base-picker [data-picker-error] {
      margin: 0;
      padding: var(--space-1) var(--space-2);
      background: var(--color-surface-raised);
      border-inline-start: 2px solid var(--color-warning);
      border-radius: var(--radius-2);
      color: var(--color-text);
      font-size: var(--text-sm);
    }
  `

  connected() {
    const heading = /** @type {HTMLElement} */ (this.first('[data-picker-heading]'))
    const family = /** @type {HTMLSelectElement} */ (this.first('select[name="family"]'))
    const system = /** @type {HTMLSelectElement} */ (this.first('select[name="system"]'))
    const gamma = /** @type {HTMLInputElement} */ (this.first('input[name="gamma"]'))
    const falloff = /** @type {HTMLInputElement} */ (this.first('input[name="falloff"]'))
    const sine = /** @type {Record<'a'|'b'|'c'|'d', HTMLInputElement>} */ ({
      a: this.first('input[name="a"]'),
      b: this.first('input[name="b"]'),
      c: this.first('input[name="c"]'),
      d: this.first('input[name="d"]'),
    })
    const peakT = /** @type {HTMLInputElement} */ (this.first('input[name="peak-t"]'))
    const peakC = /** @type {HTMLInputElement} */ (this.first('input[name="peak-c"]'))
    const errorRegion = /** @type {HTMLElement} */ (this.first('[data-picker-error]'))

    // a11y: the element is a labeled group; the heading is its accessible name.
    if (!heading.id) heading.id = `cr-base-picker-heading-${headingUid++}`
    this.setAttribute('role', 'group')
    this.setAttribute('aria-labelledby', heading.id)

    /** @returns {Channel} */
    const active = () => store.view.value.activeChannel
    /** Current spec base for the active channel (tracked read). @returns {BaseFamily} */
    const activeBase = () => store.spec.value.channels[active()].base

    this.bindText(heading, () => `Base — ${CHANNEL_LABELS[active()]}`)

    // Family options: one scaffold, per-channel availability via bindings
    // ([hidden] + [disabled] — no DOM churn on channel switch).
    // 'Lookup (baked)' (R-3 / ISSUES I-2) is REFLECT-ONLY: bake/flatten
    // produce a lookup base, users never switch TO one — the template
    // hardcodes [disabled] (no binding to fight it) and visibility tracks
    // whether the ACTIVE base IS a lookup, so after a bake/flatten the
    // select shows the truth instead of going blank (the I-2 misrender).
    for (const opt of /** @type {HTMLOptionElement[]} */ (this.all('select[name="family"] option'))) {
      if (opt.value === 'lookup') {
        this.bindAttr(opt, 'hidden', () => activeBase().kind !== 'lookup')
        continue
      }
      this.bindAttr(opt, 'hidden', () => !FAMILIES[active()].includes(opt.value))
      this.bindAttr(opt, 'disabled', () => !FAMILIES[active()].includes(opt.value))
    }

    // D-22: H has no family choice in this UI — the drift editor IS the H
    // base surface, so the whole Family row hides with the param fields.
    const familyRow = /** @type {HTMLElement} */ (this.first('label[data-family]'))
    this.bindAttr(familyRow, 'hidden', () => active() === 'H')

    // Select ← spec family for the active channel; re-binds on channel switch.
    // Tracked reads FIRST, then the focus guard (cr-seed-controls pattern).
    this.effect(() => {
      const kind = activeBase().kind
      if (document.activeElement === family) return
      family.value = kind
    })

    // Param-field visibility follows the SPEC's current family ([hidden]
    // bindings — switching family commits immediately, so spec is the truth).
    // On H every param field hides (D-22) — even for a URL-loaded exotic H
    // base, the drift editor shows hueDriftOf's derivation instead.
    const paramFor = /** @type {Record<string, string>} */ ({
      gamma: 'gamma',
      sine: 'sine',
      tent: 'tent',
      'cusp-anchored': 'falloff',
      published: 'published',
      lookup: 'lookup',
    })
    for (const el of this.all('[data-param]')) {
      this.bindAttr(el, 'hidden', () =>
        active() === 'H' || paramFor[activeBase().kind] !== el.getAttribute('data-param'))
    }

    // Lookup param row (R-3 / I-2): READ-ONLY — a lookup base has no editable
    // params here (its values came from a bake/flatten; the way out is
    // picking a real family, which applies that family's defaults via the
    // ordinary switch path below). Node count = the lookup table's length
    // (65 for bakes — the engine's BAKE_SAMPLES grid; `count` for flattens).
    const lookupRow = /** @type {HTMLElement} */ (this.first('[data-param="lookup"]'))
    this.bindText(lookupRow, () => {
      const b = activeBase()
      return b.kind === 'lookup'
        ? `${b.values.length} nodes · from bake/flatten — pick a family to replace`
        : ''
    })

    // Param values ← spec (focus-guarded so mid-edit text is never clobbered).
    /** @param {HTMLInputElement | HTMLSelectElement} input @param {() => string} read */
    const reflect = (input, read) => {
      this.effect(() => {
        const v = read() // tracked read first — subscription exists regardless of focus
        if (document.activeElement === input) return
        input.value = v
      })
    }
    reflect(gamma, () => {
      const b = activeBase()
      return b.kind === 'gamma' ? String(b.gamma) : ''
    })
    reflect(falloff, () => {
      const b = activeBase()
      return b.kind === 'cusp-anchored' ? String(b.falloff) : ''
    })
    for (const k of /** @type {const} */ (['a', 'b', 'c', 'd'])) {
      reflect(sine[k], () => {
        const b = activeBase()
        return b.kind === 'sine' ? String(b[k]) : ''
      })
    }
    reflect(system, () => {
      const b = activeBase()
      return b.kind === 'published' ? b.system : 'tailwind-v4'
    })
    // Tent (D-24): tentOf is the store's derivation — tent | null. The
    // tracked spec read keeps the subscription alive even while null.
    // Display at 3 decimals — canvas drags write full float precision, which
    // is meaningless noise in a number field (the spec keeps the exact value;
    // typing dispatches the typed number unrounded).
    reflect(peakT, () => {
      const t = store.tentOf(store.spec.value)
      return t == null ? '' : String(Math.round(t.peakT * 1000) / 1000)
    })
    reflect(peakC, () => {
      const t = store.tentOf(store.spec.value)
      return t == null ? '' : String(Math.round(t.peakC * 1000) / 1000)
    })

    // Inline error (SPEC §10): lastError filtered to the active channel's base
    // fields — <cr-app>'s global region shows everything; this is the
    // field-adjacent surface. Hidden the moment the store clears or the error
    // belongs elsewhere.
    const pickerError = () => {
      const err = store.lastError.value
      if (err == null || err.field == null) return null
      return err.field.startsWith(`channels.${active()}.base`) ? err : null
    }
    this.bindAttr(errorRegion, 'hidden', () => pickerError() == null)
    this.bindText(errorRegion, () => pickerError()?.message ?? '')

    // ── Dispatch: build the BaseFamily from current fields → store.setBase ──
    // The store validates (engine `validateSpec`); invalid values land in
    // lastError with spec untouched. ANY typed value is dispatched — gamma ≤ 0
    // and falloff ∉ [0.5, 3] must be REACHABLE and rejected (SPEC §10, §11).

    this.on(family, 'change', () => {
      const ch = store.view.peek().activeChannel
      const current = store.spec.peek().channels[ch].base
      if (family.value === current.kind) return // re-pick of the current family: keep tuned params
      const base = defaultBaseFor(family.value, ch)
      if (base == null) return
      store.clearError() // new attempt — stale messages don't outlive it
      store.setBase(ch, base)
    })

    this.on(gamma, 'input', () => {
      store.clearError()
      store.setBase(store.view.peek().activeChannel, { kind: 'gamma', gamma: Number(gamma.value) })
    })

    this.on(falloff, 'input', () => {
      store.clearError()
      store.setBase(store.view.peek().activeChannel, {
        kind: 'cusp-anchored',
        falloff: Number(falloff.value),
      })
    })

    for (const k of /** @type {const} */ (['a', 'b', 'c', 'd'])) {
      this.on(sine[k], 'input', () => {
        store.clearError()
        store.setBase(store.view.peek().activeChannel, {
          kind: 'sine',
          a: Number(sine.a.value),
          b: Number(sine.b.value),
          c: Number(sine.c.value),
          d: Number(sine.d.value),
        })
      })
    }

    this.on(system, 'change', () => {
      const ch = store.view.peek().activeChannel
      store.clearError()
      store.setBase(ch, {
        kind: 'published',
        system: /** @type {'tailwind-v4' | 'radix-3'} */ (system.value),
        channel: ch,
      })
    })

    // ── Tent params + presets (D-24 — C only) ────────────────────────────────
    // Typed values dispatch UNCLAMPED through store.setTent: the engine
    // validates (peakT ∈ [0.02, 0.98], peakC > 0) and a rejection lands in
    // lastError with a channels.C.base.* field — the inline filter above
    // already covers it (SPEC §10: invalid states REACHABLE, surfaced).
    // low/high flank shapers have NO fields here — canvas-only handles.

    this.on(peakT, 'input', () => {
      store.clearError()
      store.setTent({ peakT: Number(peakT.value) })
    })

    this.on(peakC, 'input', () => {
      store.clearError()
      store.setTent({ peakC: Number(peakC.value) })
    })

    // Preset buttons: aria-pressed marks an EXACT peakT match (±1e-9, the
    // drift-chip convention). 'Peak at cusp' targets store.cuspInfo().t — the
    // stop with the most chroma headroom; the tracked tentOf read re-runs the
    // binding on every spec change, so a hue/count edit re-evaluates the match.
    const TENT_EPS = 1e-9
    const tentCenter = /** @type {HTMLButtonElement} */ (this.first('[data-tent-preset="center"]'))
    const tentCusp = /** @type {HTMLButtonElement} */ (this.first('[data-tent-preset="cusp"]'))
    this.bindAttr(tentCenter, 'aria-pressed', () => {
      const t = store.tentOf(store.spec.value)
      return t != null && Math.abs(t.peakT - 0.5) <= TENT_EPS ? 'true' : 'false'
    })
    this.bindAttr(tentCusp, 'aria-pressed', () => {
      const t = store.tentOf(store.spec.value)
      return t != null && Math.abs(t.peakT - store.cuspInfo().t) <= TENT_EPS ? 'true' : 'false'
    })
    this.on(tentCenter, 'click', () => {
      store.clearError()
      store.setTent({ peakT: 0.5 })
    })
    this.on(tentCusp, 'click', () => {
      store.clearError()
      store.setTent({ peakT: store.cuspInfo().t })
    })

    // ── Hue drift editor (D-22 — supersedes the M5.4 checkbox) ──────────────
    // H-section only. Endpoints are degrees RELATIVE to spec.hue (dark end
    // t=0, light end t=1): the inputs reflect store.hueDriftOf(spec) —
    // tracked read FIRST, write skipped mid-edit, 'change' (blur / Enter)
    // catches a focused-through edit back up (the seed-hue pattern) — and
    // 'input' dispatches store.setHueDrift(dark, light) UNCLAMPED: the store
    // owns the sine representation (endpoints land at hue+Δdark/hue+Δlight),
    // the engine validates, and rejections surface via the channels.H.base
    // filter above. Values are derived from the spec, never stored here.
    const driftEditor = /** @type {HTMLElement} */ (this.first('[data-drift-editor]'))
    const driftDark = /** @type {HTMLInputElement} */ (this.first('input[name="drift-dark"]'))
    const driftLight = /** @type {HTMLInputElement} */ (this.first('input[name="drift-light"]'))
    const driftNote = /** @type {HTMLElement} */ (this.first('[data-drift-note]'))
    this.bindAttr(driftEditor, 'hidden', () => active() !== 'H')

    // ISSUES I-3: a non-sine H base (flatten H → lookup; URL-loaded exotics)
    // makes hueDriftOf's 0°/0° derivation MISLEADING — a drifted (baked)
    // curve renders while the editor reads zero. So while the H base is not
    // sine the Δ° inputs DISABLE and the note shows; the preset chips stay
    // ENABLED — setHueDrift rebuilds the sine form, the documented escape
    // hatch, which re-enables the inputs on the next bind.
    const driftBaked = () => store.spec.value.channels.H.base.kind !== 'sine'
    this.bindAttr(driftDark, 'disabled', driftBaked)
    this.bindAttr(driftLight, 'disabled', driftBaked)
    this.bindAttr(driftNote, 'hidden', () => !driftBaked())
    // C1-#8: name the curve's resolution while we know it — a lookup base
    // carries its node count; any other non-sine exotic falls back to the
    // template's generic sentence.
    this.bindText(driftNote, () => {
      const b = store.spec.value.channels.H.base
      return b.kind === 'lookup'
        ? `baked curve (${b.values.length} nodes) — set a drift to rebuild`
        : 'baked curve — set a drift to rebuild'
    })
    // C4-#9: the note must be PROGRAMMATICALLY associated with the inputs it
    // explains — aria-describedby on their wrapper, present only while the
    // baked state shows the note (a hidden element referenced by
    // aria-describedby would still be read into the description otherwise).
    const driftFields = /** @type {HTMLElement} */ (this.first('[data-drift-fields]'))
    if (!driftNote.id) driftNote.id = `cr-base-picker-drift-note-${driftNoteUid++}`
    this.bindAttr(driftFields, 'aria-describedby', () => (driftBaked() ? driftNote.id : null))

    /** @param {HTMLInputElement} input @param {'dark' | 'light'} end */
    const bindDriftEnd = (input, end) => {
      this.effect(() => {
        const v = String(store.hueDriftOf(store.spec.value)[end]) // tracked read first
        if (document.activeElement === input) return
        input.value = v
      })
      this.on(input, 'change', () => {
        input.value = String(store.hueDriftOf(store.spec.peek())[end]) // commit catch-up
      })
      this.on(input, 'input', () => {
        store.clearError()
        store.setHueDrift(Number(driftDark.value), Number(driftLight.value))
      })
    }
    bindDriftEnd(driftDark, 'dark')
    bindDriftEnd(driftLight, 'light')

    // Preset chips: symmetric drift setHueDrift(−x, +x). aria-pressed marks
    // an EXACT {−x, +x} match (±1e-9) — custom/asymmetric presses nothing.
    // C1-#2: a BAKED (non-sine) H base presses nothing either — hueDriftOf's
    // {0, 0} there is a derivation fallback, not a 0° preset; claiming the 0°
    // chip under a drifted lookup curve was a lie. The chips stay CLICKABLE
    // (setHueDrift rebuilds the sine form — the documented escape hatch).
    const DRIFT_EPS = 1e-9
    for (const btn of /** @type {HTMLButtonElement[]} */ (this.all('[data-drift-presets] button'))) {
      const x = Number(btn.getAttribute('data-preset'))
      this.bindAttr(btn, 'aria-pressed', () => {
        if (driftBaked()) return 'false' // tracked read — re-arms when a preset rebuilds sine
        const d = store.hueDriftOf(store.spec.value)
        return Math.abs(d.dark + x) <= DRIFT_EPS && Math.abs(d.light - x) <= DRIFT_EPS
          ? 'true'
          : 'false'
      })
      this.on(btn, 'click', () => {
        store.clearError()
        store.setHueDrift(x === 0 ? 0 : -x, x) // 0° → (0, 0), never −0
      })
    }

    // ── Layer ops: bake / flatten (SPEC §6, D-15 un-deferred) ────────────────
    // Bake disables on an identity warp (nothing to bake — disabling beats a
    // no-op info message through lastError); after a bake the warp IS the
    // identity again, so the binding re-disables it naturally. Flatten is
    // always available and confirmation-free (SPEC §6 "snapshot for
    // hand-off") — its title carries the destructiveness warning + the
    // URL-history undo note. Both dispatch through the house pattern:
    // clearError at attempt start; engine rejections land in lastError.
    const bakeBtn = /** @type {HTMLButtonElement} */ (this.first('[data-op="bake"]'))
    const flattenBtn = /** @type {HTMLButtonElement} */ (this.first('[data-op="flatten"]'))
    this.bindAttr(bakeBtn, 'disabled', () =>
      store.isIdentityWarp(store.spec.value.channels[active()].bezier))
    // C1-#5: a disabled button must explain itself — the title flips with the
    // SAME isIdentityWarp read the disabled binding uses (enabled = the fold
    // text the template ships; disabled = why + the way out).
    this.bindAttr(bakeBtn, 'title', () =>
      store.isIdentityWarp(store.spec.value.channels[active()].bezier)
        ? 'nothing to bake — drag the blue warp handles first'
        : "fold the warp into this channel's base (a lookup); overrides stay")
    this.on(bakeBtn, 'click', () => {
      store.clearError()
      store.bakeWarp(store.view.peek().activeChannel)
    })
    this.on(flattenBtn, 'click', () => {
      store.clearError()
      store.flattenChannelAction(store.view.peek().activeChannel)
    })
  }
}

customElements.define('cr-base-picker', CrBasePicker)
