/**
 * <cr-palette-overview> — all families at a glance (D-33): one stacked strip per
 * family, side by side, so the whole palette set reads as a system. Read-only
 * (the editor is the canvas/strip above), except clicking a row selects that
 * family for editing. Rebuilds on any committed edit via a coalesced effect —
 * 8 families × ~11–37 cheap generate() calls, not a 60 fps surface, so an
 * innerHTML rebuild is fine (mirrors the export panel's APCA-table pattern).
 */
import { UIElement, html, css } from '@curve-ramp/base'
import { generate } from '@curve-ramp/curve-engine'
import * as store from '../store.js'

const oklch = (/** @type {{L:number,C:number,H:number}} */ o) =>
  `oklch(${o.L.toFixed(4)} ${o.C.toFixed(4)} ${o.H.toFixed(2)})`

export class CrPaletteOverview extends UIElement {
  static template = () => html`
    <details data-overview open>
      <summary>All families (overview)</summary>
      <div data-rows></div>
    </details>
  `

  static styles = css`
    cr-palette-overview [data-rows] {
      display: grid;
      gap: var(--space-1);
      margin-block-start: var(--space-2);
    }
    cr-palette-overview .row {
      display: grid;
      grid-template-columns: var(--space-8) 1fr;
      align-items: center;
      gap: var(--space-2);
      cursor: pointer;
      border: 1px solid transparent;
      border-radius: var(--radius-2);
      padding: var(--space-1);
    }
    cr-palette-overview .row[aria-current='true'] {
      border-color: var(--color-accent);
    }
    cr-palette-overview .row:focus-visible {
      outline: var(--space-1) solid var(--color-accent);
      outline-offset: var(--space-1);
    }
    cr-palette-overview .label {
      font-size: var(--text-sm);
      color: var(--color-text-muted);
      text-transform: capitalize;
    }
    cr-palette-overview .strip {
      display: flex;
      block-size: var(--space-6);
      border-radius: var(--radius-1);
      overflow: hidden;
    }
    cr-palette-overview .cell {
      flex: 1;
    }
  `

  connected() {
    const rows = /** @type {HTMLElement} */ (this.first('[data-rows]'))
    // Rebuild on any committed edit (currentSet reflects the active family live).
    this.effect(() => {
      const set = store.currentSet.value
      const active = store.activeFamily.value
      rows.innerHTML = set
        .map((f) => {
          const cells = generate(f.spec)
            .swatches.map((s) => `<span class="cell" style="background:${oklch(s.oklch)}" title="${f.name}-${s.key}"></span>`)
            .join('')
          return `<div class="row" data-row="${f.name}" role="button" tabindex="0" aria-current="${f.name === active}"><span class="label">${f.name}</span><div class="strip">${cells}</div></div>`
        })
        .join('')
    })
    // Click / Enter a row → edit that family (delegated; rows are rebuilt).
    const pick = (/** @type {Event} */ e) => {
      const row = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-row]'))
      if (row?.dataset.row) store.selectFamily(row.dataset.row)
    }
    this.on(rows, 'click', pick)
    this.on(rows, 'keydown', (e) => {
      const ke = /** @type {KeyboardEvent} */ (e)
      if (ke.key === 'Enter' || ke.key === ' ') {
        ke.preventDefault()
        pick(e)
      }
    })
  }
}

customElements.define('cr-palette-overview', CrPaletteOverview)
