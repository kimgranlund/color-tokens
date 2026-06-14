import type { ChannelStack, Gamut } from '../types.js';
import type { BezierWarp } from '../types.js';
export interface SampleCtx {
    t: number;
    hue: number;
    L?: number;
    /** Resolved gamut cap peakC(L, hue, gamut) for this stop, when precomputed.
     *  Threaded by the engine so sampling costs ONE peakC per stop, not three
     *  (M0.7 cap threading — PLAN §3.4 budget). */
    cap?: number;
    stopIndex?: number;
    gamut: Gamut;
}
/** Extremes of cos(θ) over the arc θ ∈ [2πd, 2π(c+d)] — closed-form (D-23).
 *  cos attains +1 on the arc iff it contains some 2πk (k ∈ ℤ), and −1 iff it
 *  contains some π + 2πk; otherwise the extremes sit at the arc endpoints.
 *  Handles c = 0 (single-point arc → [cos(2πd), cos(2πd)]) and c < 0 (the
 *  endpoints are ordered before testing). Returns [cosMin, cosMax]. */
export declare function cosArcRange(c: number, d: number): [number, number];
/** The [bandMin, bandMax] the Bézier value-warp normalizes against — D-23.
 *  Same SampleCtx shape as `baseBezier`; for C (bounds.max === 'gamut') the
 *  ctx must carry a resolved cap (ctx.cap or ctx.L), exactly as baseBezier
 *  requires — the gamut-tracking fallback families resolve their band against
 *  it ([min, cap]); sine/tent/published bands are cap-independent (closed-form
 *  per family, see baseBand). Exported for the studio's band-anchored Bézier
 *  tether geometry (deferred D-21 #9, owner QA 2026-06-10): the easing y-axis
 *  renders over this band, so the tether endpoints land on the base's real
 *  value extremes, not the channel-bounds corners. */
export declare function warpBand(stack: ChannelStack, ctx: SampleCtx): [number, number];
/** base ⊗ bézier (NO override) at ctx.t — the continuous curve the dots ride on.
 *  Value-warp (SPEC §5.2 / OD-3): reshape the normalized base value via the
 *  easing. Per D-23 (refining D-13's bounds-normalized form), normalization
 *  runs over the base's own value range (warpBand), so the base's extremes map
 *  to the easing's pinned (0,0)/(1,1) endpoints: every monotone base keeps its
 *  ends EXACTLY fixed under any warp — a handle drag reshapes the transition,
 *  never the rails (SPEC §5.2 endpoint-pinning restored). Handle-y overshoot
 *  (y ∉ [0,1]) may push the value beyond the band; sampleChannel's final clamp
 *  against [bounds.min, resolveMax] still applies, as before. */
export declare function baseBezier(stack: ChannelStack, ctx: SampleCtx): number;
/** Full channel value F(t) = (base ⊗ bézier) ⊗ override, clamped (SPEC §5–§6). */
export declare function sampleChannel(stack: ChannelStack, ctx: SampleCtx): number;
/** Drag a point to `targetValue`: back-solve overrides[index] so the visible
 *  value equals the target, with base + bézier untouched (SPEC §6, AC A3/A5).
 *  ctx.t MUST be the stop's position (index/(N-1)). Pure — returns a copy. */
export declare function setPointOverride(stack: ChannelStack, index: number, targetValue: number, ctx: SampleCtx): ChannelStack;
/** Replace the Bézier warp; overrides are preserved and re-apply on top (AC A4). */
export declare function setBezier(stack: ChannelStack, bezier: BezierWarp): ChannelStack;
/** Reset one override (index) or all (omit) back to identity (SPEC §6). */
export declare function resetOverride(stack: ChannelStack, index?: number): ChannelStack;
/** Sample grid for bakeBezier: 65 = 2⁶ + 1, so every t_j = j/64 is an exact
 *  dyadic float and the baked lookup's node positions reproduce the grid
 *  bit-cleanly (x = t_j·64 = j — no float drift into the wrong segment). Odd,
 *  so t = 0.5 is a node; 64 segments keep the piecewise-linear chord error of
 *  any legal cubic-Bézier warp far below the 4-decimal fixture resolution. */
export declare const BAKE_SAMPLES = 65;
/** SPEC §6 "Bake Bézier → base" — fold base ⊗ bézier into ONE `lookup` base
 *  (D-15 closed, v0.3). Output-preserving EXACTLY at the 65-point sample grid
 *  (tests assert ≤ 1e-12 — the only residue is the identity easing's ulp-level
 *  float round-trip) and linear-interp-APPROXIMATE between samples.
 *  ctx is required for the same reason baseBezier needs it (the v0.1 sketch
 *  lacked it — SPEC §12): C with bounds.max === 'gamut' resolves its cap from
 *  ctx.cap/ctx.L and throws CurveRampError('degenerate') without either.
 *  Overrides are PRESERVED untouched (P2 — the edit stays in its own layer;
 *  they re-apply on top of the baked base); bezier ← IDENTITY_WARP. Pure —
 *  returns a copy. */
export declare function bakeBezier(stack: ChannelStack, ctx: SampleCtx): ChannelStack;
