// Cubic-Bézier easing — SPEC §5.2. Endpoints fixed at (0,0) and (1,1);
// two interior handles p1,p2. Same math as CSS `cubic-bezier()`:
// Newton-solve t for a given x, then evaluate the y polynomial.
import { CurveRampError } from '../types.js';
/** The identity warp — a straight line, equivalent to no warp. */
export const IDENTITY_WARP = { p1: { x: 1 / 3, y: 1 / 3 }, p2: { x: 2 / 3, y: 2 / 3 } };
export function validateWarp(w) {
    const { p1, p2 } = w;
    if (!(p1.x > 0 && p2.x < 1 && p1.x <= p2.x)) {
        throw new CurveRampError('invalid-field', 'Bézier x handles must satisfy 0 < p1.x <= p2.x < 1', 'bezier');
    }
}
/** Returns an easing function x∈[0,1] → y, for the cubic with control x's/y's. */
export function easing(w) {
    const { p1, p2 } = w;
    const cx = (t) => bez(t, 0, p1.x, p2.x, 1);
    const cy = (t) => bez(t, 0, p1.y, p2.y, 1);
    return (x) => {
        if (x <= 0)
            return 0;
        if (x >= 1)
            return 1;
        return cy(solveT(x, cx));
    };
}
function bez(t, a, b, c, d) {
    const mt = 1 - t;
    return mt * mt * mt * a + 3 * mt * mt * t * b + 3 * mt * t * t * c + t * t * t * d;
}
// Newton's method with bisection fallback — robust for monotone x(t).
function solveT(x, cx) {
    let lo = 0;
    let hi = 1;
    let t = x;
    for (let i = 0; i < 24; i++) {
        const fx = cx(t) - x;
        if (Math.abs(fx) < 1e-7)
            return t;
        const d = (cx(t + 1e-6) - cx(t - 1e-6)) / 2e-6;
        if (Math.abs(d) < 1e-9)
            break;
        const next = t - fx / d;
        if (next < lo || next > hi || Number.isNaN(next))
            break;
        t = next;
    }
    // bisection fallback
    for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (cx(mid) < x)
            lo = mid;
        else
            hi = mid;
    }
    return (lo + hi) / 2;
}
