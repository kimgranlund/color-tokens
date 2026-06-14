/**
 * <cr-toast> — count-reconcile report toast (PLAN §3.4, M3.2; SPEC §6/§10
 * *editing count*: reconcileCount drops are reported, never silently lost —
 * AC A8; D-21 council #1b adds RELOCATIONS — overrides that lost their ideal
 * slot to a collision are reported too, with where they landed). Bound to the
 * store's `dropped` + `relocated` signals: open while EITHER is non-empty
 * (`:state(open)`); the message composes both parts —
 * "Overrides dropped: <keys>" / "Overrides moved: <key> → <to>, …" — joined
 * with ' · ' when both apply. Manual dismiss and the ~6 s auto-dismiss go
 * through `store.clearDropped()`, which clears BOTH signals (one report, one
 * lifecycle; timer cleared on disposal). `role="status"` +
 * `aria-live="polite"` — informational, not interruptive.
 */
import { UIElement, html, css } from '@curve-ramp/base'
import * as store from '../store.js'

const AUTO_DISMISS_MS = 6000

export class CrToast extends UIElement {
  static template = () => html`
    <div data-toast role="status" aria-live="polite">
      <span data-toast-message></span>
      <button type="button" data-toast-dismiss>Dismiss</button>
    </div>
  `

  static styles = css`
    cr-toast {
      display: none;
    }
    cr-toast:state(open) {
      display: block;
      position: fixed;
      inset-block-end: var(--space-5);
      inset-inline-end: var(--space-5);
    }
    cr-toast [data-toast] {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-3) var(--space-4);
      background: var(--color-surface-raised);
      color: var(--color-text);
      border: 1px solid var(--color-text-muted);
      border-radius: var(--radius-3);
      font-size: var(--text-sm);
    }
    cr-toast button {
      padding: var(--space-1) var(--space-2);
      background: transparent;
      color: inherit;
      border: 1px solid var(--color-text-muted);
      border-radius: var(--radius-2);
      cursor: pointer;
    }
  `

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  #timer

  connected() {
    const message = /** @type {HTMLElement} */ (this.first('[data-toast-message]'))
    const dismiss = /** @type {HTMLElement} */ (this.first('[data-toast-dismiss]'))

    this.bindState('open', () => store.dropped.value.length > 0 || store.relocated.value.length > 0)
    this.bindText(message, () => {
      // One reconcile report, two parts (D-21 #1b): drops first, then moves,
      // ' · '-joined when both apply.
      const parts = []
      const drops = store.dropped.value
      const moves = store.relocated.value
      if (drops.length > 0) parts.push(`Overrides dropped: ${drops.join(', ')}`)
      if (moves.length > 0) {
        parts.push(`Overrides moved: ${moves.map((m) => `${m.key} → ${m.to}`).join(', ')}`)
      }
      return parts.join(' · ')
    })
    // clearDropped clears BOTH dropped and relocated — one report lifecycle.
    this.on(dismiss, 'click', () => store.clearDropped())

    // Auto-dismiss ~6 s after the latest report; re-arming on every change so
    // a fresh reconcile gets a full window. The timer is cleared in disconnected().
    this.effect(() => {
      const open = store.dropped.value.length > 0 || store.relocated.value.length > 0
      clearTimeout(this.#timer)
      this.#timer = undefined
      if (open) this.#timer = setTimeout(() => store.clearDropped(), AUTO_DISMISS_MS)
    })
  }

  disconnected() {
    clearTimeout(this.#timer) // disposal contract: no orphan timer fires after disconnect
    this.#timer = undefined
  }
}

customElements.define('cr-toast', CrToast)
