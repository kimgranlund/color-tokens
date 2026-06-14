/**
 * Max in-gamut chroma at (L, H) for sRGB, closed form — SPEC §7, PLAN M0.1.
 *
 * `L` is OKLab lightness ∈ [0, 1] (wire space, matching `peakC`); `H` is the
 * hue in degrees (any angle; cos/sin wrap it). Returns 0 outside L ∈ (0, 1)
 * (black/white points carry no chroma) and 0 if no positive boundary root
 * exists (cannot happen for real L ∈ (0, 1): the gamut is chroma-bounded).
 *
 * Agrees with the 32-iteration bisection oracle (gamut.ts `peakCBisect`, via
 * culori's independent in-gamut predicate) to ≲1e-9 — see test/cusp.test.ts.
 */
export declare function peakCSrgbAnalytic(L: number, H: number): number;
/**
 * Max in-gamut chroma at (L, H) for Display-P3, closed form — SPEC §7,
 * ROADMAP R-18. Same contract as `peakCSrgbAnalytic`; same six-cubic
 * construction over the composed LMS → linear-P3 matrix (`W_P3` above).
 *
 * Agrees with the P3 bisection oracle (gamut.ts `peakCBisect(…, 'p3')`) to
 * ≲1.2e-10 on the 19×36 L×H grid — the oracle's own 32-iteration resolution
 * (0.5/2³² ≈ 1.16e-10) — see test/cusp.test.ts.
 */
export declare function peakCP3Analytic(L: number, H: number): number;
