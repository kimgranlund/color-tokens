// Gamut mapping — SPEC §7. peakC(L,H) = max in-gamut chroma; fit() clamps a
// color to gamut and reports the clamp (never silent — Principle P4, AC A6/A7).
//
// Both gamuts take the closed-form analytic cusp (cusp.ts — PLAN M0.1 sRGB,
// ROADMAP R-18 P3; SPEC §7 "Ottosson cusp … fast, analytic"): the six-cubic
// construction is gamut-generic given an LMS → linear-RGB matrix. The ≤32-iter
// bisection over culori's in-gamut predicate is retained as the independent
// test oracle for both paths (`peakCBisect`).
import { inGamut, formatHex } from 'culori';
import { peakCSrgbAnalytic, peakCP3Analytic } from './cusp.js';
const inSrgb = inGamut('rgb');
const inP3 = inGamut('p3');
const co = (c) => ({ mode: 'oklch', l: c.L, c: c.C, h: c.H });
/** Max in-gamut chroma at (L, H) — SPEC §7. Closed-form cusp for both gamuts
 *  (exact to float precision, no iteration): sRGB since M0.1, P3 since R-18. */
export function peakC(L, H, gamut = 'srgb') {
    return gamut === 'srgb' ? peakCSrgbAnalytic(L, H) : peakCP3Analytic(L, H);
}
/** Bisection peakC over culori's in-gamut predicate. ≤32 iters on C ∈ [0, 0.5]
 *  → ~1e-10 resolution. Being a genuinely independent computation, this is the
 *  test oracle for BOTH analytic paths (test/cusp.test.ts, PLAN M0.1
 *  "bisection agreement ±1e-4"; R-18 extends the same gate to P3). Not on any
 *  production path since R-18. */
export function peakCBisect(L, H, gamut = 'srgb') {
    const pred = gamut === 'p3' ? inP3 : inSrgb;
    let lo = 0;
    let hi = 0.5;
    for (let i = 0; i < 32; i++) {
        const mid = (lo + hi) / 2;
        if (pred({ mode: 'oklch', l: L, c: mid, h: H }))
            lo = mid;
        else
            hi = mid;
    }
    return lo;
}
/** The hue's cusp point (Ottosson cusp) — D-24: argmax over L of peakC(L, H,
 *  gamut), as `{ L, C }` with L in OKLab (wire space, matching peakC) and C the
 *  max chroma there. Coarse scan (64 steps over L ∈ (0.01, 0.99)) brackets the
 *  max, then golden-section refines to |ΔL| < 1e-4 — ≤ ~30 peakC evaluations
 *  for the refine (≈ 80 total with the scan; the analytic paths — sRGB M0.1,
 *  P3 R-18 — keep this in the tens of microseconds for both gamuts).
 *  peakC at fixed hue is unimodal in L (the gamut slice's upper boundary rises
 *  to a single cusp corner and falls), so the bracketed golden-section search
 *  converges to the global max. */
export function cusp(H, gamut = 'srgb') {
    const LO = 0.01;
    const HI = 0.99;
    const STEPS = 64;
    const step = (HI - LO) / STEPS;
    // Coarse scan: 64 cell midpoints, strictly inside (0.01, 0.99).
    let bestL = LO + step / 2;
    let bestC = -1;
    for (let i = 0; i < STEPS; i++) {
        const L = LO + (i + 0.5) * step;
        const c = peakC(L, H, gamut);
        if (c > bestC) {
            bestC = c;
            bestL = L;
        }
    }
    // Golden-section refine over the bracketing cells [bestL − step, bestL + step].
    const PHI = (Math.sqrt(5) - 1) / 2; // 1/φ ≈ 0.618
    let a = Math.max(LO, bestL - step);
    let b = Math.min(HI, bestL + step);
    let x1 = b - PHI * (b - a);
    let x2 = a + PHI * (b - a);
    let f1 = peakC(x1, H, gamut);
    let f2 = peakC(x2, H, gamut);
    while (b - a > 1e-4) {
        if (f1 < f2) {
            a = x1;
            x1 = x2;
            f1 = f2;
            x2 = a + PHI * (b - a);
            f2 = peakC(x2, H, gamut);
        }
        else {
            b = x2;
            x2 = x1;
            f2 = f1;
            x1 = b - PHI * (b - a);
            f1 = peakC(x1, H, gamut);
        }
    }
    const L = (a + b) / 2;
    return { L, C: peakC(L, H, gamut) };
}
/** Boundary tolerance for the in-gamut FLAGS (not the clamp): a C clamped
 *  exactly TO the analytic cusp (cusp.ts) can fail culori's predicate by a
 *  float epsilon, flagging an honestly-clamped swatch as OOG (spurious badges
 *  on the default ramp — M3 integration finding). A color counts as in-gamut
 *  if the predicate passes at C or at C − 1e-6. */
const FLAG_EPS = 1e-6;
const inGamutEps = (pred, c) => !!pred(co(c)) || !!pred(co({ ...c, C: Math.max(0, c.C - FLAG_EPS) }));
/** Clamp chroma to the display gamut's cusp; report how much was removed.
 *  inGamut flags describe the IDEAL (pre-clamp) color, so OOG is surfaced.
 *  Invariant (tested in engine.test.ts): clampedChromaDelta === 0 ⇒
 *  inGamut[gamut] === true. */
export function fit(ideal, gamut = 'srgb') {
    const cap = peakC(ideal.L, ideal.H, gamut);
    const clampedC = Math.min(ideal.C, cap);
    const out = { L: ideal.L, C: clampedC, H: ideal.H };
    return {
        oklch: out,
        hex: formatHex(co(out)) ?? '#000000',
        inGamut: { srgb: inGamutEps(inSrgb, ideal), p3: inGamutEps(inP3, ideal) },
        clampedChromaDelta: Math.max(0, ideal.C - clampedC),
    };
}
