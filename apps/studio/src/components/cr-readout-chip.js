/**
 * <cr-readout-chip> — the hover/drag/keyboard readout chip (PLAN M4.4, D-20b;
 * SPEC §10 *hover point* + *point at gamut limit*).
 *
 * Positions ABSOLUTELY inside the canvas's `[data-chip-anchor]` overlay using
 * canvas pixel coordinates (D-20b: coords are the primary path — the dots are
 * canvas-painted, so there is no DOM anchor element for CSS anchor
 * positioning). The owning <cr-curve-canvas> drives the `data` property from
 * its hover/drag/selection surface; this component only formats and places.
 *
 * Content (SPEC §10): channel name + signed override delta `m_i` + the
 * resolved value in real units (L: Lr 3dp · C: 3dp · H: degrees 1dp + '°').
 * The delta formats per the channel's compound op — additive shows '+0.012' /
 * '−0.034', multiplicative shows '×1.08' — and reads 'Δ identity' when the
 * stop has no override. A gamut-clamped dot adds the SPEC §10 wording
 * "clamped to sRGB cusp (ΔC=…)" (gamut-aware label from spec.displayGamut;
 * the ΔC parenthetical only when the unclamped compound actually overshoots
 * the cap — council MAJOR #2b) and flips `:state(clamped)` → amber text
 * (M4.5 :state()-driven styling).
 *
 * `formatReadout` is exported pure so the canvas's aria-live mirror (M4.5)
 * announces the exact same readout it shows.
 *
 * D-22 (H-channel parameter handles): `formatHueReadout` formats the THREE
 * hue handles' readouts — ends show the signed drift offset ('Δ −10.0°') plus
 * the absolute end hue ('= 225.0°'); the center shows the absolute seed hue.
 * ChipData carries an optional `role` ('dark' | 'center' | 'light') for those
 * payloads. L/C formatting is untouched.
 *
 * D-24 (C-channel tent handles): `formatTentReadout` formats the THREE tent
 * parameter handles — 'C · peak' shows the BASE's chroma ask (peakC, 3dp)
 * plus a ', lightness borrowed' suffix while the store's dragTentPeak
 * coupling bookkeeping is active (the canvas derives/reads that flag);
 * 'C · rise shape' / 'C · fall shape' show the flank control point's
 * segment-local {x, y}. `role` widens to include TentRole. Per-stop C dots
 * keep the ordinary formatReadout path.
 *
 * R-14 (keyboard-reachable warp handles, closing I-7): `formatWarpReadout`
 * formats the two Bézier warp handles ('Warp · handle 1' / 'Warp · handle 2')
 * with the STORED easing coords ('x 0.33 · y 0.40', 2dp) — under a degenerate
 * (flat) warp band the canvas displays the handle against the nominal
 * centered band at exactly this stored y, so chip, aria-live announcement,
 * and display all agree. The peak readout (formatTentReadout) gains an
 * OPTIONAL `peakT`: when passed (the canvas's Alt+←/→ x-nudge announcements)
 * the value appends the peak's new position ('C 0.140 · peakT 0.65'); omitted
 * (the chip path) the format is byte-identical to the D-24 original. `role`
 * widens to include WarpRole.
 */
import { UIElement, html, css, signal } from '@curve-ramp/base'

/** @typedef {import('@curve-ramp/curve-engine').Channel} Channel */
/** @typedef {import('@curve-ramp/curve-engine').CompoundOp} CompoundOp */

/** D-22: which of the three H-mode parameter handles a readout describes. */
/** @typedef {'dark' | 'center' | 'light'} HueRole */

/** D-24: which of the three C-tent parameter handles a readout describes. */
/** @typedef {'peak' | 'rise' | 'fall'} TentRole */

/** R-14: which of the two Bézier warp handles a readout describes. */
/** @typedef {'p1' | 'p2'} WarpRole */

/**
 * Everything the chip needs for one stop, precomputed by the canvas:
 * formatted strings (formatReadout / formatHueReadout / formatTentReadout /
 * formatWarpReadout) + canvas-px placement. `role` is present on H-mode
 * (D-22), C-tent (D-24), and warp-handle (R-14) payloads only.
 * @typedef {{
 *   x: number, y: number, maxX: number, clamped: boolean,
 *   label: string, delta: string, value: string, clamp: string | null,
 *   text: string, role?: HueRole | TentRole | WarpRole,
 * }} ChipData
 */

/** @type {Record<Channel, string>} */
export const CHANNEL_LABELS = { L: 'Lightness', C: 'Chroma', H: 'Hue' }

const MINUS = '−' // typographic minus, per SPEC §10's signed-delta readout

/** Signed override delta per the channel's compound op (SPEC §5.4/§10):
 *  mul → '×1.08'; add → '+0.012' / '−0.034' (H in degrees, 1dp + '°');
 *  absent → 'Δ identity'.
 *  @param {number | null | undefined} delta @param {CompoundOp} op @param {Channel} channel */
