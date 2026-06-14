/**
 * curve-math.js — PURE canvas-space math for <cr-curve-canvas> (PLAN M4.1/M4.2;
 * SPEC §8.1 per-channel y-normalization, D-7b fixed display ranges, D-10).
 *
 * NO DOM in this module. Everything the painter AND the M4.3 pointer-interaction
 * layer share lives here; the export surface below is FROZEN — the interaction
 * builder codes against these exact signatures.
 *
 * D-10 discipline: all curve values come from the engine's `baseBezier` /
 * `sampleChannel` contracts — no UI-side curve math. The only color-science
 * call made here is `peakC` (the C gamut cap), and every such call increments
 * the `_peakCCalls` counter so the M4.1 perf test can assert the per-frame
 * budget (PLAN §3.4 "peakC calls/frame ≤ budget").
 *
 * Canvas-space conventions:
 * - x: t ∈ [0,1] maps to [PAD, width − PAD] (horizontal padding only).
 * - y: each channel maps its FIXED display range (D-7b — `Y_RANGES`) over the
 *   vertically padded plot area (D-21 #14 — `V_PAD`), channelMin → bottom
 *   (y = height − V_PAD), channelMax → top (y = V_PAD), so dots/curves at the
 *   range extremes paint fully inside the canvas instead of clipping at its
 *   edges. The range is the viewport, not the cap: the C cap line moves
 *   live INSIDE the fixed [0, 0.4] range.
 * - L values are Lr (OKLrCh working space, SPEC §7) — never OKLab L.
 * - H values are UNwrapped degrees so they stay inside [hue−30, hue+30]
 *   (wrapping to [0,360) would tear the display range at low/high seed hues).
 */
import { baseBezier, sampleChannel, peakC, toeInv } from '@curve-ramp/curve-engine'

/** @typedef {import('@curve-ramp/curve-engine').Channel} Channel */
/** @typedef {import('@curve-ramp/curve-engine').PaletteSpec} PaletteSpec */
/** @typedef {import('@curve-ramp/curve-engine').ChannelStack} ChannelStack */
/** @typedef {import('@curve-ramp/curve-engine').Palette} Palette */
/** @typedef {import('@curve-ramp/curve-engine').Gamut} Gamut */

/** @typedef {{ x: number, y: number }} Pt */
/** @typedef {{ i: number, x: number, y: number, value: number, clamped: boolean }} Dot */
/**
 * Bézier handle geometry in canvas coords. Handle coords map
 * (p.x → x-axis as t, p.y → normalized easing-y): the easing square is
 * stretched over the plot area, exactly like a CSS cubic-bezier editor.
 * `start`/`end` are the polygon endpoints (0,0) and (1,1) — without a warp
 * band, the bottom-left and top-right plot corners; with the engine warp
 * band passed (D-21 #9), the BAND's value extremes mapped through the
 * channel viewport, i.e. on the active curve's real ends. A warp y outside
 * [0,1] (legal — CSS easings overshoot) maps OFF-canvas; handles park
 * (±HANDLE_INSET), the polygon clips.
 * @typedef {{ start: Pt, p1: Pt, p2: Pt, end: Pt }} HandleLayout
 */
/**
 * The painter publishes this each frame on `<cr-curve-canvas>.layout`; the
 * interaction layer hit-tests against it via `hitTest`.
 * - `dots`/`handles` exist for the ACTIVE channel only (inactive channels
 *   never intercept — SPEC §10); `handles` is null in the N=2 empty state.
 * - `curvePolylines` holds DOWNSAMPLED canvas-space points for every channel
 *   currently drawn (3 in overlay, 1 in single mode).
 * @typedef {{
 *   width: number, height: number,
 *   activeChannel: Channel,
 *   dots: Dot[],
 *   handles: HandleLayout | null,
 *   curvePolylines: Partial<Record<Channel, Pt[]>>,
 * }} CanvasLayout
 */
