// Base-curve evaluators — SPEC §5.1. Each BaseFamily reduces to a scalar
// function [0,1] → channel value. Two families: sinusoidal (IQ cosine, reduced
// per-channel) and algorithmic color-science (linear/gamma/smoothstep/published/
// cusp-anchored/gamut-max). Sources: ref-color iq-cosine-palette-formula.md,
// lightness-ramp-curves.md, oklch-gamut-peak-math.md.
import { CurveRampError } from '../types.js';
import { publishedAt } from './published.js';
import { peakC } from '../color/gamut.js';
import { toe } from '../color/oklrch.js';
const clamp01 = (x) => Math.min(1, Math.max(0, x));
/** Quadratic-Bézier easing in segment-local [0,1]² space — D-24 tent flanks.
 *  P0=(0,0), Ctrl=(cx,cy), P1=(1,1): x(u) = 2u(1−u)·cx + u², y(u) = 2u(1−u)·cy + u².
 *  x(u) is solved CLOSED-FORM for u at x = s (no iteration): the quadratic
 *  (1−2cx)·u² + 2cx·u − s = 0 gives u = (−cx + √(cx² + (1−2cx)·s)) / (1−2cx),
 *  degenerating to u = s when cx ≈ 0.5 (|1−2cx| < 1e-9 ⇒ x(u) = u). cx ∈
 *  [0.02, 0.98] (validated) keeps x(u) strictly monotone increasing, so the
 *  + root is the unique u ∈ [0,1]. cy ∈ [0,1] makes y∘u monotone (y'(u) =
 *  2cy(1−2u) + 2u ≥ 0 on [0,1]). Returns y(s) ∈ [0,1], easing 0→1.
 *  Endpoints are returned EXACTLY (u(0) = 0, u(1) = 1 mathematically; the
 *  short-circuit removes the √'s last-ulp noise) so the tent's seam and end
 *  values are bit-exact — D-24 requires value(peakT) === peakC. */
function quadEase(s, cx, cy) {
    if (s <= 0)
        return 0;
    if (s >= 1)
        return 1;
    const denom = 1 - 2 * cx;
    const u = Math.abs(denom) < 1e-9 ? s : (-cx + Math.sqrt(Math.max(0, cx * cx + denom * s))) / denom;
    return 2 * u * (1 - u) * cy + u * u;
}
/** Gamut cap for the gamut-tracking bases: prefer the threaded ctx.cap, else
 *  compute from ctx.L. No silent fallback (M0.7 removed the old `ctx.L ?? 0.5`
 *  coercion) — missing both is a degenerate sampling context. */
function gamutCap(ctx) {
    if (ctx.cap != null)
        return ctx.cap;
    if (ctx.L != null)
        return peakC(ctx.L, ctx.hue, ctx.gamut);
    throw new CurveRampError('degenerate', 'C-channel sampling requires ctx.L or ctx.cap', 'C');
}
export function evalBase(base, t, ctx) {
    const span = ctx.max - ctx.min;
    switch (base.kind) {
        case 'linear':
            return ctx.min + t * span;
        case 'gamma':
            return ctx.min + Math.pow(clamp01(t), base.gamma) * span;
        case 'smoothstep': {
            const s = t * t * (3 - 2 * t);
            return ctx.min + s * span;
        }
        case 'sine': // IQ cosine, one channel: a + b·cos(2π(c·t + d))
            return base.a + base.b * Math.cos(2 * Math.PI * (base.c * t + base.d));
        case 'published': {
            const v = publishedAt(base.system, base.channel, t);
            // published L is absolute OKLab L → convert into the Lr working space (§7).
            return base.channel === 'L' ? toe(v) : ctx.min + v * span;
        }
        case 'lookup': {
            // D-15: linear interpolation at x = clamp01(t)·(len−1) — the publishedAt
            // precedent (endpoints hold beyond [0,1]). Values are ABSOLUTE channel
            // units and are returned AS-IS (no bounds denormalization); the rails
            // clamp in sampleChannel applies as everywhere.
            const table = base.values;
            const x = clamp01(t) * (table.length - 1);
            const i = Math.floor(x);
            const f = x - i;
            const a = table[i];
            const b = table[Math.min(i + 1, table.length - 1)];
            return a + (b - a) * f;
        }
        case 'gamut-max':
            return gamutCap(ctx);
        case 'cusp-anchored': {
            // C tracks the gamut cusp, de-emphasized toward the ramp ends by `falloff`.
            const cap = gamutCap(ctx);
            const bell = Math.sin(Math.PI * clamp01(t)); // 0 at ends, 1 mid
            return ctx.min + (cap - ctx.min) * Math.pow(bell, 1 / Math.max(1e-4, base.falloff));
        }
        case 'tent': {
            // D-24: asymmetric bell — ends at ctx.min, peak exactly (peakT, peakC).
            // Rising flank t ∈ [0, peakT]: quadratic-Bézier ease min→peak shaped by
            // `low`; falling flank t ∈ (peakT, 1]: ease peak→min shaped by `high`.
            // The two formulas agree at the seam: rising s=1 ⇒ y=1 ⇒ peakC; falling
            // s=0 ⇒ y=0 ⇒ peakC. s is clamped to [0,1] for safety, and the boundary
            // values are EXACT: quadEase pins y(0)=0 / y(1)=1, and the boundary
            // returns below skip the float round-trip (peakC − 1·(peakC − min) lands
            // an ulp off min) so value(0) === min, value(peakT) === peakC,
            // value(1) === min bit-exactly.
            if (t <= base.peakT) {
                const s = clamp01(t / base.peakT);
                if (s === 0)
                    return ctx.min;
                if (s === 1)
                    return base.peakC;
                return ctx.min + quadEase(s, base.low.x, base.low.y) * (base.peakC - ctx.min);
            }
            const s = clamp01((t - base.peakT) / (1 - base.peakT));
            if (s === 0)
                return base.peakC;
            if (s === 1)
                return ctx.min;
            return base.peakC - quadEase(s, base.high.x, base.high.y) * (base.peakC - ctx.min);
        }
    }
}