export function formatDelta(delta, op, channel) {
  if (delta == null) return 'Δ identity'
  if (op === 'mul') return `×${delta.toFixed(2)}`
  const sign = delta < 0 ? MINUS : '+'
  return channel === 'H'
    ? `${sign}${Math.abs(delta).toFixed(1)}°`
    : `${sign}${Math.abs(delta).toFixed(3)}`
}

/** Resolved value in real units (SPEC §10): L is Lr (working space, SPEC §7),
 *  C is chroma, H is degrees. @param {Channel} channel @param {number} value */
export function formatValue(channel, value) {
  if (channel === 'L') return `Lr ${value.toFixed(3)}`
  if (channel === 'C') return `C ${value.toFixed(3)}`
  return `H ${value.toFixed(1)}°`
}

/**
 * Build the full readout strings for one stop — shared by the chip body and
 * the canvas's aria-live announcement (M4.5: same readout, one formatter).
 * `gamutLabel` is display-gamut-aware ('sRGB' | 'P3', from spec.displayGamut).
 * @param {{ channel: Channel, op: CompoundOp, delta: number | null,
 *           value: number, clamped: boolean, clampDelta: number,
 *           gamutLabel: string }} r
 * @returns {{ label: string, delta: string, value: string, clamp: string | null, text: string }}
 */
export function formatReadout(r) {
  const label = CHANNEL_LABELS[r.channel]
  const delta = formatDelta(r.delta, r.op, r.channel)
  const value = formatValue(r.channel, r.value)
  // SPEC §10 *point at gamut limit* wording, surfaced — never silently clipped.
  // The (ΔC=…) parenthetical is omitted when the overshoot rounds to 0 — a dot
  // RIDING the cusp with no overshoot would otherwise read '(ΔC=0.0000)'
  // (council MAJOR #2b).
  const dc = r.clampDelta.toFixed(4)
  const clamp = r.clamped
    ? `clamped to ${r.gamutLabel} cusp${dc === '0.0000' ? '' : ` (ΔC=${dc})`}`
    : null
  return { label, delta, value, clamp, text: `${label} ${delta}, ${value}${clamp ? `, ${clamp}` : ''}` }
}

/** @type {Record<HueRole, string>} */
export const HUE_ROLE_LABELS = {
  dark: 'Hue · dark end',
  center: 'Hue · center',
  light: 'Hue · light end',
}

/**
 * D-22 H-mode handle readout — shared by the chip body and the canvas's
 * aria-live mirror (same one-formatter rule as formatReadout). Ends read the
 * signed drift OFFSET relative to the seed hue ('Δ −10.0°') plus the absolute
 * end hue ('= 225.0°'); the center reads the absolute seed hue ('H 235.0°').
 * `offset` is ignored for the center role. Degrees are UNwrapped (display
 * convention, curve-math header) so hue+offset may read e.g. '= 362.5°'.
 * @param {{ role: HueRole, hue: number, offset: number }} r
 * @returns {{ role: HueRole, label: string, delta: string, value: string,
 *             clamp: null, text: string }}
 */
export function formatHueReadout(r) {
  const label = HUE_ROLE_LABELS[r.role]
  if (r.role === 'center') {
    const value = `H ${r.hue.toFixed(1)}°`
    return { role: r.role, label, delta: '', value, clamp: null, text: `${label}, ${value}` }
  }
  const sign = r.offset < 0 ? MINUS : '+'
  const delta = `Δ ${sign}${Math.abs(r.offset).toFixed(1)}°`
  const value = `= ${(r.hue + r.offset).toFixed(1)}°`
  return { role: r.role, label, delta, value, clamp: null, text: `${label} ${delta}, ${value}` }
}

/** @type {Record<TentRole, string>} */
export const TENT_ROLE_LABELS = {
  peak: 'C · peak',
  rise: 'C · rise shape',
  fall: 'C · fall shape',
}

/**
 * D-24 C-tent handle readout — shared by the chip body and the canvas's
 * aria-live mirror (same one-formatter rule as formatReadout). The PEAK reads
 * the BASE's chroma ask ('C 0.140', 3dp — may exceed the live gamut cap by
 * design), appends ' · peakT 0.65' when the OPTIONAL `peakT` is passed (R-14:
 * the canvas's Alt+←/→ x-nudge announcements carry the peak's new position;
 * the chip path omits it — format unchanged), and appends ', lightness
 * borrowed' while the store's dragTentPeak coupling bookkeeping is active
 * (`borrowed`). Flank roles ('rise' = low, 'fall' = high) read the control
 * point's segment-local coords ('x 0.50 · y 0.50', 2dp). `peakC`/`peakT`/
 * `borrowed` apply to 'peak' only; `x`/`y` to flanks.
 * @param {{ role: TentRole, peakC?: number, peakT?: number, x?: number,
 *           y?: number, borrowed?: boolean }} r
 * @returns {{ role: TentRole, label: string, delta: string, value: string,
 *             clamp: null, text: string }}
 */
