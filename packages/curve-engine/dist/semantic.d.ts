import type { Gamut } from './types.js';
import type { PaletteSet } from './set.js';
export interface SemanticOptions {
    prefix?: string;
    gamut?: Gamut;
    /** Prepend the raw tokens (+ scrims) so the file resolves standalone. Default true. */
    includeRaw?: boolean;
}
/** Semantic role tokens (D-35) — `--{role}: light-dark(var(raw-light), var(raw-dark))`
 *  aliases over the raw family tokens, M3-style. One token carries both schemes.
 *  Includes the raw tokens + `color-scheme: light dark` by default so it resolves standalone. */
export declare function toSemanticTokens(set: PaletteSet, opts?: SemanticOptions): string;
/** One mode file (Light or Dark): nested groups of color leaves + the mode name. */
export type FigmaModeFile = Record<string, unknown>;
export interface FigmaOptions {
    gamut?: Gamut;
    /** Override the curve-ramp-family → Figma-group name map (default material/system/positive/critical). */
    groups?: Record<string, string>;
    /** Mark variables publishable to libraries (default false — matches Figma's export). */
    publishable?: boolean;
}
/** Export the palette set as Figma variable files — `{ light, dark }`, each a mode
 *  file in Figma's DTCG import format (write to `Light.tokens.json` / `Dark.tokens.json`
 *  and import in UI3). Every family becomes a group of curve-ramp's semantic roles,
 *  resolved to literal colors per mode (D-42). */
export declare function toFigmaTokens(set: PaletteSet, opts?: FigmaOptions): {
    light: FigmaModeFile;
    dark: FigmaModeFile;
};
