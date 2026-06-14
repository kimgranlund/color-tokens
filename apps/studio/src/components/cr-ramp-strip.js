/**
 * <cr-ramp-strip> — N swatches via keyed `bindList` (PLAN §3.4, M3.3;
 * SPEC §10 *success* + *loading* states; AC A7 OOG surfacing, AC A8 keyed
 * stability across count changes — node identity follows `swatch.key`).
 *
 * Each row is a `<button data-swatch>` whose background is the swatch's
 * wire-space `oklch(L C H)` (bound as the inline style attribute — runtime
 * engine DATA, deliberately not a css\`\` literal, so token gate T3 stays
 * clean), with its key label, an amber badge when the ideal color is outside
 * sRGB (SPEC §7: out-of-sRGB-but-in-P3 colors are flagged — sRGB is the
 * floor since hex export is sRGB-only; council MAJOR #2: the old
 * `inGamut[displayGamut]` binding was true by construction in BOTH modes,
 * because C samples against the display gamut's own cap), and a tooltip
 * carrying the oklch triple plus `clamped ΔC=…` when chroma was clamped /
 * `outside sRGB` for wide colors (never silently clipped).
 *
 * Pending skeleton (SPEC §10 *loading*): the element starts in
 * `:state(pending)` and flips out after the first palette binding run.
 *
 * Hover emits `cr-swatch-hover` { index } per swatch; the pointer leaving the
 * strip emits `cr-swatch-leave` (D-21 #13: cr- prefixed event pair) — both
 * consumed by the M4 canvas's hover surface. Keyboard parity (C4-#1): a
 * swatch's focusin emits the same `cr-swatch-hover` and its focusout emits
 * `cr-swatch-leave`, so tabbing the strip drives the canvas chip exactly like
 * pointing does; each button also carries an aria-label mirroring the
 * hover-only `title` (key + oklch triple + clamp/outside-sRGB notes).
 */
import { UIElement, html, css, raw, signal } from '@curve-ramp/base'
import * as store from '../store.js'

/** @param {{ oklch: { L: number, C: number, H: number }, clampedChromaDelta: number,
 *             inGamut: { srgb: boolean, p3: boolean } }} s */
const tooltipFor = (s) => {
  const { L, C, H } = s.oklch
  const triple = `oklch(${L.toFixed(4)} ${C.toFixed(4)} ${H.toFixed(1)})`
  const notes = []
  if (s.clampedChromaDelta > 0) notes.push(`clamped ΔC=${s.clampedChromaDelta.toFixed(4)}`)
  if (!s.inGamut.srgb) notes.push('outside sRGB')
  return notes.length > 0 ? `${triple} — ${notes.join(', ')}` : triple
}

export class CrRampStrip extends UIElement {
  static template = () => html`
    <div data-skeleton aria-hidden="true">${raw('<span></span>'.repeat(11))}</div>
    <div data-strip role="group" aria-label="Ramp swatches"></div>
  `

  static styles = css`
    cr-ramp-strip {
      display: block;
    }
    cr-ramp-strip [data-strip],
    cr-ramp-strip [data-skeleton] {
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: 1fr;
      gap: var(--space-1);
    }
    /* SPEC §10 loading — pending skeleton until the first palette run. */
    cr-ramp-strip [data-skeleton] {
      display: none;
    }
    cr-ramp-strip:state(pending) [data-skeleton] {
      display: grid;
    }
    cr-ramp-strip:state(pending) [data-strip] {
      display: none;
    }
    cr-ramp-strip [data-skeleton] span {
      min-block-size: var(--space-8);
      border-radius: var(--radius-2);
      background: var(--color-surface-raised);
      animation: cr-strip-pulse var(--duration-3) ease-in-out infinite alternate;
    }
    @keyframes cr-strip-pulse {
      from { opacity: 1; }
      to { opacity: 0.4; }
    }
    cr-ramp-strip [data-swatch] {
      position: relative;
      display: grid;
      place-items: end center;
      min-block-size: var(--space-8);
      padding: var(--space-1);
      border: 0;
      border-radius: var(--radius-2);
      cursor: pointer;
      transition: transform var(--duration-1);
      /* council #8: inset ring keeps end-of-ramp swatches visible against a
         same-lightness page surface (box-shadow follows the radius). */
      box-shadow: inset 0 0 0 1px var(--color-surface-raised);
    }
    cr-ramp-strip [data-swatch]:hover {
      transform: translateY(calc(-1 * var(--space-1)));
    }
    cr-ramp-strip [data-key] {
      font-size: var(--text-xs);
      padding-inline: var(--space-1);
      border-radius: var(--radius-1);
      background: var(--color-surface);
      color: var(--color-text);
    }
    /* AC A7 — amber outside-sRGB badge, surfaced, never hidden in the data. */
    cr-ramp-strip [data-oog] {
      position: absolute;
      inset-block-start: var(--space-1);
      inset-inline-end: var(--space-1);
      font-size: var(--text-xs);
      padding-inline: var(--space-1);
      border-radius: var(--radius-4);
      background: var(--color-warning);
      color: var(--color-surface);
    }
  `