/** @typedef {{ kind: 'dot' | 'handle' | 'curve' | null, channel: Channel | null, index?: number }} Hit */

/** Horizontal plot padding in CSS px (x-axis only — see header). */
export const PAD = 16

/** Vertical plot padding in CSS px (D-21 #14): the y mapping spans
 *  [V_PAD, height − V_PAD] so range-extreme dots (L at Lr ≈ 1, C near 0)
 *  paint whole instead of half-outside the canvas. */
export const V_PAD = 8

/** Hit-test radii in CSS px (M4.3 contract). `handle.index`: 0 = p1, 1 = p2. */
export const HIT_RADIUS = Object.freeze({ dot: 7, handle: 9, curve: 5 })

// ── peakC budget counter (PLAN M4.1 perf test) ───────────────────────────────

/** Live count of peakC calls made BY THIS MODULE since the last reset.
 *  ESM live binding — importers read the current value. */
export let _peakCCalls = 0

export function _resetPeakCCount() {
  _peakCCalls = 0
}

/** @param {number} L @param {number} H @param {Gamut} gamut */
function countedPeakC(L, H, gamut) {
  _peakCCalls += 1
  return peakC(L, H, gamut)
}

// ── D-7b fixed per-channel display ranges ────────────────────────────────────

/** Fixed y-display ranges (D-7b — never auto-fit): L [0,1] in Lr, C [0,0.4],
 *  H [hue−30, hue+30]. @param {number} hue
 *  @returns {Record<Channel, { min: number, max: number }>} */
export function Y_RANGES(hue) {
  return {
    L: { min: 0, max: 1 },
    C: { min: 0, max: 0.4 },
    H: { min: hue - 30, max: hue + 30 },
  }
}

// ── value ↔ canvas mapping ───────────────────────────────────────────────────

const clamp01 = (/** @type {number} */ n) => Math.min(1, Math.max(0, n))

/** Channel value → canvas y (clamped into the viewport: min → height − V_PAD,
 *  max → V_PAD — the D-21 #14 vertically padded plot area).
 *  @param {Channel} ch @param {number} v @param {number} hue @param {number} height */
export function valueToY(ch, v, hue, height) {
  const r = Y_RANGES(hue)[ch]
  return V_PAD + (height - 2 * V_PAD) * (1 - clamp01((v - r.min) / (r.max - r.min)))
}

/** Canvas y → channel value (inverse of valueToY; clamped to the display range).
 *  @param {Channel} ch @param {number} y @param {number} hue @param {number} height */
export function yToValue(ch, y, hue, height) {
  const r = Y_RANGES(hue)[ch]
  return r.min + clamp01(1 - (y - V_PAD) / (height - 2 * V_PAD)) * (r.max - r.min)
}

/** t ∈ [0,1] → canvas x within [PAD, width − PAD]. @param {number} t @param {number} width */
export function tToX(t, width) {
  return PAD + t * (width - 2 * PAD)
}

/** Canvas x → t (inverse of tToX; clamped to [0,1]). @param {number} x @param {number} width */
export function xToT(x, width) {
  return clamp01((x - PAD) / (width - 2 * PAD))
}

// ── curve sampling (D-10: engine contracts only) ─────────────────────────────

/**
 * Sample base⊗bézier (the continuous spline the dots ride on — NO overrides)
 * across t ∈ [0,1] at `samples` evenly spaced points. FROZEN signature.
 *
 * For C, the per-sample ctx carries L(t)/H(t) sampled from the spec's L/H
 * stacks (sampleChannel without stopIndex = base⊗bézier clamped to bounds)
 * plus the gamut cap:
 * - `capLut` provided (the painter's path): caps come from the LUT — ZERO
 *   peakC calls. MUST be index-aligned: `capLut.length === samples` (same
 *   sample grid as `capLUT(spec, samples)`); throws otherwise.
 * - `capLut` omitted: peakC per sample (counted) — standalone/test use only.
 *
 * @param {ChannelStack} stack the channel stack to draw (may be a transient mid-drag stack)
 * @param {Channel} ch
 * @param {PaletteSpec} spec   supplies hue, displayGamut, and the L/H stacks for C's ctx
 * @param {number} samples     integer ≥ 2
 * @param {Float64Array} [capLut] required-by-budget for ch === 'C' in the paint path
 * @returns {Float64Array}
 */
