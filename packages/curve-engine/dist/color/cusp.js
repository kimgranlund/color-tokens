// Closed-form max in-gamut chroma for RGB gamuts (sRGB + Display-P3) — SPEC §7
// (peakC default: Ottosson cusp, "fast, analytic"); PLAN M0.1 (sRGB), ROADMAP
// R-18 (P3). Hand-rolling these matrices is the one sanctioned exception to
// "use culori for conversions" (SPEC §9 Non-Scope #5: "…beyond the documented
// `peakC`/cusp helpers").
//
// Derivation. Fix OKLab lightness L and hue angle H, and let the unit hue
// direction be (a, b) = (cos H, sin H), so OKLab = (L, C·a, C·b). The OKLab →
// LMS' step (Ottosson's M2⁻¹, whose first column is exactly 1 — the defining
// OKLab property) makes each cube-root cone response LINEAR in C:
//
//     lms'ᵢ(C) = L + C·kᵢ,   kᵢ = M2⁻¹[i][1]·a + M2⁻¹[i][2]·b
//
// Cubing (LMS' → LMS) and applying a linear LMS → linear-RGB matrix makes
// each linear-RGB channel a CUBIC polynomial in C:
//
//     ch(C) = Σᵢ wᵢ·(L + C·kᵢ)³ = c₃C³ + c₂C² + c₁C + c₀
//       c₃ = Σ wᵢkᵢ³   c₂ = 3L·Σ wᵢkᵢ²   c₁ = 3L²·Σ wᵢkᵢ   c₀ = L³·Σ wᵢ
//
// At C = 0 every channel equals L³ ∈ (0, 1) (each w-row sums to 1: white maps
// to white), i.e. strictly inside the unit RGB cube. The gamut boundary is the
// first C > 0 at which ANY channel exits [0, 1] — the smallest positive real
// root over the 6 cubics {ch(C) = 0, ch(C) = 1 : ch ∈ r, g, b}. Exact to float
// precision; replaces the 32-iteration bisection hot path (gamut.ts).
//
// The construction is gamut-generic: NOTHING above is sRGB-specific except the
// LMS → linear-RGB weight rows. sRGB uses Ottosson's published matrix; P3 uses
// the same pipeline with LMS → linear-Display-P3, composed below (R-18) from
// the CSS Color 4 matrices: LMS → linear-sRGB → XYZ-D65 → linear-P3.
//
// Smallest-positive-root is a SEMANTIC choice, not just an algorithm: the
// in-gamut set along a constant-(L,H) chroma ray is not always convex. At
// #0000ff's exact (L, H) the R channel dips negative over C ∈ (0.2656, 0.3132)
// and returns to 0 precisely at the corner — the corner is an isolated
// in-gamut touch point (measured against culori, test/cusp.test.ts). A clamp
// ceiling must be the CONNECTED-from-zero boundary, or clamped colors between
// the two roots would ship out of gamut (SPEC §7, P4 in-gamut-by-construction).
// The bisection oracle converges to the same connected boundary. (Display-P3
// exhibits NO such non-convexity at any of its six cube corners — measured
// 2026-06-12, pinned in test/cusp.test.ts — but smallest-positive-root remains
// the normative semantics for both gamuts.)
//
// Constants: Björn Ottosson, "A perceptual color space for image processing"
// (bottosson.github.io/posts/oklab) — M2⁻¹ (OKLab → LMS') and LMS → linear
// sRGB, at float64 precision as re-derived from the sRGB primaries (identical
// to culori's; the blog's 10-digit values agree to ~1e-8).
// ─── Ottosson pipeline constants ─────────────────────────────────────────────
/** M2⁻¹ rows, (a, b) columns only — the L column is exactly 1. lms'ᵢ = L + a·col₁ + b·col₂. */
const K_L = [0.3963377773761749, 0.2158037573099136];
const K_M = [-0.1055613458156586, -0.0638541728258133];
const K_S = [-0.0894841775298119, -1.2914855480194092];
/** LMS (cubed) → linear sRGB, one row per channel. Each row sums to 1. */
const W_R = [4.0767416360759574, -3.3077115392580616, 0.2309699031821044];
const W_G = [-1.2684379732850317, 2.6097573492876887, -0.3413193760026573];
const W_B = [-0.0041960761386756, -0.7034186179359362, 1.7076146940746117];
/** linear sRGB → XYZ D65 (CSS Color 4). */
const M_LRGB_TO_XYZ = [
    [0.4123907992659593, 0.357584339383878, 0.1804807884018343],
    [0.2126390058715102, 0.715168678767756, 0.0721923153607337],
    [0.0193308187155918, 0.119194779794626, 0.9505321522496607],
];
/** XYZ D65 → linear Display-P3 (CSS Color 4). */
const M_XYZ_TO_P3 = [
    [2.4934969119414263, -0.9313836179191242, -0.402710784450717],
    [-0.8294889695615749, 1.7626640603183465, 0.0236246858419436],
    [0.0358458302437845, -0.0761723892680418, 0.9568845240076871],
];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const col3 = (M, j) => [M[0][j], M[1][j], M[2][j]];
const mulRow3 = (r, M) => [dot3(r, col3(M, 0)), dot3(r, col3(M, 1)), dot3(r, col3(M, 2))];
const mul3 = (A, B) => [mulRow3(A[0], B), mulRow3(A[1], B), mulRow3(A[2], B)];
/** LMS (cubed) → linear sRGB, as a matrix (rows = W_R/W_G/W_B above). */
const W_SRGB = [W_R, W_G, W_B];
/** LMS (cubed) → linear Display-P3 = (XYZ→P3)·(lsRGB→XYZ)·(LMS→lsRGB).
 *  Composed value (for reference; the code uses the live composition):
 *    [ 3.127768971361874, -2.257135762591639,  0.129366791229765]
 *    [-1.091009018437799,  2.413331710306923, -0.322322691869125]
 *    [-0.026010801938570, -0.508041331704167,  1.534052133642737] */
