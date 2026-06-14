/**
 * <cr-channel-legend> — Lightness · Chroma · Hue switcher + overlay/single
 * toggle (PLAN M4.2/M4.8; SPEC §8.1: "the legend doubles as the channel
 * switcher"). Color-coded dots use the --curve-* semantic tokens, matching
 * the canvas strokes.
 *
 * Active state is expressed via aria-pressed (toggle-button semantics) and
 * styled off the attribute. Clicking a channel calls store.setActiveChannel;
 * the mode button flips store.setCanvasMode between overlay and single. Its
 * label is STATE-BEARING — 'Mode: overlay' / 'Mode: single' (D-21 #10: the
 * old static 'Single mode' text read as a caption, not a control) — and all
 * buttons here wear the shared `.cr-btn` pill chrome from the tokens GLOBAL
 * layer (D-21 #12), keeping only state styling in this component.
 * D-7a's click-CURVE-to-activate is the M4.3 interaction layer's job — this
 * component wires the legend path only, plus the SPEC §8.1 muted hint
 * "(click a curve to edit)" that makes that path discoverable (council
 * MAJOR #3).
 */
import { UIElement, html, css } from '@curve-ramp/base'
import * as store from '../store.js'

/** @typedef {import('@curve-ramp/curve-engine').Channel} Channel */

export class CrChannelLegend extends UIElement {
  static template = () => html`
    <div data-channels role="group" aria-label="Active channel">
      <button type="button" class="cr-btn" data-channel="L"><span data-dot aria-hidden="true"></span>Lightness</button>
      <button type="button" class="cr-btn" data-channel="C"><span data-dot aria-hidden="true"></span>Chroma</button>
      <button type="button" class="cr-btn" data-channel="H"><span data-dot aria-hidden="true"></span>Hue</button>
    </div>
    <span data-hint>(click a curve to edit)</span>
    <button type="button" class="cr-btn" data-mode-toggle>Mode: overlay</button>
  `

  static styles = css`
    cr-channel-legend {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
    }
    cr-channel-legend [data-channels] {
      display: flex;
      gap: var(--space-2);
    }
    /* Resting chrome comes from the shared .cr-btn recipe (tokens global
       layer, D-21 #12); only the pressed STATE lives here. */
    cr-channel-legend button[aria-pressed='true'] {
      color: var(--color-text);
      background: var(--color-surface-raised);
      border-color: var(--color-text-muted);
    }
    cr-channel-legend [data-dot] {
      inline-size: var(--space-2);
      block-size: var(--space-2);
      border-radius: var(--radius-4);
    }
    /* SPEC §8.1 "(click a curve to edit)" hint — discoverability for the
       D-7a click-curve-to-activate path (council MAJOR #3). */
    cr-channel-legend [data-hint] {
      color: var(--color-text-muted);
      font-size: var(--text-sm);
    }
    cr-channel-legend [data-channel='L'] [data-dot] {
      background: var(--curve-l);
    }
    cr-channel-legend [data-channel='C'] [data-dot] {
      background: var(--curve-c);
    }
    cr-channel-legend [data-channel='H'] [data-dot] {
      background: var(--curve-h);
    }
  `

  connected() {
    for (const btn of this.all('[data-channel]')) {
      const ch = /** @type {Channel} */ (btn.getAttribute('data-channel'))
      this.bindAttr(btn, 'aria-pressed', () => String(store.view.value.activeChannel === ch))
      this.on(btn, 'click', () => store.setActiveChannel(ch))
    }
    const toggle = /** @type {HTMLElement} */ (this.first('[data-mode-toggle]'))
    // D-21 #10: state-bearing label — the button names the CURRENT mode;
    // aria-pressed (true = single) retains the toggle semantics.
    this.bindText(toggle, () => `Mode: ${store.view.value.canvasMode}`)
    this.bindAttr(toggle, 'aria-pressed', () => String(store.view.value.canvasMode === 'single'))
    this.on(toggle, 'click', () =>
      store.setCanvasMode(store.view.peek().canvasMode === 'single' ? 'overlay' : 'single'),
    )
  }
}

customElements.define('cr-channel-legend', CrChannelLegend)