export function sampleCurve(stack, ch, spec, samples, capLut) {
  if (!Number.isInteger(samples) || samples < 2) throw new Error('samples must be an integer >= 2')
  if (ch === 'C' && capLut != null && capLut.length !== samples) {
    throw new Error(`capLut.length (${capLut.length}) must equal samples (${samples})`)
  }
  const { hue, displayGamut: gamut, channels } = spec
  const out = new Float64Array(samples)
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1)
    if (ch === 'C') {
      const L = toeInv(sampleChannel(channels.L, { t, hue, gamut }))
      const H = sampleChannel(channels.H, { t, hue, gamut })
      const cap = capLut != null ? capLut[i] : countedPeakC(L, H, gamut)
      out[i] = baseBezier(stack, { t, hue: H, L, cap, gamut })
    } else {
      out[i] = baseBezier(stack, { t, hue, gamut })
    }
  }
  return out
}

/**
 * The C cap line: peakC(L(t), H(t), displayGamut) across t (PLAN §3.4 budget —
 * `samples` counted peakC calls). L(t)/H(t) are the continuous base⊗bézier
 * curves (sampleChannel, no stopIndex). CALLER'S JOB: cache this and rebuild
 * only when (hue, displayGamut, L stack, H stack) change — spec immutability
 * makes reference equality on `spec.channels.L`/`.H` a valid key.
 * @param {PaletteSpec} spec @param {number} samples @returns {Float64Array}
 */
export function capLUT(spec, samples) {
  if (!Number.isInteger(samples) || samples < 2) throw new Error('samples must be an integer >= 2')
  const { hue, displayGamut: gamut, channels } = spec
  const out = new Float64Array(samples)
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1)
    const L = toeInv(sampleChannel(channels.L, { t, hue, gamut }))
    const H = sampleChannel(channels.H, { t, hue, gamut })
    out[i] = countedPeakC(L, H, gamut)
  }
  return out
}

// ── dots ─────────────────────────────────────────────────────────────────────

/**
 * The N stop dots for channel `ch`, in canvas coords. Dots show the SAMPLED
 * channel value pre-fit (sampleChannel per stop with the same ctx `generate`
 * uses — L dots are Lr, H dots unwrapped degrees). For C the ctx reads the
 * stop's RESOLVED L/H off the palette (fit preserves ideal L/H) and threads
 * `cap = peakC(L, H, gamut)` — N counted peakC calls per call (the steady-state
 * repaint budget: ≤ N ≤ 24 studio-side).
 * `clamped` = (ch === 'C' && value ≥ cap − 1e-9) → warning dot + ring (SPEC §10).
 * @param {Palette} palette @param {PaletteSpec} spec @param {Channel} ch
 * @param {number} width @param {number} height @returns {Dot[]}
 */
export function dotPositions(palette, spec, ch, width, height) {
  const { hue, displayGamut: gamut, count } = spec
  const stack = spec.channels[ch]
  /** @type {Dot[]} */
  const dots = []
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1)
    let value
    let clamped = false
    if (ch === 'C') {
      const sw = palette.swatches[i]
      if (sw == null) continue // count/palette mismatch — transient, skip
      const { L, H } = sw.oklch
      const cap = countedPeakC(L, H, gamut)
      value = sampleChannel(stack, { t, hue: H, L, cap, stopIndex: i, gamut })
      clamped = value >= cap - 1e-9
    } else {
      value = sampleChannel(stack, { t, hue, stopIndex: i, gamut })
    }
    dots.push({ i, x: tToX(t, width), y: valueToY(ch, value, hue, height), value, clamped })
  }
  return dots
}

// ── Bézier handles ───────────────────────────────────────────────────────────

