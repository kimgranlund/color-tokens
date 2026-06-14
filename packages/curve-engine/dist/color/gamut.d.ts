import type { Gamut } from '../types.js';
import type { Oklch } from './oklrch.js';
/** Max in-gamut chroma at (L, H) — SPEC §7. Closed-form cusp for both gamuts
 *  (exact to float precision, no iteration): sRGB since M0.1, P3 since R-18. */
export declare function peakC(L: number, H: number, gamut?: Gamut): number;
/** Bisection peakC over culori's in-gamut predicate. ≤32 iters on C ∈ [0, 0.5]
 *  → ~1e-10 resolution. Being a genuinely independent computation, this is the
 *  test oracle for BOTH analytic paths (test/cusp.test.ts, PLAN M0.1
 *  "bisection agreement ±1e-4"; R-18 extends the same gate to P3). Not on any
 *  production path since R-18. */
export declare function peakCBisect(L: number, H: number, gamut?: Gamut): number;
/** The hue's cusp point (Ottosson cusp) — D-24: argmax over L of peakC(L, H,
 *  gamut), as `{ L, C }` with L in OKLab (wire space, matching peakC) and C the
 *  max chroma there. Coarse scan (64 steps over L ∈ (0.01, 0.99)) brackets the
 *  max, then golden-section refines to |ΔL| < 1e-4 — ≤ ~30 peakC evaluations
 *  for the refine (≈ 80 total with the scan; the analytic paths — sRGB M0.1,
 *  P3 R-18 — keep this in the tens of microseconds for both gamuts).
 *  peakC at fixed hue is unimodal in L (the gamut slice's upper boundary rises
 *  to a single cusp corner and falls), so the bracketed golden-section search
 *  converges to the global max. */
export declare function cusp(H: number, gamut?: Gamut): {
    L: number;
    C: number;
};
export interface FitResult {
    oklch: Oklch;
    hex: string;
    inGamut: {
        srgb: boolean;
        p3: boolean;
    };
    clampedChromaDelta: number;
}
/** Clamp chroma to the display gamut's cusp; report how much was removed.
 *  inGamut flags describe the IDEAL (pre-clamp) color, so OOG is surfaced.
 *  Invariant (tested in engine.test.ts): clampedChromaDelta === 0 ⇒
 *  inGamut[gamut] === true. */
export declare function fit(ideal: Oklch, gamut?: Gamut): FitResult;
