/**
 * <cr-seed-controls> — hue input + count slider (PLAN §3.4, M3.2; SPEC §10
 * seed-input states: *default*, *editing hue*, *editing count*, *error*).
 *
 * Invalid input never reaches the engine invalid (SPEC §10):
 * - hue accepts ANY finite number — the store wraps mod 360 (the one
 *   sanctioned coercion); blank/NaN text is simply not dispatched.
 * - count is a range input whose INTERACTIVE bound is [2, 24] (the studio UI
 *   bound, PLAN §3.4 — the engine's D-11 ceiling of 91 stays an engine
 *   concern). A URL-hash spec with count 25–91 loads + renders (parseSpec
 *   accepts it), so the slider `max` is widened reactively to the bound count
 *   (`Math.max(24, count)`) — otherwise the thumb pegs at 24 while the readout
 *   shows the true count, an I-31 display lie. The interactive cap stays 24:
 *   the `input` handler ignores values >24 (only a link-loaded spec, never a
 *   user drag, can push the thumb past 24 once `max` is widened). Expanding the
 *   INTERACTIVE cap beyond 24 is ROADMAP R-15 [needs-intent] — not decided here
 *   (see plan/briefs/R-15-count-ui-beyond-24.md, Option 1: the cheapest
 *   reversible default — fix the mismatch, keep the cap).
 *
 * The wrapped hue is reflected back into the field, but never while the
 * user is mid-edit: the reflect effect skips while the input holds focus,
 * and the 'change' event (blur / Enter commit) catches the field back up
 * so a focused-through edit can never leave it desynced (council #6).
 */
import { UIElement, html, css } from '@curve-ramp/base'
import * as store from '../store.js'

/** Interactive slider cap (I-10, by-design; PLAN §3.4). The engine's D-11
 *  ceiling is 91; lifting this UI cap is ROADMAP R-15 [needs-intent]. */
const COUNT_UI_CAP = 24

export class CrSeedControls extends UIElement {
  static template = () => html`
    <label>
      <span>Hue</span>
      <input name="hue" type="number" step="1" inputmode="numeric" autocomplete="off">
    </label>
    <label>
      <span>Count</span>
      <input name="count" type="range" min="2" max="24" step="1">
    </label>
    <output data-count-readout aria-label="swatch count"></output>
    <fieldset data-scales>
      <legend>Scale</legend>
      <button type="button" class="cr-btn" data-scale="11" title="050–950 (coarse, no surface steps)">11</button>
      <button type="button" class="cr-btn" data-scale="25" title="semantic-complete — every role lands exact (default)">25</button>
      <button type="button" class="cr-btn" data-scale="37" title="every 25, 050–950">37</button>
    </fieldset>
    <fieldset data-light>
      <legend title="global min/max lightness (Lr %) — applied to every family">Lightness %</legend>
      <label><span>Min</span><input name="lmin" type="number" min="0" max="99" step="1" inputmode="numeric" autocomplete="off"></label>
      <label><span>Max</span><input name="lmax" type="number" min="1" max="100" step="1" inputmode="numeric" autocomplete="off"></label>
    </fieldset>
  `

  static styles = css`
    cr-seed-controls {
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      gap: var(--space-5);
    }
    cr-seed-controls label {
      display: grid;
      gap: var(--space-1);
      font-size: var(--text-sm);
      color: var(--color-text-muted);
    }
    cr-seed-controls input[name='hue'] {
      inline-size: calc(var(--space-8) * 2);
      padding: var(--space-1) var(--space-2);
      background: var(--color-surface-raised);
      color: var(--color-text);
      border: 1px solid var(--color-text-muted);
      border-radius: var(--radius-2);
    }
    cr-seed-controls input[name='count'] {
      inline-size: calc(var(--space-8) * 3);
      accent-color: var(--color-accent);
    }
    cr-seed-controls [data-count-readout] {
      font-variant-numeric: tabular-nums;
      color: var(--color-text);
      padding-block-end: var(--space-1);
    }
    cr-seed-controls fieldset[data-scales] {
      display: flex;
      align-items: center;
      gap: var(--space-1);
      border: 0;
      margin: 0;
      padding: 0;
    }
    cr-seed-controls fieldset[data-scales] legend {
      float: left;
      font-size: var(--text-sm);
      color: var(--color-text-muted);
      padding-inline-end: var(--space-2);
    }
    cr-seed-controls [data-scale][aria-pressed='true'] {
      background: var(--color-accent);
      color: var(--color-surface);
      border-color: var(--color-accent);
    }
    cr-seed-controls fieldset[data-light] {
      display: flex;
      align-items: end;
      gap: var(--space-2);
      border: 0;
      margin: 0;
      padding: 0;
    }
    cr-seed-controls fieldset[data-light] legend {
      float: left;
      font-size: var(--text-sm);
      color: var(--color-text-muted);
      padding-inline-end: var(--space-2);
    }
    cr-seed-controls input[name='lmin'],
    cr-seed-controls input[name='lmax'] {
      inline-size: calc(var(--space-8) * 1.4);
      padding: var(--space-1) var(--space-2);
      background: var(--color-surface-raised);
      color: var(--color-text);
      border: 1px solid var(--color-text-muted);
      border-radius: var(--radius-2);
    }
  `

