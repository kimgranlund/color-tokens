// Published-stop lookup tables — SPEC §5.1 base family `published` (M0.2, D-12).
// Borrow the perceptual "DNA" (lightness/chroma curves) of an established
// system and re-skin it onto the user's hue (the dittoTones idea —
// ref-color/techniques/dittotones-palette-from-systems.md).
//
// Scope (D-12): ONE named reference family per system — Tailwind v4 `blue`
// and Radix Themes 3 `indigo` (light theme). Other families are out of scope
// at v0.1. Regenerate via `node scripts/extract-published.mjs` (provenance:
// the script holds the published source values + the culori conversion).
//
// Conventions (two reversals of expectation — read carefully):
//   1. Stop order is REVERSED from the published systems: this tool's key
//      050 = DARKEST, 950 = LIGHTEST (SPEC §1 "dark→vivid→white"), while
//      Tailwind's 50 / Radix's step 1 are their LIGHTEST. Tables are stored
//      ascending dark→light (index 0 = darkest stop).
//   2. L tables hold absolute OKLab L (wire space). evalBase's 'published'
//      branch converts into the Lr working space via toe() (SPEC §7,
//      src/curve/base.ts) — the toe is NOT pre-applied here.
//   3. C tables hold the family's chroma NORMALIZED to [0,1] against that
//      family's own max C (D-12). evalBase maps the normalized value through
//      `ctx.min + v·span`, where the C channel's resolved max is the live
//      gamut cap peakC(L,H) (SPEC §7) — so the borrowed chroma *shape* rides
//      the user's hue.
//   4. H is intentionally NOT tabulated: hue comes from the seed (SPEC §8 —
//      constant base, optional drift). Published systems' per-stop hue drift
//      is out of scope at v0.1; `publishedAt` falls back to `t` for H.
// ── Tailwind v4 `blue` ──────────────────────────────────────────────────────
// Source: https://tailwindcss.com/docs/colors (fetched 2026-06-09). Tailwind
// v4 publishes its palette directly in oklch() — values below are verbatim,
// reversed to dark→light.
/** Tailwind v4 `blue` — absolute OKLab L, index 0 = blue-950 (darkest). */
export const TAILWIND_V4_BLUE_L = [
    0.282, // blue-950 — oklch(28.2% 0.091 267.935)
    0.379, // blue-900 — oklch(37.9% 0.146 265.522)
    0.424, // blue-800 — oklch(42.4% 0.199 265.638)
    0.488, // blue-700 — oklch(48.8% 0.243 264.376)
    0.546, // blue-600 — oklch(54.6% 0.245 262.881)
    0.623, // blue-500 — oklch(62.3% 0.214 259.815)
    0.707, // blue-400 — oklch(70.7% 0.165 254.624)
    0.809, // blue-300 — oklch(80.9% 0.105 251.813)
    0.882, // blue-200 — oklch(88.2% 0.059 254.128)
    0.932, // blue-100 — oklch(93.2% 0.032 255.585)
    0.97, //  blue-50  — oklch(97% 0.014 254.604)
];
/** Tailwind v4 `blue` — C normalized against the family max C = 0.245
 *  (blue-600), per D-12. Interior peak ⇒ the mid-scale chroma bell. */
