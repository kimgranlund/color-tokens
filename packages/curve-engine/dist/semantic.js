import { generate } from './engine.js';
import { toCssVarsSet } from './set.js';
const ACCENT_LIFT = 100; // accents brighten by this many tone-units in dark scheme
const SCRIM_ANCHORS = [250, 500, 750];
/** Each accent gets a COMPLETE semantic set (every role), namespaced
 *  `--{prefix}-{accent}-{role}` (v0.10). `role` = the set name + the accent-role
 *  prefix; `family` = the raw ramp every role in the set draws from (incl. the
 *  surfaces — v0.14, owner: accent-tinted, not all neutral). role === family. */
const ACCENTS = [
    { role: 'neutral', family: 'neutral' }, // a full semantic set on the neutral family too
    { role: 'primary', family: 'primary' },
    { role: 'secondary', family: 'secondary' },
    { role: 'tertiary', family: 'tertiary' },
    { role: 'danger', family: 'danger' }, // owner: use the family name (--c-danger, not --c-error)
    { role: 'info', family: 'info' },
    { role: 'success', family: 'success' },
    { role: 'warning', family: 'warning' },
];
/** camelCase → kebab-case ('onPrimary' → 'on-primary', 'surfaceBright' → 'surface-bright'). */
const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
/** The var suffix for a role under an accent set: '' when role === accent, the
 *  stripped tail when the role repeats the accent prefix (primaryDim → '-dim'),
 *  else the full kebab role (onPrimary → '-on-primary', surface → '-surface'). */
function suffixFor(role, accent) {
    if (role === accent)
        return '';
    if (role.startsWith(accent) && role.length > accent.length && role[accent.length] === role[accent.length].toUpperCase()) {
        return '-' + kebab(role.slice(accent.length));
    }
    return '-' + kebab(role);
}
/** Per-accent role variants (owner-pinned, applied uniformly to every accent —
 *  M3 uses the same tonal map across palettes). `lift` = derive dark by lifting
 *  the accent (brighter on dark); else mirror (text/on-colors). All draw from the
 *  accent family (on{Accent}* are brand/accent-tinted, not pure neutral). */
