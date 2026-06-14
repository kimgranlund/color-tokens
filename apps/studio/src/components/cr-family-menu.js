/**
 * <cr-family-menu> — the multi-family selector (D-33). A row of tabs, one per
 * family in the palette set; clicking one makes it the active family that the
 * editor (seed controls / canvas / picker) edits. A small dot previews each
 * family's mid color. The "Re-derive" button re-seeds the derived families
 * (neutral/secondary/tertiary) from the current brand hue (the D-24 gesture —
 * not a live cascade). Family editing rides on the existing spec-centric store:
 * `selectFamily` swaps the active family in/out of the live `spec`.
 */
import { UIElement, html, css } from '@curve-ramp/base'
import { generate } from '@curve-ramp/curve-engine'
import * as store from '../store.js'

/** Mid (key '500', else the middle stop) color of a family spec, as an oklch()
 *  string for the preview dot. @param {import('@curve-ramp/curve-engine').PaletteSpec} spec */
function midColor(spec) {
  const sw = generate(spec).swatches
  const m = sw.find((s) => s.key === '500') ?? sw[Math.floor(sw.length / 2)]
  return m ? `oklch(${m.oklch.L.toFixed(4)} ${m.oklch.C.toFixed(4)} ${m.oklch.H.toFixed(2)})` : 'transparent'
}

export class CrFamilyMenu extends UIElement {
  static template = () => html`
    <nav data-families aria-label="Palette families">
      <button type="button" class="cr-btn" data-family="neutral"><span class="dot" aria-hidden="true"></span>neutral</button>
      <button type="button" class="cr-btn" data-family="primary"><span class="dot" aria-hidden="true"></span>primary</button>
      <button type="button" class="cr-btn" data-family="secondary"><span class="dot" aria-hidden="true"></span>secondary</button>
      <button type="button" class="cr-btn" data-family="tertiary"><span class="dot" aria-hidden="true"></span>tertiary</button>
      <button type="button" class="cr-btn" data-family="info"><span class="dot" aria-hidden="true"></span>info</button>
      <button type="button" class="cr-btn" data-family="success"><span class="dot" aria-hidden="true"></span>success</button>
      <button type="button" class="cr-btn" data-family="warning"><span class="dot" aria-hidden="true"></span>warning</button>
      <button type="button" class="cr-btn" data-family="danger"><span class="dot" aria-hidden="true"></span>danger</button>
      <button type="button" class="cr-btn" data-rederive
        title="re-seed neutral / secondary / tertiary from the current brand hue">Re-derive</button>
    </nav>
  `

  static styles = css`
    cr-family-menu nav[data-families] {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-1);
    }
    cr-family-menu [data-family] {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      text-transform: capitalize;
    }
    cr-family-menu .dot {
      inline-size: var(--space-3);
      block-size: var(--space-3);
      border-radius: 50%;
      border: 1px solid var(--color-text-muted);
      background: var(--color-surface);
    }
    cr-family-menu [data-family][aria-pressed='true'] {
      background: var(--color-accent);
      color: var(--color-surface);
      border-color: var(--color-accent);
    }
    cr-family-menu [data-rederive] {
      margin-inline-start: var(--space-3);
    }
  `

  connected() {
    for (const btn of /** @type {NodeListOf<HTMLButtonElement>} */ (this.querySelectorAll('[data-family]'))) {
      const name = /** @type {string} */ (btn.dataset.family)
      this.on(btn, 'click', () => store.selectFamily(name))
      this.bindAttr(btn, 'aria-pressed', () => String(store.activeFamily.value === name))
      const dot = /** @type {HTMLElement} */ (btn.querySelector('.dot'))
      // Preview each family's mid color from the LIVE set (active reflects edits).
      // Bound on `background` directly (a dynamic color is not a semantic token —
      // it must not appear as a var() in the css`` template; T3).
      this.bindStyle(dot, 'background', () => {
        const fam = store.currentSet.value.find((f) => f.name === name)
        return fam ? midColor(fam.spec) : 'transparent'
      })
    }
    const rederive = /** @type {HTMLButtonElement} */ (this.first('[data-rederive]'))
    this.on(rederive, 'click', () => store.reDeriveFromBrand())
  }
}

customElements.define('cr-family-menu', CrFamilyMenu)