export const TAILWIND_V4_BLUE_C = [
    0.3714, // blue-950 — C 0.091 / 0.245
    0.5959, // blue-900 — C 0.146 / 0.245
    0.8122, // blue-800 — C 0.199 / 0.245
    0.9918, // blue-700 — C 0.243 / 0.245
    1, //      blue-600 — C 0.245 / 0.245 (family max)
    0.8735, // blue-500 — C 0.214 / 0.245
    0.6735, // blue-400 — C 0.165 / 0.245
    0.4286, // blue-300 — C 0.105 / 0.245
    0.2408, // blue-200 — C 0.059 / 0.245
    0.1306, // blue-100 — C 0.032 / 0.245
    0.0571, // blue-50  — C 0.014 / 0.245
];
// ── Radix Themes 3 `indigo` (light theme) ───────────────────────────────────
// Source of record: https://www.radix-ui.com/colors (@radix-ui/colors,
// src/light.ts) — published as hex/P3; converted hex → OKLCH (see
// scripts/extract-published.mjs).
// PROVENANCE: hex verified against radix-ui/colors `src/light.ts` (main —
// raw.githubusercontent.com/radix-ui/colors/main/src/light.ts) 2026-06-11:
// all 12 literals match the primary source (closes audit finding F-5's
// provenance debt; the M0.2 transcription was training-sourced during a
// web-tooling outage). The OKLCH numbers below are authoritative for those
// hex: regenerated via culori through scripts/extract-published.mjs during
// M0 integration (script self-checks: L strictly monotone, C peak interior).
// The Tailwind tables above are web-sourced end to end.
/** Radix 3 `indigo` (light) — absolute OKLab L, index 0 = indigo12 (darkest). */
export const RADIX_3_INDIGO_L = [
    0.3126, // indigo12 — #1f2d5c
    0.5092, // indigo11 — #3a5bc7
    0.5106, // indigo10 — #3358d4
    0.5438, // indigo9  — #3e63dd
    0.7309, // indigo8  — #8da4ef
    0.8062, // indigo7  — #abbdf9
    0.862, //  indigo6  — #c1d0ff
    0.9019, // indigo5  — #d2deff
    0.9346, // indigo4  — #e1e9ff
    0.9609, // indigo3  — #edf2fe
    0.9823, // indigo2  — #f7f9ff
    0.9943, // indigo1  — #fdfdfe
];
/** Radix 3 `indigo` (light) — C normalized against the family max C ≈ 0.1954
 *  (indigo10), per D-12. */
export const RADIX_3_INDIGO_C = [
    0.4393, // indigo12 — C 0.0858 / 0.1954
    0.8829, // indigo11 — C 0.1725 / 0.1954
    1, //      indigo10 — C 0.1954 / 0.1954 (family max)
    0.9777, // indigo9  — C 0.1910 / 0.1954
    0.575, //  indigo8  — C 0.1123 / 0.1954
    0.4481, // indigo7  — C 0.0875 / 0.1954
    0.3456, // indigo6  — C 0.0675 / 0.1954
    0.2413, // indigo5  — C 0.0471 / 0.1954
    0.1589, // indigo4  — C 0.0310 / 0.1954
    0.0868, // indigo3  — C 0.0170 / 0.1954
    0.0422, // indigo2  — C 0.0083 / 0.1954
    0.0067, // indigo1  — C 0.0013 / 0.1954
];
function tableFor(system, channel) {
    return system === 'tailwind-v4'
        ? channel === 'L'
            ? TAILWIND_V4_BLUE_L
            : TAILWIND_V4_BLUE_C
        : channel === 'L'
            ? RADIX_3_INDIGO_L
            : RADIX_3_INDIGO_C;
}
/** Sample a published curve at normalized t∈[0,1]. Linear interpolation
 *  between stops; t clamps to [0,1] (endpoints hold beyond the table). The
 *  11-stop (Tailwind) vs 12-stop (Radix) difference is absorbed by sampling
 *  at x = t·(len−1). H falls back to `t` (convention #4 above). */
export function publishedAt(system, channel, t) {
    if (channel === 'H')
        return t; // hue comes from the seed (SPEC §8); drift out of scope v0.1
    const table = tableFor(system, channel);
    const x = Math.min(1, Math.max(0, t)) * (table.length - 1);
    const i = Math.floor(x);
    const f = x - i;
    const a = table[i];
    const b = table[Math.min(i + 1, table.length - 1)];
    return a + (b - a) * f;
}
/** Value extremes of a published curve over t∈[0,1], in RAW table space
 *  (absolute OKLab L for L tables; family-normalized [0,1] chroma for C
 *  tables; the `t` fallback's span [0,1] for H — convention #4). `publishedAt`
 *  linearly interpolates between stops, so it never exceeds the stop extremes:
 *  the table min/max ARE the curve's range. Consumed by the D-23 Bézier warp
 *  band (curve/stack.ts), which maps these through the SAME transform
 *  evalBase's 'published' branch applies (toe() for L; `min + v·span` else). */
export function publishedRange(system, channel) {
    if (channel === 'H')
        return [0, 1];
    const table = tableFor(system, channel);
    let lo = table[0]; // tables are non-empty by construction
    let hi = table[0];
    for (const v of table) {
        if (v < lo)
            lo = v;
        if (v > hi)
            hi = v;
    }
    return [lo, hi];
}