/** Edge inset (px) a handle PARKS at when its warp value maps off-canvas. */
export const HANDLE_INSET = 6

/**
 * The 2 warp handles + control-polygon endpoints in canvas coords (see
 * HandleLayout typedef for the coordinate model). Handle DISPLAY positions
 * clamp into the canvas (±HANDLE_INSET): drag overshoot (warp y ∈ [−0.2, 1.2])
 * is a real value the engine keeps, but an off-canvas handle is invisible AND
 * ungrabbable — hit-testing needs the pointer over it (owner field report
 * 2026-06-10: "bezier controls go off screen", reproduced on the C tab). The
 * handle parks at the edge, stays grabbable, and re-dragging recomputes the
 * warp from the pointer as always. Amends the original frozen note
 * ("UNclamped, maps off-canvas").
 *
 * `band` (NEW optional trailing param — deferred D-21 #9, owner QA
 * 2026-06-10): the engine's warp band {min, max} — the value range the D-23
 * value-warp actually normalizes against (engine `warpBand(stack, ctx)`).
 * When provided, the easing's y-axis maps over the BAND instead of the full
 * display range: easing-y n → value `band.min + n·(band.max − band.min)`,
 * then value → display y via the channel's Y_RANGES viewport. The tether
 * endpoints therefore land ON the base curve's real value extremes (the L/H
 * curve ends for monotone bases; [min, peakC] for tents/bells), not the unit
 * corners of the plot. Omitted → unit-square mapping, unchanged behavior.
 * @param {ChannelStack} stack @param {Channel} ch @param {number} hue
 * @param {number} width @param {number} height
 * @param {{ min: number, max: number }} [band] @returns {HandleLayout}
 */
export function bezierHandlePositions(stack, ch, hue, width, height, band) {
  // n = normalized easing-y → display y. Without `band`: [0,1] of the
  // channel's display range — numerically identical to
  // valueToY(ch, rangeMin + n·rangeSpan, hue, height) for in-range n. With
  // `band`: n maps into VALUE space over the band first (see header), i.e.
  // y = V_PAD + (height − 2·V_PAD)·(1 − (band.min + n·bandSpan − rangeMin)/rangeSpan)
  // (the D-21 #14 padded plot area) — deliberately UNclamped (the park below
  // owns display clamping).
  const r = Y_RANGES(hue)[ch]
  // Degenerate band (flat curve — e.g. the default no-drift H): the warp is
  // INERT (engine skips the easing) but the controls must stay ALIVE (owner
  // QA 2026-06-10 ×2): the tether ANCHORS sit at the curve's value on each
  // side (for the default H that is the vertical center of the sides), while
  // the HANDLES render and drag against a NOMINAL centered band — the flat
  // value ± a quarter of the viewport (±15° for H) — so they remain visibly
  // displaceable and store the easing shape that activates when the band
  // opens (drift added). `nominalBand` is shared with the canvas drag inverse
  // so render and drag stay one symmetric mapping.
  const flat = band != null && band.max - band.min < 1e-9
  const valY = (/** @type {number} */ v) =>
    V_PAD + (height - 2 * V_PAD) * (1 - (v - r.min) / (r.max - r.min))
  let yAnchor
  let yHandle
  if (band == null) {
    const f = (/** @type {number} */ n) => V_PAD + (height - 2 * V_PAD) * (1 - n)
    yAnchor = f
    yHandle = f
  } else if (flat) {
    const nom = nominalBand(ch, hue, band.min)
    yAnchor = () => valY(band.min)
    yHandle = (/** @type {number} */ n) => valY(nom.min + n * (nom.max - nom.min))
  } else {
    const f = (/** @type {number} */ n) => valY(band.min + n * (band.max - band.min))
    yAnchor = f
    yHandle = f
  }
  const park = (/** @type {number} */ y) =>
    Math.min(height - HANDLE_INSET, Math.max(HANDLE_INSET, y))
  const { p1, p2 } = stack.bezier
  return {
    start: { x: tToX(0, width), y: yAnchor(0) },
    p1: { x: tToX(p1.x, width), y: park(yHandle(p1.y)) },
    p2: { x: tToX(p2.x, width), y: park(yHandle(p2.y)) },
    end: { x: tToX(1, width), y: yAnchor(1) },
  }
}