const ACCENT_VARIANTS = [
    { suffix: '', lift: true, role: { light: 450, dark: 550 } }, // primary → light-dark(*-450, *-550)
    { suffix: 'Bright', lift: true, role: { light: 650 } }, // Bright = lighter
    { suffix: 'Dim', lift: true, role: { light: 350 } }, // Dim = darker
    { suffix: 'High', lift: true, role: { light: 350, dark: 650 } }, // High → light-dark(350, 650)
    { suffix: 'Low', lift: true, role: { light: 650, dark: 350 } }, // Low → light-dark(650, 350)
    { suffix: 'Variant', on: true, lift: false, role: { light: 800 } }, // onPrimaryVariant → brand 800
    { suffix: '', on: true, lift: false, role: { light: 950 } }, // onPrimary → brand 950 (mirror → 050 dark)
];
/** Global neutral roles (light tone; dark = mirror unless pinned). */
const NEUTRAL = {
    onSurface: { light: 50, dark: 950 }, // owner: light-dark(*-050, *-950) — high-contrast ink
    onSurfaceVariant: { light: 350 },
    outline: { light: 500, dark: 500 }, // owner: outline → 500 (same both)
    outlineVariant: { light: { tone: 250, scrim: 2 }, dark: { tone: 750, scrim: 2 } }, // owner: scrim-2 pair
    container: { light: 850 },
    containerLow: { light: 825 },
    containerHigh: { light: 900 },
    inverseSurface: { light: 100 },
    inverseOnSurface: { light: 950 },
    // The surface elevation ladder (owner) — a symmetric 7-step ladder around the
    // base (875), every-25 from 950 (dimmest) to 800 (brightest); background maps
    // to dim (900). The ¼-end scales (25/37) give each role a DISTINCT tone;
    // dark = mirror (1000 − light).
    background: { light: 900 }, // = surfaceDim
    surfaceDimmest: { light: 950 },
    surfaceDimmer: { light: 925 },
    surfaceDim: { light: 900 },
    surface: { light: 875 }, // base / mid-point
    surfaceBright: { light: 850 },
    surfaceBrighter: { light: 825 },
    surfaceBrightest: { light: 800 },
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const toneOf = (t) => (typeof t === 'number' ? t : t.tone);
const scrimOf = (t) => (typeof t === 'number' ? undefined : t.scrim);
/** Nearest value in `candidates` to `tone`. */
function nearest(candidates, tone) {
    let best = candidates[0];
    let bestD = Infinity;
    for (const c of candidates) {
        const d = Math.abs(c - tone);
        if (d < bestD) {
            bestD = d;
            best = c;
        }
    }
    return best;
}
/** Derive the dark tone from the light tone when a role pins only light:
 *  accents lift toward the light end; neutrals mirror across the scale. */
const deriveDark = (light, accent) => accent ? Math.min(950, light + ACCENT_LIFT) : 1000 - light;
/** Semantic role tokens (D-35) — `--{role}: light-dark(var(raw-light), var(raw-dark))`
 *  aliases over the raw family tokens, M3-style. One token carries both schemes.
 *  Includes the raw tokens + `color-scheme: light dark` by default so it resolves standalone. */
export function toSemanticTokens(set, opts = {}) {
    const prefix = opts.prefix ?? 'c';
    /** family → { keys, scrimAnchors } from the generated palette. */
    const info = new Map();
    for (const f of set) {
        const keys = generate(f.spec).swatches.map((s) => Number(s.key));
        info.set(f.name, { keys, anchors: SCRIM_ANCHORS.filter((a) => keys.includes(a)) });
    }
    const pad3 = (n) => String(n).padStart(3, '0');
    /** One `var(--prefix-family-key[-scrim-i])` alias for a tone in a family. */
    function alias(family, t) {
        const fi = info.get(family);
        if (!fi)
            return null;
        const scrim = scrimOf(t);
        if (scrim != null) {
            if (!fi.anchors.length)
                return null;
            const key = nearest(fi.anchors, toneOf(t));
            return `var(--${prefix}-${family}-${pad3(key)}-scrim-${scrim})`;
        }
        return `var(--${prefix}-${family}-${pad3(nearest(fi.keys, toneOf(t)))})`;
    }
    /** A `{varName}: light-dark(L, D);` line (collapses to a single var when L === D). */
    function lineFor(varName, family, role, lift) {
        const light = alias(family, role.light);
        const dark = alias(family, role.dark ?? deriveDark(toneOf(role.light), lift));
        if (!light || !dark)
            return null;
        return light === dark ? `  ${varName}: ${light};` : `  ${varName}: light-dark(${light}, ${dark});`;
    }
    // Every accent gets a COMPLETE set (v0.10): ALL roles — accent variants AND the
    // surface/outline/container/… roles — draw from the accent's OWN family (v0.14,
    // owner: accent-tinted surfaces, not all neutral). The `neutral` accent therefore
    // yields the gray surface set; primary/danger/… yield family-tinted ones.
    const lines = [];
    for (const { role: accentRole, family } of ACCENTS) {
        if (!info.has(family))
            continue;
        const block = [];
        for (const v of ACCENT_VARIANTS) {
            const roleName = v.on ? `on${cap(accentRole)}${v.suffix}` : `${accentRole}${v.suffix}`;
            const varName = `--${prefix}-${accentRole}${suffixFor(roleName, accentRole)}`;
            const l = lineFor(varName, family, v.role, v.lift);
            if (l)
                block.push(l);
        }
        for (const [roleName, role] of Object.entries(NEUTRAL)) {
            const l = lineFor(`--${prefix}-${accentRole}-${kebab(roleName)}`, family, role, false);
            if (l)
                block.push(l);
        }
        if (block.length)
            lines.push(`  /* ${accentRole} */`, ...block);
    }
    const semantic = `  color-scheme: light dark;\n  /* semantic roles (D-35) → raw tokens, light-dark() */\n${lines.join('\n')}`;
    if (opts.includeRaw === false)
        return `:root {\n${semantic}\n}\n`;
    const raw = toCssVarsSet(set, { prefix, gamut: opts.gamut, scrims: true });
    return raw.replace(/\n\}\n$/, `\n\n${semantic}\n}\n`);
}
// ── Figma variable export (D-42) ─────────────────────────────────────────────
// Figma UI3 imports the W3C DTCG format + `com.figma.*` extensions, ONE file per
// collection MODE. We emit the SAME semantic taxonomy as toSemanticTokens, but as
// two mode files (Light/Dark) of LITERAL colors (Figma resolves modes itself, so
// no light-dark()). Each family is a group of color roles; the curve-ramp role
// tones resolve to the family's swatch hex per mode. The format matches the user's
// reference figma-tokens export exactly (minus the import-assigned variableId).
/** curve-ramp family → Figma group name (the reference design system's names). */
const FIGMA_GROUP = { neutral: 'material', info: 'system', success: 'positive', danger: 'critical' };
/** Scrim alpha per index 0/1/2 — the owner's 10 / 17.5 / 25 % (set.ts DEFAULT_SCRIMS). */
const FIGMA_SCRIM_LEVELS = [0.1, 0.175, 0.25];
const hexToComponents = (hex) => [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
];
/** Export the palette set as Figma variable files — `{ light, dark }`, each a mode
 *  file in Figma's DTCG import format (write to `Light.tokens.json` / `Dark.tokens.json`
 *  and import in UI3). Every family becomes a group of curve-ramp's semantic roles,
 *  resolved to literal colors per mode (D-42). */