  connected() {
    const hue = /** @type {HTMLInputElement} */ (this.first('input[name="hue"]'))
    const count = /** @type {HTMLInputElement} */ (this.first('input[name="count"]'))
    const readout = /** @type {HTMLElement} */ (this.first('[data-count-readout]'))

    // Reflect the store's (wrapped) hue into the field — tracked read FIRST so
    // the subscription exists regardless of focus; skip the write mid-edit.
    // The focus-guard alone never catches up after the edit (council #6), so
    // 'change' (blur / Enter commit) re-runs the same reflect unconditionally.
    const reflectHue = (/** @type {number} */ h) => {
      hue.value = String(h)
    }
    this.effect(() => {
      const h = store.spec.value.hue
      if (document.activeElement === hue) return
      reflectHue(h)
    })
    this.on(hue, 'change', () => reflectHue(store.spec.peek().hue))

    // I-31: a range input clamps its `value` to its current `max`, so a
    // link-loaded count of 25–91 would peg the thumb at 24 while the readout
    // shows the truth — a display-only lie (R-15 brief, Option 1). Widen `max`
    // to the bound count BEFORE the value bind runs (bind effects fire in
    // registration order; the browser would otherwise re-clamp the value) so
    // the THUMB position is honest, and mirror the true count into
    // `aria-valuetext` for assistive tech. This never lifts the INTERACTIVE
    // cap — a user can still only reach 24 (the `input` handler below ignores
    // anything past it); only a loaded spec moves the thumb beyond.
    this.bindProp(count, 'max', () => String(Math.max(COUNT_UI_CAP, store.spec.value.count)))
    this.bindProp(count, 'value', () => String(store.spec.value.count))
    this.bindAttr(count, 'aria-valuetext', () => String(store.spec.value.count))
    this.bindText(readout, () => store.spec.value.count)

    this.on(hue, 'input', () => {
      const raw = hue.value.trim()
      const v = Number(raw)
      if (raw === '' || !Number.isFinite(v)) return // invalid text never dispatched (SPEC §10)
      store.setHue(v) // any finite number — store wraps mod 360
    })
    this.on(count, 'input', () => {
      const n = Number(count.value)
      // The interactive cap is COUNT_UI_CAP (I-10, by-design). When a loaded
      // spec has widened `max` past it, the thumb CAN sit at >24, but a user
      // drag must not COMMIT a higher count (that is R-15, [needs-intent]).
      // Ignore the out-of-cap value and reflect the bound count back into the
      // field so the thumb snaps to the live max — never a silent partial edit.
      if (n > COUNT_UI_CAP) {
        count.value = String(store.spec.peek().count)
        return
      }
      store.setCount(n) // range enforces [2, COUNT_UI_CAP] for direct input
    })

    // Fixed scale presets (D-32): 11/25/37 → withScale (adds stops for 25/37).
    // Active state mirrors store.scaleOf; a bespoke slider count leaves all off.
    for (const btn of /** @type {NodeListOf<HTMLButtonElement>} */ (this.querySelectorAll('[data-scale]'))) {
      const id = /** @type {import('@curve-ramp/curve-engine').ScaleId} */ (Number(btn.dataset.scale))
      this.on(btn, 'click', () => store.setScale(id))
      this.bindAttr(btn, 'aria-pressed', () => String(store.scaleOf(store.spec.value) === id))
    }

    // Global lightness range (D-37): Lr min/max as %, applied to EVERY family.
    // Reflect the committed range into the fields (skip the focused one mid-edit,
    // like the hue reflect); a 'change' (blur/Enter) re-syncs a rejected value.
    const lmin = /** @type {HTMLInputElement} */ (this.first('input[name="lmin"]'))
    const lmax = /** @type {HTMLInputElement} */ (this.first('input[name="lmax"]'))
    const pct = (/** @type {number} */ lr) => String(Math.round(lr * 100))
    this.effect(() => {
      const { min, max } = store.lightRange.value
      if (document.activeElement !== lmin) lmin.value = pct(min)
      if (document.activeElement !== lmax) lmax.value = pct(max)
    })
    // Commit only a VALID pair (0 ≤ min < max ≤ 100); an invalid intermediate
    // (blank, NaN, min ≥ max, out of range) is held, not dispatched — the engine's
    // min < max rule is the backstop, and 'change' reflects the field back.
    const commitLight = () => {
      const lo = Number(lmin.value)
      const hi = Number(lmax.value)
      if (lmin.value.trim() === '' || lmax.value.trim() === '') return
      if (!(Number.isFinite(lo) && Number.isFinite(hi) && lo >= 0 && hi <= 100 && lo < hi)) return
      store.setLightRange(lo / 100, hi / 100)
    }
    this.on(lmin, 'input', commitLight)
    this.on(lmax, 'input', commitLight)
    this.on(lmin, 'change', () => (lmin.value = pct(store.lightRange.peek().min)))
    this.on(lmax, 'change', () => (lmax.value = pct(store.lightRange.peek().max)))
  }
}

customElements.define('cr-seed-controls', CrSeedControls)
