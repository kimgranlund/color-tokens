import type { Palette, Gamut } from '../types.js';
/** Scrim (alpha-variant) export config (D-32). `anchors` are stop VALUES whose
 *  pad3 key must exist in the palette (e.g. 250 → '250'); `levels` are alpha
 *  fractions in (0, 1]. Each anchor emits `{key}-scrim-{i}` per level. Purely an
 *  EXPORT concern — the engine core stays opaque + single-ramp (D-32 scope ruling). */
export interface ScrimConfig {
    anchors: number[];
    levels: number[];
}
/** Compact OKLCh JSON: [{ key, oklch }]. */
export declare function toOklchJson(p: Palette): string;
/** CSS custom properties using oklch(). e.g. `--c-050: oklch(…);`
 *  opts.gamut (SPEC §12, D-14): export to a display gamut other than the one
 *  the palette was generated for. Each swatch is re-fitted from its IDEAL
 *  (pre-clamp) chroma — recoverable by construction as
 *  `oklch.C + clampedChromaDelta` — so switching gamuts loses nothing.
 *  opts.family (D-32): a name segment → `--{prefix}-{family}-{key}` (e.g.
 *  `--c-blue-050`); a label on the single ramp, not a token graph.
 *  opts.scrims (D-32): emit `{key}-scrim-{i}` alpha variants under named anchor
 *  stops (see ScrimConfig). Throws CurveRampError('export') if an anchor's key is
 *  absent or a level is out of (0, 1] — surfaced, never silent. */
export declare function toCssVars(p: Palette, opts?: {
    prefix?: string;
    gamut?: Gamut;
    family?: string;
    scrims?: ScrimConfig;
}): string;
/** sRGB hex strings in stop order. */
export declare function toHex(p: Palette): string[];
/** The 2025.10 colour draft `$value`: explicit colorSpace + ordered component
 *  tuple, alpha always present, plus the spec's optional `hex` fallback
 *  (sRGB — hex has no P3 form, D-14). */
export interface DtcgColorValue {
    colorSpace: 'oklch';
    /** [L, C, H] — wire-space OKLCH, same values `oklch()` would receive. */
    components: [number, number, number];
    alpha: number;
    hex: string;
}
export interface DtcgColorToken {
    $type: 'color';
    $value: DtcgColorValue;
}
/** DTCG document root. The index signature keeps the document open to the
 *  format's `$`-prefixed root members (groups are arbitrary keys in DTCG);
 *  the two declared members are what this exporter actually emits. */
export interface DtcgDocument {
    [key: string]: string | Record<string, DtcgColorToken>;
    $description: string;
    color: Record<string, DtcgColorToken>;
}
/** DTCG document — 2025.10 colour draft shape, experimental (D-6). */
export declare function toTokens(p: Palette): DtcgDocument;