/** The display/drag band for Bézier handles over a DEGENERATE warp band: the
 *  flat value ± a quarter of the channel viewport (H: ±15°). Used by both
 *  bezierHandlePositions and the canvas drag inverse — one symmetric mapping.
 *  @param {Channel} ch @param {number} hue @param {number} flatValue */
export function nominalBand(ch, hue, flatValue) {
  const r = Y_RANGES(hue)[ch]
  const quarter = (r.max - r.min) / 4
  return { min: flatValue - quarter, max: flatValue + quarter }
}

// ── hit testing (pure — the M4.3 interaction layer calls this) ───────────────

/** @param {Pt} p @param {Pt} a @param {Pt} b */
function segDist(p, a, b) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const u = len2 === 0 ? 0 : clamp01(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)
  return Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy))
}

/** @param {Pt} pt @param {Pt[]} pts */
function distToPolyline(pt, pts) {
  if (pts.length === 0) return Infinity
  if (pts.length === 1) return Math.hypot(pt.x - pts[0].x, pt.y - pts[0].y)
  let best = Infinity
  for (let i = 1; i < pts.length; i++) {
    const d = segDist(pt, pts[i - 1], pts[i])
    if (d < best) best = d
  }
  return best
}

/**
 * Hit-test a canvas-space point against a painted frame's layout. Priority
 * (D-7a): the ACTIVE channel's elements first — dot (≤ 7px), then handle
 * (≤ 9px, index 0 = p1 / 1 = p2), then its curve (≤ 5px) — then OTHER
 * channels' curves (≤ 5px, nearest wins) for click-to-activate. Inactive
 * channels expose no dots/handles in the layout, so they can never intercept
 * a point edit (SPEC §10).
 * @param {Pt} pt @param {CanvasLayout | null | undefined} layout @returns {Hit}
 */
export function hitTest(pt, layout) {
  /** @type {Hit} */
  const miss = { kind: null, channel: null }
  if (layout == null) return miss
  const { dots, handles, curvePolylines, activeChannel } = layout

  let bestDot = null
  for (const d of dots) {
    const dist = Math.hypot(pt.x - d.x, pt.y - d.y)
    if (dist <= HIT_RADIUS.dot && (bestDot == null || dist < bestDot.dist)) bestDot = { dist, index: d.i }
  }
  if (bestDot) return { kind: 'dot', channel: activeChannel, index: bestDot.index }

  if (handles != null) {
    const pts = [handles.p1, handles.p2]
    let bestHandle = null
    for (let i = 0; i < 2; i++) {
      const dist = Math.hypot(pt.x - pts[i].x, pt.y - pts[i].y)
      if (dist <= HIT_RADIUS.handle && (bestHandle == null || dist < bestHandle.dist)) {
        bestHandle = { dist, index: i }
      }
    }
    if (bestHandle) return { kind: 'handle', channel: activeChannel, index: bestHandle.index }
  }

  const activeLine = curvePolylines[activeChannel]
  if (activeLine != null && distToPolyline(pt, activeLine) <= HIT_RADIUS.curve) {
    return { kind: 'curve', channel: activeChannel }
  }

  let bestCurve = null
  for (const ch of /** @type {Channel[]} */ (Object.keys(curvePolylines))) {
    if (ch === activeChannel) continue
    const line = curvePolylines[ch]
    if (line == null) continue
    const d = distToPolyline(pt, line)
    if (d <= HIT_RADIUS.curve && (bestCurve == null || d < bestCurve.d)) bestCurve = { d, ch }
  }
  if (bestCurve) return { kind: 'curve', channel: bestCurve.ch }

  return miss
}
