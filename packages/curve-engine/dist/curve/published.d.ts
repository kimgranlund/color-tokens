import type { Channel } from '../types.js';
/** Tailwind v4 `blue` — absolute OKLab L, index 0 = blue-950 (darkest). */
export declare const TAILWIND_V4_BLUE_L: readonly number[];
/** Tailwind v4 `blue` — C normalized against the family max C = 0.245
 *  (blue-600), per D-12. Interior peak ⇒ the mid-scale chroma bell. */
export declare const TAILWIND_V4_BLUE_C: readonly number[];
/** Radix 3 `indigo` (light) — absolute OKLab L, index 0 = indigo12 (darkest). */
export declare const RADIX_3_INDIGO_L: readonly number[];
/** Radix 3 `indigo` (light) — C normalized against the family max C ≈ 0.1954
 *  (indigo10), per D-12. */
export declare const RADIX_3_INDIGO_C: readonly number[];
/** Sample a published curve at normalized t∈[0,1]. Linear interpolation
 *  between stops; t clamps to [0,1] (endpoints hold beyond the table). The
 *  11-stop (Tailwind) vs 12-stop (Radix) difference is absorbed by sampling
 *  at x = t·(len−1). H falls back to `t` (convention #4 above). */
export declare function publishedAt(system: 'tailwind-v4' | 'radix-3', channel: Channel, t: number): number;
/** Value extremes of a published curve over t∈[0,1], in RAW table space
 *  (absolute OKLab L for L tables; family-normalized [0,1] chroma for C
 *  tables; the `t` fallback's span [0,1] for H — convention #4). `publishedAt`
 *  linearly interpolates between stops, so it never exceeds the stop extremes:
 *  the table min/max ARE the curve's range. Consumed by the D-23 Bézier warp
 *  band (curve/stack.ts), which maps these through the SAME transform
 *  evalBase's 'published' branch applies (toe() for L; `min + v·span` else). */
export declare function publishedRange(system: 'tailwind-v4' | 'radix-3', channel: Channel): [number, number];