  /** node → per-item signal driving that row's bindings. @type {WeakMap<Element, { value: any }>} */
  #items = new WeakMap()

  connected() {
    const strip = /** @type {Element} */ (this.first('[data-strip]'))

    // D-21 #13: the strip announces its own pointer exit — consumers (the
    // canvas hover surface) no longer reach in with one-shot listeners.
    this.on(this, 'pointerleave', () => this.emit('cr-swatch-leave'))

    // First-run latch (SPEC §10 loading): pending until the first bindList run
    // has read the palette; the flip is observed by bindState on the microtask.
    const pending = signal(true)
    this.bindState('pending', () => pending.value)

    this.bindList(
      strip,
      () => {
        const swatches = store.palette.value.swatches // the ONLY tracked read
        if (pending.peek()) pending.value = false // latch: first palette run flips the skeleton
        return swatches
      },
      (s) => s.key,
      (s) => this.#createSwatch(s),
      (node, s) => {
        const item = this.#items.get(node)
        if (item) item.value = s // new swatch object per run → row bindings re-fire
      },
    )
  }

  /** Build one swatch row; per-row bindings register into the bindList item scope. @param {any} initial */
  #createSwatch(initial) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.setAttribute('data-swatch', '')
    btn.innerHTML = html`
      <span data-oog hidden role="img" aria-label="outside sRGB" title="outside sRGB">!</span>
      <span data-key></span>
    `
    const item = signal(initial)
    this.#items.set(btn, item)
    const key = /** @type {Element} */ (btn.querySelector('[data-key]'))
    const badge = /** @type {Element} */ (btn.querySelector('[data-oog]'))

    // Background = wire-space oklch triple (engine data → inline style; T1/T3
    // keep oklch() literals out of authored CSS, runtime data is exempt).
    this.bindAttr(btn, 'style', () => {
      const { L, C, H } = item.value.oklch
      return `background: oklch(${L} ${C} ${H})`
    })
    this.bindText(key, () => item.value.key)
    // OOG badge: ideal (pre-clamp) color vs sRGB — the FLOOR gamut (AC A7;
    // SPEC §7). Council MAJOR #2: binding to inGamut[displayGamut] was dead
    // UI — true by construction in both modes (C samples against the display
    // gamut's own cap). !inGamut.srgb flags wide colors even in P3 display.
    this.bindAttr(badge, 'hidden', () => item.value.inGamut.srgb)
    this.bindAttr(btn, 'title', () => tooltipFor(item.value))
    // C4-#1: the title is hover-only — mirror it into the accessible NAME
    // (key + oklch triple + clamp/outside-sRGB notes) so keyboard/AT users
    // get the per-swatch readout the pointer gets. Bound: re-fires through
    // the bindList update path on every palette run.
    this.bindAttr(btn, 'aria-label', () => `${item.value.key} — ${tooltipFor(item.value)}`)
    this.on(btn, 'pointerenter', () => this.emit('cr-swatch-hover', { index: item.value.index }))
    // C4-#1: keyboard parity — a focused swatch drives the SAME canvas hover
    // surface as the pointer (the canvas listens for this exact cr- prefixed
    // event pair on document, D-21 #13; focusout mirrors pointer leave).
    this.on(btn, 'focusin', () => this.emit('cr-swatch-hover', { index: item.value.index }))
    this.on(btn, 'focusout', () => this.emit('cr-swatch-leave'))
    return btn
  }
}

customElements.define('cr-ramp-strip', CrRampStrip)
