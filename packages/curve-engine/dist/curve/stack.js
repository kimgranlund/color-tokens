// CurveStack — the per-channel layer composition + bidirectional edit resolution.
// SPEC §5 (compounding) + §6 (an edit mutates ONLY its own layer). This is the
// load-bearing module: the three layers (base ⊗ bézier ⊗ override) and the
// point↔curve back-solve live here.
//
// D-23 (refines D-13): the Bézier value-warp normalizes over the BASE'S OWN
// value range (the "warp band", closed-form per family — see warpBand), not
// the channel bounds span. A base that doesn't fill its bounds (e.g. the H
// drift sine at hue±drift inside the ±30° rails) now has its extremes
// normalize to exactly 0/1, so the easing's pinned (0,0)/(1,1) endpoints hold
// the curve's ends fixed under any warp (SPEC §5.2 endpoint-pinning restored).
import { CurveRampError } from '../types.js';
import { evalBase } from './base.js';
import { easing, validateWarp, IDENTITY_WARP } from './bezier.js';
import { publishedRange } from './published.js';
import { peakC } from '../color/gamut.js';
import { toe } from '../color/oklrch.js';
const applyOp = (v, m, op) => (op === 'mul' ? v * m : v + m);
/** Inverse of applyOp — back-solve the override delta for a target (SPEC §6).
 *  Recorded edge (M0.7, PLAN §1.8): under 'mul', when base⊗bézier is exactly 0
 *  the delta is unrecoverable (every m yields 0), so we return the identity (1)
 *  and the drag is a NO-OP — never Infinity/NaN. Unreachable in default specs:
 *  C's bounds.min = 0.01 > 0 keeps base⊗bézier strictly positive there. */
const invOp = (target, base, op) => op === 'mul' ? (base === 0 ? 1 : target / base) : target - base;
/** Resolve the channel's effective max. For C (bounds.max === 'gamut') a
 *  resolved cap is REQUIRED: prefer the threaded ctx.cap, else compute it from
 *  ctx.L. No silent fallback (M0.7 removed the old `ctx.L ?? 0.5` coercion) —
 *  sampling C without either is a degenerate context and throws. */
function resolveMax(stack, ctx) {
    if (stack.bounds.max !== 'gamut')
        return stack.bounds.max;
    if (ctx.cap != null)
        return ctx.cap;
    if (ctx.L != null)
        return peakC(ctx.L, ctx.hue, ctx.gamut);
    throw new CurveRampError('degenerate', 'C-channel sampling requires ctx.L or ctx.cap', 'C');
}
/** Extremes of cos(θ) over the arc θ ∈ [2πd, 2π(c+d)] — closed-form (D-23).
 *  cos attains +1 on the arc iff it contains some 2πk (k ∈ ℤ), and −1 iff it
 *  contains some π + 2πk; otherwise the extremes sit at the arc endpoints.
 *  Handles c = 0 (single-point arc → [cos(2πd), cos(2πd)]) and c < 0 (the
 *  endpoints are ordered before testing). Returns [cosMin, cosMax]. */
