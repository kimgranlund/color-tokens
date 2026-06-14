import type { PaletteSpec, Gamut } from './types.js';
import type { ScaleId } from './engine.js';
import type { ScrimConfig } from './export/index.js';
export interface PaletteFamily {
    name: string;
    spec: PaletteSpec;
}
/** Ordered list of named, independent ramps. */
export type PaletteSet = PaletteFamily[];
/** Naive hue complement (opposite on the wheel). */
export declare const complementHue: (h: number) => number;
/** **Split-complementary** pair — the system for *two distinct* complementary
 *  colors (D-33): both flank the brand's complement (h+180) by ±`split`, so they
 *  are complementary to the brand yet distinct from each other. `split = 0` would
 *  collapse to one hue; the default 30° gives a comfortable spread. (Swap to a
 *  triadic scheme by passing split = 60 and reading from h+120/h+240 instead.) */
export declare function splitComplementary(h: number, split?: number): {
    secondary: number;
    tertiary: number;
};
export interface PaletteSetOptions {
    /** Hue split for the secondary/tertiary split-complementary pair (deg); when
     *  given, derives the pair from the brand instead of the pinned 285/175. */
    split?: number;
    /** Fixed output scale every family uses (default 25 — the semantic-complete grid). */
    scale?: ScaleId;
    /** Family hues (OKLCh degrees) — owner-overridable. */
    secondary?: number;
    tertiary?: number;
    info?: number;
    success?: number;
    warning?: number;
    danger?: number;
    /** GLOBAL light rails (Lr) on every family's L channel — default 0.075 (7.5%) … 1.0 (100%). */
    minLight?: number;
    maxLight?: number;
}
/** Seed the default 8-family palette set from a brand hue (D-33). neutral carries
 *  the brand hue at low chroma (a tinted gray); secondary/tertiary are owner-pinned
 *  distinct hues (285/175 — pass `opts.split` to derive a split-complementary pair
 *  from the brand instead); info/success/warning/danger are fixed system hues. Per-
 *  family chroma is the owner's amplitude map. Every family is independently editable. */
export declare function defaultPaletteSet(brandHue?: number, opts?: PaletteSetOptions): PaletteSet;
/** Validate UNKNOWN input (a decoded URL payload) into a PaletteSet — an array of
 *  `{ name, spec }` where each spec passes `parseSpec` (full §11 validation). Throws
 *  `CurveRampError('invalid-field')` on any shape violation, the §11 contract. The
 *  dual of the studio's full-set hash (D-39); pure. */
export declare function parsePaletteSet(json: unknown): PaletteSet;
/** Default scrims — the owner's 250/500/750 @ 10/17.5/25% (D-32/D-33). */
export declare const DEFAULT_SCRIMS: ScrimConfig;
/** Full-palette CSS export (D-33): every family's vars as `--{prefix}-{name}-{key}`
 *  in one `:root`, reusing the pure per-family `toCssVars` (D-32). `scrims: true`
 *  emits the default 250/500/750 @ 10/17.5/25% under each family; anchors are
 *  auto-filtered to the keys a family actually has, so it never throws. */
export declare function toCssVarsSet(set: PaletteSet, opts?: {
    prefix?: string;
    gamut?: Gamut;
    scrims?: boolean | ScrimConfig;
}): string;
