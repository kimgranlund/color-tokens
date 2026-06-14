// APCA contrast — SPEC §7. Informational readout ONLY. apca-w3@0.1.9 (algorithm
// frozen 2021), on concrete luminance Y. Report "APCA-verified" — NEVER
// "WCAG 3 compliant": APCA is not in WCAG 3 (a Working Draft with no contrast
// algorithm). See ref-color/techniques/apca-lc-formula.md + Token Studio AGENTS.md.
import { APCAcontrast, sRGBtoY } from 'apca-w3';
import { converter } from 'culori';
const toRgb = converter('rgb');
function rgb255(hex) {
    const c = toRgb(hex);
    if (!c)
        return [0, 0, 0];
    return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
}
/** Signed APCA Lᶜ for `fg` text on `bg`. + = dark-on-light, − = light-on-dark. */
export function apcaLc(fgHex, bgHex) {
    return Number(APCAcontrast(sRGBtoY(rgb255(fgHex)), sRGBtoY(rgb255(bgHex))));
}
/** N×N signed Lᶜ matrix over a palette's gamut-mapped hexes — SPEC §12.
 *  Entry [i][j] = apcaLc(fg = swatch i, bg = swatch j); rows are foregrounds.
 *  Runs on concrete luminance Y via apcaLc (SPEC §7), never an OKLab-L
 *  approximation. Pure: no mutation, deterministic for a given palette. */
export function apcaMatrix(p) {
    return p.swatches.map((fg) => p.swatches.map((bg) => apcaLc(fg.hex, bg.hex)));
}
/** APCA tier label (informational). Bronze "fluent reading" ≈ 75. */
export function apcaTier(lc) {
    const a = Math.abs(lc);
    if (a >= 75)
        return 'APCA-verified body';
    if (a >= 60)
        return 'APCA-verified large';
    return 'below';
}