export function cosArcRange(c, d) {
    const TAU = 2 * Math.PI;
    const a0 = TAU * d;
    const a1 = TAU * (c + d);
    const lo = Math.min(a0, a1);
    const hi = Math.max(a0, a1);
    const e0 = Math.cos(lo);
    const e1 = Math.cos(hi);
    let cosMin = Math.min(e0, e1);
    let cosMax = Math.max(e0, e1);
    if (Math.ceil(lo / TAU) <= Math.floor(hi / TAU))
        cosMax = 1; // arc crosses a 2πk
    if (Math.ceil((lo - Math.PI) / TAU) <= Math.floor((hi - Math.PI) / TAU))
        cosMin = -1; // crosses π+2πk
    return [cosMin, cosMax];
}
/** Internal closed-form band: the base's own value range over t ∈ [0,1],
 *  computed per family (D-23 — pure, no sampling loops on the hot path).
 *  `min`/`max` are the resolved channel bounds. Public entry: `warpBand`.
 *
 *  - linear / gamma / smoothstep: span the resolved bounds by construction
 *    (each maps [0,1] onto [0,1] with extremes at the endpoints), so the band
 *    IS [min, max] — pre-D-23 behavior unchanged for these families.
 *  - sine a + b·cos(2π(c·t + d)): cos extrema over the arc (cosArcRange),
 *    b < 0 handled by ordering the two candidates.
 *  - published: the table's value extremes mapped through the SAME transform
 *    evalBase's 'published' branch applies — toe() for L (absolute OKLab L →
 *    Lr working space), `min + v·span` denormalization otherwise. Both maps
 *    are monotone increasing, so they commute with min/max.
 *  - cusp-anchored / gamut-max: values track the per-t gamut cap (no closed
 *    form in t) — documented fallback to the bounds span.
 *  - tent (D-24): [min, peakC] — both flanks are monotone (quadratic-Bézier
 *    eases with validated ctrl x ∈ [0.02, 0.98]), so the extremes sit at the
 *    ends (value = min) and the peak (value = peakC). A warp therefore pins
 *    t = 0/1 at exactly min AND the peak at exactly peakC (norm(peakC) = 1,
 *    ease(1) = 1).
 *  - Degenerate guard: a (near-)constant base (e.g. the default flat H sine,
 *    b = 0) has no range to normalize over — fall back to the bounds span,
 *    preserving pre-D-23 behavior for constants (and covering tent with
 *    peakC ≈ min). */
function baseBand(base, min, max) {
    let bandMin = min;
    let bandMax = max;
    switch (base.kind) {
        case 'sine': {
            const [cosMin, cosMax] = cosArcRange(base.c, base.d);
            const v0 = base.a + base.b * cosMin;
            const v1 = base.a + base.b * cosMax;
            bandMin = Math.min(v0, v1);
            bandMax = Math.max(v0, v1);
            break;
        }
        case 'published': {
            const [vLo, vHi] = publishedRange(base.system, base.channel);
            if (base.channel === 'L') {
                bandMin = toe(vLo);
                bandMax = toe(vHi);
            }
            else {
                const span = max - min;
                bandMin = min + vLo * span;
                bandMax = min + vHi * span;
            }
            break;
        }
        case 'tent': // D-24: ends at min, extreme at the peak — band = [min, peakC]
            bandMin = min;
            bandMax = base.peakC;
            break;
        case 'lookup': {
            // D-15: linear interpolation never exceeds the node extremes — the
            // table min/max ARE the curve's range (same argument as published).
            // A constant table degenerates ⇒ inert warp (D-23 guard below).
            let lo = base.values[0];
            let hi = base.values[0];
            for (const v of base.values) {
                if (v < lo)
                    lo = v;
                if (v > hi)
                    hi = v;
            }
            bandMin = lo;
            bandMax = hi;
            break;
        }
        default: // linear | gamma | smoothstep | cusp-anchored | gamut-max
            break;
    }
    // Degenerate bands (constant bases, e.g. the flat default H sine b=0) are
    // returned AS-IS: the warp is INERT on a constant transition (baseBezier
    // skips the easing — owner QA 2026-06-10). The old fallback-to-bounds made
    // a warp on a flat curve act as a vertical OFFSET (easing a constant's 0.5
    // bounds-normalization) — a redundant, surprising control.
    return [bandMin, bandMax];
}
/** The [bandMin, bandMax] the Bézier value-warp normalizes against — D-23.
 *  Same SampleCtx shape as `baseBezier`; for C (bounds.max === 'gamut') the
 *  ctx must carry a resolved cap (ctx.cap or ctx.L), exactly as baseBezier
 *  requires — the gamut-tracking fallback families resolve their band against
 *  it ([min, cap]); sine/tent/published bands are cap-independent (closed-form
 *  per family, see baseBand). Exported for the studio's band-anchored Bézier
 *  tether geometry (deferred D-21 #9, owner QA 2026-06-10): the easing y-axis
 *  renders over this band, so the tether endpoints land on the base's real
 *  value extremes, not the channel-bounds corners. */