const W_P3 = mul3(mul3(M_XYZ_TO_P3, M_LRGB_TO_XYZ), W_SRGB);
// ─── Robust real-root solvers ────────────────────────────────────────────────
const TWO_THIRDS_PI = (2 * Math.PI) / 3;
/** Two Newton iterations on the ORIGINAL cubic — polishes Cardano/trig roots
 *  (and borderline-discriminant estimates) to float precision. */
function polish(a, b, c, d, x) {
    for (let i = 0; i < 2; i++) {
        const f = ((a * x + b) * x + c) * x + d;
        const fp = (3 * a * x + 2 * b) * x + c;
        if (fp === 0)
            break;
        const step = f / fp;
        if (!Number.isFinite(step))
            break;
        x -= step;
    }
    return x;
}
/** Real roots of b·x² + c·x + d = 0 (numerically stable; degenerate-safe). */
function solveQuadraticReal(b, c, d) {
    if (Math.abs(b) < 1e-12 * Math.max(Math.abs(c), Math.abs(d), 1)) {
        return Math.abs(c) < 1e-30 ? [] : [-d / c]; // linear (or constant: no roots)
    }
    const disc = c * c - 4 * b * d;
    if (disc < 0)
        return [];
    const sq = Math.sqrt(disc);
    const q = -0.5 * (c + (c >= 0 ? sq : -sq)); // avoids catastrophic cancellation
    if (q === 0)
        return [0]; // c = 0 ∧ disc = 0 ⇒ double root at 0
    return [q / b, d / q];
}
/** Real roots of a·x³ + b·x² + c·x + d = 0. Degenerates to quadratic/linear
 *  when leading coefficients vanish; Cardano (1 real) / trigonometric (3 real)
 *  by discriminant, with an explicit repeated-root branch; Newton-polished. */