export function toFigmaTokens(set, opts = {}) {
    const groupOf = (fam) => opts.groups?.[fam] ?? FIGMA_GROUP[fam] ?? fam;
    const hidden = opts.publishable !== true;
    const leaf = (value) => ({
        $type: 'color',
        $value: value,
        $extensions: { 'com.figma.hiddenFromPublishing': hidden, 'com.figma.scopes': ['ALL_SCOPES'] },
    });
    // Generate every family once → its keys + key→hex, for nearest-tone resolution.
    const palettes = new Map();
    for (const f of set) {
        const sw = generate(f.spec).swatches;
        palettes.set(f.name, { keys: sw.map((s) => Number(s.key)), byKey: new Map(sw.map((s) => [Number(s.key), s.hex])) });
    }
    /** Resolve a role tone (+ optional scrim alpha) to a Figma color in `fam`. */
    function color(fam, tone) {
        const p = palettes.get(fam);
        if (!p)
            return null;
        const hex = (p.byKey.get(nearest(p.keys, toneOf(tone))) ?? '').toUpperCase();
        if (!hex)
            return null;
        const scrim = scrimOf(tone);
        return { colorSpace: 'srgb', components: hexToComponents(hex), alpha: scrim != null ? FIGMA_SCRIM_LEVELS[scrim] : 1, hex };
    }
    /** The tone a role takes in a given mode (light pin, or derived/pinned dark). */
    const toneFor = (role, lift, mode) => mode === 'light' ? role.light : (role.dark ?? deriveDark(toneOf(role.light), lift));
    function build(mode) {
        const root = {};
        for (const f of set) {
            const group = groupOf(f.name);
            const Group = cap(group);
            const roles = {};
            // Accent variants — named with the GROUP prefix (materialDim, onPrimary, …).
            for (const v of ACCENT_VARIANTS) {
                const name = v.on ? `on${Group}${v.suffix}` : `${group}${v.suffix}`;
                const c = color(f.name, toneFor(v.role, v.lift, mode));
                if (c)
                    roles[name] = leaf(c);
            }
            // Shared surface/outline/container/… roles — drawn from the family itself (D-38).
            for (const [name, role] of Object.entries(NEUTRAL)) {
                const c = color(f.name, toneFor(role, false, mode));
                if (c)
                    roles[name] = leaf(c);
            }
            root[group] = roles;
        }
        root['$extensions'] = { 'com.figma.modeName': mode === 'light' ? 'Light' : 'Dark' };
        return root;
    }
    return { light: build('light'), dark: build('dark') };
}