export function warpBand(stack, ctx) {
    return baseBand(stack.base, stack.bounds.min, resolveMax(stack, ctx));
}
/** base ⊗ bézier (NO override) at ctx.t — the continuous curve the dots ride on.
 *  Value-warp (SPEC §5.2 / OD-3): reshape the normalized base value via the
 *  easing. Per D-23 (refining D-13's bounds-normalized form), normalization
 *  runs over the base's own value range (warpBand), so the base's extremes map
 *  to the easing's pinned (0,0)/(1,1) endpoints: every monotone base keeps its
 *  ends EXACTLY fixed under any warp — a handle drag reshapes the transition,
 *  never the rails (SPEC §5.2 endpoint-pinning restored). Handle-y overshoot
 *  (y ∉ [0,1]) may push the value beyond the band; sampleChannel's final clamp
 *  against [bounds.min, resolveMax] still applies, as before. */
export function baseBezier(stack, ctx) {
    const min = stack.bounds.min;
    const max = resolveMax(stack, ctx);
    // Thread the resolved cap into evalBase so gamut-tracking bases (gamut-max,
    // cusp-anchored) never recompute peakC (M0.7 cap threading).
    const cap = stack.bounds.max === 'gamut' ? max : ctx.cap;
    const raw = evalBase(stack.base, ctx.t, { min, max, hue: ctx.hue, L: ctx.L, cap, gamut: ctx.gamut });
    const [bandMin, bandMax] = baseBand(stack.base, min, max);
    const span = bandMax - bandMin;
    // Degenerate band ⇒ inert warp: a constant transition has nothing to ease.
    if (span < 1e-9)
        return raw;
    const norm = Math.min(1, Math.max(0, (raw - bandMin) / span));
    return bandMin + easing(stack.bezier)(norm) * span;
}
/** Full channel value F(t) = (base ⊗ bézier) ⊗ override, clamped (SPEC §5–§6). */
export function sampleChannel(stack, ctx) {
    if (!Number.isFinite(ctx.t))
        throw new CurveRampError('degenerate', 'invalid t', stack.channel);
    const max = resolveMax(stack, ctx);
    // Share the one resolved cap with baseBezier/evalBase (one peakC per stop).
    if (stack.bounds.max === 'gamut' && ctx.cap == null)
        ctx = { ...ctx, cap: max };
    let v = baseBezier(stack, ctx);
    if (ctx.stopIndex != null) {
        const m = stack.overrides[ctx.stopIndex];
        if (m != null)
            v = applyOp(v, m, stack.op);
    }
    return Math.min(max, Math.max(stack.bounds.min, v));
}
/** Drag a point to `targetValue`: back-solve overrides[index] so the visible
 *  value equals the target, with base + bézier untouched (SPEC §6, AC A3/A5).
 *  ctx.t MUST be the stop's position (index/(N-1)). Pure — returns a copy. */
export function setPointOverride(stack, index, targetValue, ctx) {
    const bb = baseBezier(stack, ctx);
    return { ...stack, overrides: { ...stack.overrides, [index]: invOp(targetValue, bb, stack.op) } };
}
/** Replace the Bézier warp; overrides are preserved and re-apply on top (AC A4). */
export function setBezier(stack, bezier) {
    validateWarp(bezier);
    return { ...stack, bezier };
}
/** Reset one override (index) or all (omit) back to identity (SPEC §6). */
export function resetOverride(stack, index) {
    if (index == null)
        return { ...stack, overrides: {} };
    const next = { ...stack.overrides };
    delete next[index];
    return { ...stack, overrides: next };
}
/** Sample grid for bakeBezier: 65 = 2⁶ + 1, so every t_j = j/64 is an exact
 *  dyadic float and the baked lookup's node positions reproduce the grid
 *  bit-cleanly (x = t_j·64 = j — no float drift into the wrong segment). Odd,
 *  so t = 0.5 is a node; 64 segments keep the piecewise-linear chord error of
 *  any legal cubic-Bézier warp far below the 4-decimal fixture resolution. */
export const BAKE_SAMPLES = 65;
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
export function bakeBezier(stack, ctx) {
    const values = [];
    for (let j = 0; j < BAKE_SAMPLES; j++) {
        values.push(baseBezier(stack, { ...ctx, t: j / (BAKE_SAMPLES - 1) }));
    }
    return { ...stack, base: { kind: 'lookup', values }, bezier: IDENTITY_WARP };
}