function solveCubicReal(a, b, c, d) {
    // Near-zero leading term: the third root is O(|b/a|) → astronomically larger
    // than any chroma; the quadratic restriction loses nothing we keep (C < 0.5).
    if (Math.abs(a) < 1e-10 * Math.max(Math.abs(b), Math.abs(c), Math.abs(d), 1e-30)) {
        return solveQuadraticReal(b, c, d);
    }
    // Normalize, then depress: x = t − p/3 ⇒ t³ + P·t + Q = 0.
    const p = b / a;
    const q = c / a;
    const r = d / a;
    const P = q - (p * p) / 3;
    const Q = ((2 * p * p * p) / 27 - (p * q) / 3) + r;
    const shift = -p / 3;
    const disc = (Q * Q) / 4 + (P * P * P) / 27;
    let roots;
    if (disc > 1e-14) {
        // One real root — Cardano.
        const sq = Math.sqrt(disc);
        roots = [Math.cbrt(-Q / 2 + sq) + Math.cbrt(-Q / 2 - sq) + shift];
    }
    else if (disc < -1e-14) {
        // Three distinct real roots — trigonometric method (P < 0 is implied).
        const m = 2 * Math.sqrt(-P / 3);
        const cosArg = Math.min(1, Math.max(-1, (3 * Q) / (P * m)));
        const theta = Math.acos(cosArg) / 3;
        roots = [
            m * Math.cos(theta) + shift,
            m * Math.cos(theta - TWO_THIRDS_PI) + shift,
            m * Math.cos(theta - 2 * TWO_THIRDS_PI) + shift,
        ];
    }
    else if (Math.abs(P) < 1e-9) {
        roots = [shift]; // P ≈ Q ≈ 0 ⇒ triple root
    }
    else {
        // disc ≈ 0 ⇒ a simple root 3Q/P and a double root −3Q/(2P).
        roots = [(3 * Q) / P + shift, (-3 * Q) / (2 * P) + shift];
    }
    return roots.map((x) => polish(a, b, c, d, x));
}
// ─── peakC, analytic ─────────────────────────────────────────────────────────
/** Smallest C > 0 at which this channel's cubic hits 0 or 1; +∞ if neither. */
function channelBoundaryC(wl, wm, ws, kl, km, ks, L) {
    const c3 = wl * kl * kl * kl + wm * km * km * km + ws * ks * ks * ks;
    const c2 = 3 * L * (wl * kl * kl + wm * km * km + ws * ks * ks);
    const c1 = 3 * L * L * (wl * kl + wm * km + ws * ks);
    const c0 = L * L * L * (wl + wm + ws);
    let best = Infinity;
    for (const bound of [0, 1]) {
        for (const root of solveCubicReal(c3, c2, c1, c0 - bound)) {
            if (root > 1e-12 && root < best)
                best = root;
        }
    }
    return best;
}
/** The gamut-generic core: smallest positive boundary root over the six
 *  cubics of the given LMS → linear-RGB matrix. See the header derivation. */
function peakCAnalytic(L, H, W) {
    if (!(L > 0 && L < 1))
        return 0; // also rejects NaN
    const h = (H * Math.PI) / 180;
    const a = Math.cos(h);
    const b = Math.sin(h);
    // Per-cone slope of LMS' in C — the linearity at the heart of the closed form.
    const kl = K_L[0] * a + K_L[1] * b;
    const km = K_M[0] * a + K_M[1] * b;
    const ks = K_S[0] * a + K_S[1] * b;
    const best = Math.min(channelBoundaryC(W[0][0], W[0][1], W[0][2], kl, km, ks, L), channelBoundaryC(W[1][0], W[1][1], W[1][2], kl, km, ks, L), channelBoundaryC(W[2][0], W[2][1], W[2][2], kl, km, ks, L));
    return Number.isFinite(best) ? best : 0;
}
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
export function peakCSrgbAnalytic(L, H) {
    return peakCAnalytic(L, H, W_SRGB);
}
/**
 * Max in-gamut chroma at (L, H) for Display-P3, closed form — SPEC §7,
 * ROADMAP R-18. Same contract as `peakCSrgbAnalytic`; same six-cubic
 * construction over the composed LMS → linear-P3 matrix (`W_P3` above).
 *
 * Agrees with the P3 bisection oracle (gamut.ts `peakCBisect(…, 'p3')`) to
 * ≲1.2e-10 on the 19×36 L×H grid — the oracle's own 32-iteration resolution
 * (0.5/2³² ≈ 1.16e-10) — see test/cusp.test.ts.
 */
export function peakCP3Analytic(L, H) {
    return peakCAnalytic(L, H, W_P3);
}
