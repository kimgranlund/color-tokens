// Exporters — SPEC §12. (Split into oklch/css/hex/tokens files later per §13;
// kept together here for the scaffold.) Pure string emitters.
import { CurveRampError } from '../types.js';
import { fit } from '../color/gamut.js';
/** `oklch(L C H)` — or `oklch(L C H / a)` when an alpha (0–1) is given (D-32
 *  scrims). Alpha is orthogonal to the gamut/curve math: it is appended at the
 *  output edge and never touches peakC/cusp/fit. */
const fmtOklch = (o, alpha) => {
    const lch = `${o.L.toFixed(4)} ${o.C.toFixed(4)} ${o.H.toFixed(2)}`;
    return alpha === undefined ? `oklch(${lch})` : `oklch(${lch} / ${Number(alpha.toFixed(4))})`;
};
/** Compact OKLCh JSON: [{ key, oklch }]. */
export function toOklchJson(p) {
    return JSON.stringify(p.swatches.map((s) => ({ key: s.key, oklch: fmtOklch(s.oklch) })), null, 2);
}
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
export function toCssVars(p, opts = {}) {
    const prefix = opts.prefix ?? 'c';
    const seg = opts.family ? `${opts.family}-` : '';
    const gamut = opts.gamut ?? p.spec.displayGamut;
    const colorAt = (s) => gamut === p.spec.displayGamut
        ? s.oklch
        : fit({ L: s.oklch.L, C: s.oklch.C + s.clampedChromaDelta, H: s.oklch.H }, gamut).oklch;
    // Resolve scrim anchors to their swatches up front (honest failure on a typo).
    const anchorKeys = new Map();
    if (opts.scrims) {
        for (const lvl of opts.scrims.levels) {
            if (!(lvl > 0 && lvl <= 1)) {
                throw new CurveRampError('export', `scrim level ${lvl} must be in (0, 1]`, 'scrims.levels');
            }
        }
        for (const a of opts.scrims.anchors) {
            const key = String(a).padStart(3, '0');
            const s = p.swatches.find((w) => w.key === key);
            if (!s)
                throw new CurveRampError('export', `scrim anchor ${a} (key '${key}') is not a stop in this palette`, 'scrims.anchors');
            anchorKeys.set(key, s);
        }
    }
    const lines = [];
    for (const s of p.swatches) {
        lines.push(`  --${prefix}-${seg}${s.key}: ${fmtOklch(colorAt(s))};`);
        const anchor = anchorKeys.get(s.key);
        if (anchor && opts.scrims) {
            const c = colorAt(anchor);
            opts.scrims.levels.forEach((lvl, i) => {
                lines.push(`  --${prefix}-${seg}${s.key}-scrim-${i}: ${fmtOklch(c, lvl)};`);
            });
        }
    }
    return `:root {\n${lines.join('\n')}\n}\n`;
}
/** sRGB hex strings in stop order. */
export function toHex(p) {
    return p.swatches.map((s) => s.hex);
}
/** DTCG document — 2025.10 colour draft shape, experimental (D-6). */
export function toTokens(p) {
    const tokens = {};
    for (const s of p.swatches) {
        tokens[s.key] = {
            $type: 'color',
            $value: {
                colorSpace: 'oklch',
                components: [s.oklch.L, s.oklch.C, s.oklch.H],
                alpha: 1,
                hex: s.hex,
            },
        };
    }
    return {
        $description: 'curve-ramp palette (experimental DTCG 2025.10 colour draft shape)',
        color: tokens,
    };
}