export function formatTentReadout(r) {
  const label = TENT_ROLE_LABELS[r.role]
  if (r.role === 'peak') {
    const pos = r.peakT == null ? '' : ` · peakT ${r.peakT.toFixed(2)}`
    const value = `C ${(r.peakC ?? 0).toFixed(3)}${pos}${r.borrowed ? ', lightness borrowed' : ''}`
    return { role: r.role, label, delta: '', value, clamp: null, text: `${label}, ${value}` }
  }
  const value = `x ${(r.x ?? 0).toFixed(2)} · y ${(r.y ?? 0).toFixed(2)}`
  return { role: r.role, label, delta: '', value, clamp: null, text: `${label}, ${value}` }
}

/** @type {Record<WarpRole, string>} */
export const WARP_ROLE_LABELS = {
  p1: 'Warp · handle 1',
  p2: 'Warp · handle 2',
}

/**
 * R-14 warp-handle readout — shared by the chip body and the canvas's
 * aria-live mirror (same one-formatter rule as formatReadout). Reads the
 * STORED easing coords (2dp): chip value 'x 0.33 · y 0.40' (house · style),
 * announcement text 'Warp · handle 1 — x 0.33, y 0.40'. Under a degenerate
 * (flat) warp band the canvas displays the handle against the nominal
 * centered band at exactly this stored y (curve-math nominalBand), so the
 * announced y and the displayed handle agree; overshoot y (∈ [−0.2, 1.2])
 * reads its true stored value even while the handle PARKS at the canvas edge.
 * @param {{ role: WarpRole, x: number, y: number }} r
 * @returns {{ role: WarpRole, label: string, delta: string, value: string,
 *             clamp: null, text: string }}
 */
export function formatWarpReadout(r) {
  const label = WARP_ROLE_LABELS[r.role]
  const x = r.x.toFixed(2)
  const y = r.y.toFixed(2)
  return {
    role: r.role,
    label,
    delta: '',
    value: `x ${x} · y ${y}`,
    clamp: null,
    text: `${label} — x ${x}, y ${y}`,
  }
}

export class CrReadoutChip extends UIElement {
  static template = () => html`
    <span data-chip-channel></span>
    <span data-chip-delta></span>
    <span data-chip-value></span>
    <span data-chip-clamp hidden></span>
  `

  static styles = css`
    cr-readout-chip {
      position: absolute;
      display: inline-flex;
      align-items: baseline;
      gap: var(--space-2);
      padding: var(--space-1) var(--space-2);
      background: var(--color-surface-raised);
      color: var(--color-text);
      font-size: var(--text-xs);
      border-radius: var(--radius-2);
      white-space: nowrap;
      pointer-events: none;
    }
    cr-readout-chip[hidden] {
      display: none;
    }
    cr-readout-chip [data-chip-channel] {
      color: var(--color-text-muted);
    }
    /* SPEC §10 amber clamp — text turns warning-colored at the gamut cap. */
    cr-readout-chip [data-chip-clamp],
    cr-readout-chip:state(clamped) [data-chip-value] {
      color: var(--color-warning);
    }
  `

  /** Programmatic-only reactive prop (no attribute form — the canvas drives
   *  it from an effect). Manual accessor pair over a signal instead of
   *  `static properties` so the field type is explicit under checkJs. */
  #data = signal(/** @type {ChipData | null} */ (null))

  /** @returns {ChipData | null} */
  get data() {
    return this.#data.value
  }

  /** @param {ChipData | null} v */
  set data(v) {
    this.#data.value = v
  }

  connected() {
    const channel = /** @type {Element} */ (this.first('[data-chip-channel]'))
    const delta = /** @type {Element} */ (this.first('[data-chip-delta]'))
    const value = /** @type {Element} */ (this.first('[data-chip-value]'))
    const clamp = /** @type {Element} */ (this.first('[data-chip-clamp]'))

    this.bindAttr(this, 'hidden', () => this.data == null)
    this.bindState('clamped', () => this.data?.clamped === true)
    this.bindText(channel, () => this.data?.label ?? '')
    this.bindText(delta, () => this.data?.delta ?? '')
    this.bindText(value, () => this.data?.value ?? '')
    this.bindText(clamp, () => this.data?.clamp ?? '')
    this.bindAttr(clamp, 'hidden', () => this.data?.clamp == null)

    // Placement: centered above the dot, clamped into the wrapper; flips
    // below the dot when there is no room above (D-20b coordinate path).
    // Inline style = runtime geometry, not authored CSS (token gate T3 scans
    // css`` literals only — same exemption as <cr-ramp-strip> backgrounds).
    this.effect(() => {
      const d = this.data
      if (d == null) return
      const w = this.offsetWidth || 0
      const h = this.offsetHeight || 0
      const left = Math.min(Math.max(d.x - w / 2, 4), Math.max(4, d.maxX - w - 4))
      let top = d.y - 10 - h
      if (top < 4) top = d.y + 14
      this.style.left = `${Math.round(left)}px`
      this.style.top = `${Math.round(top)}px`
    })
  }
}

customElements.define('cr-readout-chip', CrReadoutChip)
