import type { Palette } from '../types.js';
/** Signed APCA Lᶜ for `fg` text on `bg`. + = dark-on-light, − = light-on-dark. */
export declare function apcaLc(fgHex: string, bgHex: string): number;
/** N×N signed Lᶜ matrix over a palette's gamut-mapped hexes — SPEC §12.
 *  Entry [i][j] = apcaLc(fg = swatch i, bg = swatch j); rows are foregrounds.
 *  Runs on concrete luminance Y via apcaLc (SPEC §7), never an OKLab-L
 *  approximation. Pure: no mutation, deterministic for a given palette. */
export declare function apcaMatrix(p: Palette): number[][];
/** APCA tier label (informational). Bronze "fluent reading" ≈ 75. */
export declare function apcaTier(lc: number): 'APCA-verified body' | 'APCA-verified large' | 'below';
