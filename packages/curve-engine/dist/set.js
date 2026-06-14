import { CurveRampError } from './types.js';
import { defaultSpec, generate, withScale, parseSpec } from './engine.js';
import { toCssVars } from './export/index.js';
const wrap360 = (h) => ((h % 360) + 360) % 360;
/** Naive hue complement (opposite on the wheel). */
export const complementHue = (h) => wrap360(h + 180);
/** **Split-complementary** pair — the system for *two distinct* complementary
 *  colors (D-33): both flank the brand's complement (h+180) by ±`split`, so they
 *  are complementary to the brand yet distinct from each other. `split = 0` would
 *  collapse to one hue; the default 30° gives a comfortable spread. (Swap to a
 *  triadic scheme by passing split = 60 and reading from h+120/h+240 instead.) */
export function splitComplementary(h, split = 30) {
    const c = h + 180;
    return { secondary: wrap360(c - split), tertiary: wrap360(c + split) };
}
/** Build one family's spec: a hue, an explicit C-bell amplitude `b` (chroma
 *  intensity — neutral ≈ tinted gray at b=0.02, primary at b=0.13), the GLOBAL
 *  min/max light rails (Lr `minLight`–`maxLight`, owner-adjustable), and a fixed
 *  output scale. Each result is a plain, independent spec. */
function familySpec(hue, b, scale, minLight, maxLight) {
    const base = defaultSpec(hue, 11);
    const spec = {
        ...base,
        channels: {
            ...base.channels,
            // Global light range (owner-adjustable): Lr [minLight, maxLight] for every family.
            L: { ...base.channels.L, bounds: { min: minLight, max: maxLight } },
            // Absolute C-bell amplitude per family (defaultSpec's C is sine a=0.01 c=0.5 d=-0.25).
            C: { ...base.channels.C, base: { kind: 'sine', a: 0.01, b, c: 0.5, d: -0.25 } },
        },
    };
    return withScale(spec, scale).spec;
}
/** Seed the default 8-family palette set from a brand hue (D-33). neutral carries
 *  the brand hue at low chroma (a tinted gray); secondary/tertiary are owner-pinned
 *  distinct hues (285/175 — pass `opts.split` to derive a split-complementary pair
 *  from the brand instead); info/success/warning/danger are fixed system hues. Per-
 *  family chroma is the owner's amplitude map. Every family is independently editable. */
export function defaultPaletteSet(brandHue = 235, opts = {}) {
    const scale = opts.scale ?? 25;
    const minLight = opts.minLight ?? 0.075;
    const maxLight = opts.maxLight ?? 1;
    // Pinned owner hues by default; opts.split re-enables brand-derived harmony (D-33).
    const sc = opts.split != null ? splitComplementary(brandHue, opts.split) : null;
    const secondary = opts.secondary ?? sc?.secondary ?? 285;
    const tertiary = opts.tertiary ?? sc?.tertiary ?? 175;
    const fam = (name, hue, b) => ({ name, spec: familySpec(hue, b, scale, minLight, maxLight) });
    return [
        fam('neutral', brandHue, 0.02), // tinted gray — owner b=0.02
        fam('primary', brandHue, 0.13), // the brand/primary family (v0.10: renamed brand → primary)
        fam('secondary', secondary, 0.1),
        fam('tertiary', tertiary, 0.08),
        fam('info', opts.info ?? 255, 0.12),
        fam('success', opts.success ?? 145, 0.14),
        fam('warning', opts.warning ?? 75, 0.2),
        fam('danger', opts.danger ?? 27, 0.14),
    ];
}
/** Validate UNKNOWN input (a decoded URL payload) into a PaletteSet — an array of
 *  `{ name, spec }` where each spec passes `parseSpec` (full §11 validation). Throws
 *  `CurveRampError('invalid-field')` on any shape violation, the §11 contract. The
 *  dual of the studio's full-set hash (D-39); pure. */
export function parsePaletteSet(json) {
    if (!Array.isArray(json)) {
        throw new CurveRampError('invalid-field', 'palette set must be an array of { name, spec }', 'families');
    }
    if (json.length === 0) {
        throw new CurveRampError('invalid-field', 'palette set must have at least one family', 'families');
    }
    return json.map((f, i) => {
        if (typeof f !== 'object' || f === null) {
            throw new CurveRampError('invalid-field', `family ${i} must be an object`, `families.${i}`);
        }
        const name = f.name;
        if (typeof name !== 'string' || name === '') {
            throw new CurveRampError('invalid-field', `family ${i} needs a non-empty string name`, `families.${i}.name`);
        }
        return { name, spec: parseSpec(f.spec) };
    });
}
/** Default scrims — the owner's 250/500/750 @ 10/17.5/25% (D-32/D-33). */
export const DEFAULT_SCRIMS = { anchors: [250, 500, 750], levels: [0.1, 0.175, 0.25] };
/** Strip the `:root { … }` wrapper off a toCssVars block, keeping the indented
 *  var lines, so N families merge into ONE `:root`. */
function innerOf(css) {
    return css.slice(css.indexOf('{') + 1, css.lastIndexOf('}')).replace(/^\n+|\n+$/g, '');
}
/** Full-palette CSS export (D-33): every family's vars as `--{prefix}-{name}-{key}`
 *  in one `:root`, reusing the pure per-family `toCssVars` (D-32). `scrims: true`
 *  emits the default 250/500/750 @ 10/17.5/25% under each family; anchors are
 *  auto-filtered to the keys a family actually has, so it never throws. */
export function toCssVarsSet(set, opts = {}) {
    const scrimCfg = opts.scrims === true ? DEFAULT_SCRIMS : opts.scrims || undefined;
    const blocks = set.map(({ name, spec }) => {
        const p = generate(spec);
        let scrims;
        if (scrimCfg) {
            const keys = new Set(p.swatches.map((s) => s.key));
            const anchors = scrimCfg.anchors.filter((a) => keys.has(String(a).padStart(3, '0')));
            if (anchors.length)
                scrims = { anchors, levels: scrimCfg.levels };
        }
        return innerOf(toCssVars(p, { prefix: opts.prefix, gamut: opts.gamut, family: name, scrims }));
    });
    return `:root {\n${blocks.join('\n')}\n}\n`;
}
