// PaletteEngine — SPEC §4, §12. Composes the three ChannelStacks + hue + count
// into N OKLrCh triples, then gamut-maps to OKLCh output. Pure + deterministic.
import { CurveRampError } from './types.js';
import { sampleChannel } from './curve/stack.js';
import { IDENTITY_WARP, validateWarp } from './curve/bezier.js';
import { toeInv } from './color/oklrch.js';
import { fit, peakC } from './color/gamut.js';
import { keyForIndex, keyForStop } from './keys.js';
const fail = (msg, field) => {
    throw new CurveRampError('invalid-field', msg, field);
};
const CHANNELS = ['L', 'C', 'H'];
// ── Validation — SPEC §11 (MUST rules), complete per M0.7 ───────────────────
/** Validate a PaletteSpec against EVERY SPEC §11 rule. Throws
 *  CurveRampError('invalid-field', msg, field) with a precise field path
 *  (e.g. 'channels.C.base.gamma') on the first violation. The only sanctioned
 *  coercion is hue-wrap (mod 360), which happens in parseSpec — here hue must
 *  simply be finite. */
export function validateSpec(spec) {
    if (spec == null || typeof spec !== 'object')
        fail('spec must be an object', 'spec');
    if (spec.version !== '0.1.0')
        fail("version must be '0.1.0'", 'version');
    // D-11: count ∈ [2, 91]. 91 is the KEY-UNIQUENESS bound — keyForIndex rounds
    // an even spread over [50, 950] to the nearest 10, and the stop spacing drops
    // below 10 at N = 92, producing duplicate keys that would silently overwrite
    // entries in toTokens/toCssVars (PLAN §1.9, D-11).
    if (!Number.isInteger(spec.count) || spec.count < 2 || spec.count > 91) {
        fail('count must be an integer in [2, 91]', 'count');
    }
    // Explicit positional stops (D-32): strictly ascending unique integers in
    // [0, 1000], length === count. Strict ascent guarantees unique pad3 keys (so
    // the D-11 key-collision concern is satisfied by construction here, not by the
    // count bound). Absent ⇒ uniform sampling.
    if (spec.stops !== undefined) {
        const s = spec.stops;
        if (!Array.isArray(s))
            fail('stops must be an array', 'stops');
        if (s.length !== spec.count)
            fail(`stops.length (${s.length}) must equal count (${spec.count})`, 'stops');
        let prev = -1;
        for (let i = 0; i < s.length; i++) {
            const v = s[i];
            if (!Number.isInteger(v) || v < 0 || v > 1000) {
                fail(`stops[${i}] must be an integer in [0, 1000]`, `stops.${i}`);
            }
            if (v <= prev)
                fail(`stops must be strictly ascending (stops[${i}] = ${v} ≤ ${prev})`, `stops.${i}`);
            prev = v;
        }
    }
    // Hue must be finite; wrapping mod 360 is the sanctioned coercion (parseSpec).
    if (typeof spec.hue !== 'number' || !Number.isFinite(spec.hue)) {
        fail('hue must be a finite number (wrapped mod 360)', 'hue');
    }
    if (spec.displayGamut !== 'srgb' && spec.displayGamut !== 'p3') {
        fail("displayGamut must be 'srgb' or 'p3'", 'displayGamut');
    }
    if (spec.channels == null || typeof spec.channels !== 'object')
        fail('channels must be an object', 'channels');
    for (const name of CHANNELS) {
        validateStack(spec.channels[name], `channels.${name}`, spec.count);
    }
}
function validateStack(stack, path, count) {
    if (stack == null || typeof stack !== 'object')
        fail(`${path} must be a ChannelStack`, path);
    if (stack.channel !== 'L' && stack.channel !== 'C' && stack.channel !== 'H') {
        fail(`${path}.channel must be 'L' | 'C' | 'H'`, `${path}.channel`);
    }
    validateBase(stack.base, `${path}.base`);
    validateStackWarp(stack.bezier, `${path}.bezier`);
    if (stack.overrides == null || typeof stack.overrides !== 'object') {
        fail(`${path}.overrides must be an object`, `${path}.overrides`);
    }
    for (const [k, m] of Object.entries(stack.overrides)) {
        const idx = Number(k);
        if (!Number.isInteger(idx) || idx < 0 || idx >= count) {
            fail(`override key '${k}' must be an integer in [0, count)`, `${path}.overrides.${k}`);
        }
        // Canonical form required: a key like '05', ' 5', or '1e1' would pass the
        // Number() check above yet NEVER match sampleChannel's overrides[stopIndex]
        // lookup — an accepted input that silently does nothing (M0 verifier
        // finding). Reject, don't rename: renaming is an unsanctioned coercion.
        if (String(idx) !== k) {
            fail(`override key '${k}' must be in canonical integer form ('${idx}')`, `${path}.overrides.${k}`);
        }
        if (typeof m !== 'number' || !Number.isFinite(m)) {
            fail(`override value at '${k}' must be a finite number`, `${path}.overrides.${k}`);
        }
    }
    if (stack.op !== 'mul' && stack.op !== 'add')
        fail(`${path}.op must be 'mul' | 'add'`, `${path}.op`);
    const b = stack.bounds;
    if (b == null || typeof b !== 'object')
        fail(`${path}.bounds must be an object`, `${path}.bounds`);
    if (typeof b.min !== 'number' || !Number.isFinite(b.min)) {
        fail(`${path}.bounds.min must be a finite number`, `${path}.bounds.min`);
    }
    if (b.max !== 'gamut') {
        if (typeof b.max !== 'number' || !Number.isFinite(b.max)) {
            fail(`${path}.bounds.max must be a finite number or 'gamut'`, `${path}.bounds.max`);
        }
        if (!(b.min < b.max))
            fail(`${path}.bounds.min must be < bounds.max`, `${path}.bounds`);
    }
}
function validateBase(base, path) {
    if (base == null || typeof base !== 'object')
        fail(`${path} must be a BaseFamily`, path);
    switch (base.kind) {
        case 'linear':
        case 'smoothstep':
        case 'gamut-max':
            return;
        case 'gamma':
            if (typeof base.gamma !== 'number' || !Number.isFinite(base.gamma) || base.gamma <= 0) {
                fail('gamma must be a finite number > 0', `${path}.gamma`);
            }
            return;
        case 'sine':
            for (const k of ['a', 'b', 'c', 'd']) {
                if (typeof base[k] !== 'number' || !Number.isFinite(base[k])) {
                    fail(`sine param '${k}' must be a finite number`, `${path}.${k}`);
                }
            }
            return;
        case 'published':
            if (base.system !== 'tailwind-v4' && base.system !== 'radix-3') {
                fail("published system must be 'tailwind-v4' | 'radix-3'", `${path}.system`);
            }
            if (base.channel !== 'L' && base.channel !== 'C' && base.channel !== 'H') {
                fail("published channel must be 'L' | 'C' | 'H'", `${path}.channel`);
            }
            return;
        case 'cusp-anchored':
            if (typeof base.falloff !== 'number' ||
                !Number.isFinite(base.falloff) ||
                base.falloff < 0.5 ||
                base.falloff > 3) {
                fail('falloff must be a finite number in [0.5, 3]', `${path}.falloff`);
            }
            return;
        case 'lookup': {
            // D-15: ≥ 2 finite entries, ABSOLUTE channel units (no range rule — the
            // per-stop rails clamp applies at sampling, as everywhere).
            if (!Array.isArray(base.values)) {
                fail('lookup values must be an array', `${path}.values`);
            }
            if (base.values.length < 2) {
                fail('lookup values must have at least 2 entries', `${path}.values`);
            }
            for (let i = 0; i < base.values.length; i++) {
                const v = base.values[i];
                if (typeof v !== 'number' || !Number.isFinite(v)) {
                    fail(`lookup value at ${i} must be a finite number`, `${path}.values.${i}`);
                }
            }
            return;
        }
        case 'tent': {
            // D-24: peakT ∈ [0.02, 0.98]; peakC finite > 0; ctrl x ∈ [0.02, 0.98]
            // (keeps the quadratic flank solve monotone), ctrl y ∈ [0, 1]; all finite.
            if (typeof base.peakT !== 'number' || !Number.isFinite(base.peakT) || base.peakT < 0.02 || base.peakT > 0.98) {
                fail('peakT must be a finite number in [0.02, 0.98]', `${path}.peakT`);
            }
            if (typeof base.peakC !== 'number' || !Number.isFinite(base.peakC) || base.peakC <= 0) {
                fail('peakC must be a finite number > 0', `${path}.peakC`);
            }
            for (const flank of ['low', 'high']) {
                const pt = base[flank];
                if (pt == null || typeof pt !== 'object')
                    fail(`${path}.${flank} must be a point`, `${path}.${flank}`);
                if (typeof pt.x !== 'number' || !Number.isFinite(pt.x) || pt.x < 0.02 || pt.x > 0.98) {
                    fail(`${flank}.x must be a finite number in [0.02, 0.98]`, `${path}.${flank}.x`);
                }
                if (typeof pt.y !== 'number' || !Number.isFinite(pt.y) || pt.y < 0 || pt.y > 1) {
                    fail(`${flank}.y must be a finite number in [0, 1]`, `${path}.${flank}.y`);
                }
            }
            return;
        }
        default:
            fail('unknown base kind', `${path}.kind`);
    }
}
function validateStackWarp(w, path) {
    if (w == null || typeof w !== 'object')
        fail(`${path} must be a BezierWarp`, path);
    for (const p of ['p1', 'p2']) {
        const pt = w[p];
        if (pt == null || typeof pt !== 'object')
            fail(`${path}.${p} must be a point`, `${path}.${p}`);
        for (const axis of ['x', 'y']) {
            if (typeof pt[axis] !== 'number' || !Number.isFinite(pt[axis])) {
                fail(`${path}.${p}.${axis} must be a finite number`, `${path}.${p}.${axis}`);
            }
        }
    }
    try {
        validateWarp(w); // monotone x: 0 < p1.x <= p2.x < 1
    }
    catch (e) {
        if (e instanceof CurveRampError)
            fail(e.message, path);
        throw e;
    }
}
// ── parseSpec — structural validation of UNKNOWN input (URL hash, fixtures) ──
function expectRecord(v, field) {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
        fail(`${field} must be an object`, field);
    }
    return v;
}
function expectNumber(v, field) {
    if (typeof v === 'number' && Number.isFinite(v))
        return v;
    return fail(`${field} must be a finite number`, field);
}
function expectEnum(v, allowed, field) {
    for (const a of allowed)
        if (v === a)
            return a;
    return fail(`${field} must be one of: ${allowed.join(', ')}`, field);
}
function parseBase(v, path) {
    const o = expectRecord(v, path);
    switch (o.kind) {
        case 'linear':
            return { kind: 'linear' };
        case 'smoothstep':
            return { kind: 'smoothstep' };
        case 'gamut-max':
            return { kind: 'gamut-max' };
        case 'gamma':
            return { kind: 'gamma', gamma: expectNumber(o.gamma, `${path}.gamma`) };
        case 'sine':
            return {
                kind: 'sine',
                a: expectNumber(o.a, `${path}.a`),
                b: expectNumber(o.b, `${path}.b`),
                c: expectNumber(o.c, `${path}.c`),
                d: expectNumber(o.d, `${path}.d`),
            };
        case 'published':
            return {
                kind: 'published',
                system: expectEnum(o.system, ['tailwind-v4', 'radix-3'], `${path}.system`),
                channel: expectEnum(o.channel, CHANNELS, `${path}.channel`),
            };
        case 'cusp-anchored':
            return { kind: 'cusp-anchored', falloff: expectNumber(o.falloff, `${path}.falloff`) };
        case 'lookup': {
            // D-15 — structural parse; the length ≥ 2 rule runs in validateSpec.
            if (!Array.isArray(o.values))
                fail(`${path}.values must be an array`, `${path}.values`);
            const values = o.values.map((v, i) => expectNumber(v, `${path}.values.${i}`));
            return { kind: 'lookup', values };
        }
        case 'tent': // D-24 — range rules (peakT/x/y windows, peakC > 0) run in validateSpec
            return {
                kind: 'tent',
                peakT: expectNumber(o.peakT, `${path}.peakT`),
                peakC: expectNumber(o.peakC, `${path}.peakC`),
                low: parsePoint(o.low, `${path}.low`),
                high: parsePoint(o.high, `${path}.high`),
            };
        default:
            return fail('unknown base kind', `${path}.kind`);
    }
}
function parsePoint(v, path) {
    const o = expectRecord(v, path);
    return { x: expectNumber(o.x, `${path}.x`), y: expectNumber(o.y, `${path}.y`) };
}
function parseWarp(v, path) {
    const o = expectRecord(v, path);
    return { p1: parsePoint(o.p1, `${path}.p1`), p2: parsePoint(o.p2, `${path}.p2`) };
}
function parseOverrides(v, path) {
    const o = expectRecord(v, path);
    const out = {};
    for (const [k, val] of Object.entries(o)) {
        const idx = Number(k);
        if (!Number.isInteger(idx))
            fail(`override key '${k}' must be an integer`, `${path}.${k}`);
        // Reject non-canonical keys ('05', ' 5', '1e1') rather than silently
        // renaming them — hue-wrap is the ONLY sanctioned coercion (SPEC §11).
        if (String(idx) !== k) {
            fail(`override key '${k}' must be in canonical integer form ('${idx}')`, `${path}.${k}`);
        }
        out[idx] = expectNumber(val, `${path}.${k}`);
    }
    return out;
}
function parseStack(v, path) {
    const o = expectRecord(v, path);
    const bo = expectRecord(o.bounds, `${path}.bounds`);
    const max = bo.max === 'gamut' ? 'gamut' : expectNumber(bo.max, `${path}.bounds.max`);
    return {
        channel: expectEnum(o.channel, CHANNELS, `${path}.channel`),
        base: parseBase(o.base, `${path}.base`),
        bezier: parseWarp(o.bezier, `${path}.bezier`),
        overrides: parseOverrides(o.overrides, `${path}.overrides`),
        op: expectEnum(o.op, ['mul', 'add'], `${path}.op`),
        bounds: { min: expectNumber(bo.min, `${path}.bounds.min`), max },
    };
}
/** Parse UNKNOWN input (URL hash, fixture JSON) into a validated PaletteSpec.
 *  Structural typeof checks throughout — no casts that lie. Normalizes hue by
 *  wrapping mod 360 (the one sanctioned coercion — SPEC §10/§11), then runs the
 *  full validateSpec. Throws CurveRampError('invalid-field') on any shape or
 *  rule violation (SPEC §11 "MUST reject with typed error"). */
export function parseSpec(json) {
    const o = expectRecord(json, 'spec');
    if (o.version !== '0.1.0')
        fail("version must be '0.1.0'", 'version');
    const ch = expectRecord(o.channels, 'channels');
    const spec = {
        version: '0.1.0',
        hue: wrapHue(expectNumber(o.hue, 'hue')),
        count: expectNumber(o.count, 'count'),
        channels: {
            L: parseStack(ch.L, 'channels.L'),
            C: parseStack(ch.C, 'channels.C'),
            H: parseStack(ch.H, 'channels.H'),
        },
        displayGamut: expectEnum(o.displayGamut, ['srgb', 'p3'], 'displayGamut'),
    };
    // Optional explicit stops (D-32) — parsed only if present; validateSpec enforces
    // the strictly-ascending / length===count / range rules.
    const rawStops = o.stops;
    if (rawStops !== undefined) {
        if (!Array.isArray(rawStops))
            fail('stops must be an array of numbers', 'stops');
        spec.stops = rawStops.map((v, i) => expectNumber(v, `stops.${i}`));
    }
    validateSpec(spec);
    return spec;
}
const wrapHue = (h) => ((h % 360) + 360) % 360;
// ── Generate ─────────────────────────────────────────────────────────────────
/** Generate the palette. Pipeline per stop i (t = i/(N-1)):
 *  Lr = sample(L) → Loklab = toeInv(Lr) → H = sample(H) → cap = peakC(L,H)
 *  → C = sample(C | cap) → fit(displayGamut). O(N · gamutIters).
 *  The gamut cap is resolved once per stop FOR SAMPLING and threaded through
 *  SampleCtx (PLAN §3.4 budget — M0.7 cap threading); fit() re-evaluates the
 *  cusp for its clamp, so a stop costs two peakC evaluations total (~535 ns
 *  each on the analytic sRGB path — M0 verifier benchmark). */
/** Per-stop sampling position + display key (SPEC §4, D-32). With explicit
 *  `stops`, the curve is sampled at NORMALIZED positions — min→0, max→1, the rest
 *  proportional — so the named scale spans the curve's full dynamic range, and
 *  the key is pad3(stops[i]). Without `stops`, the uniform t = i/(N−1) with
 *  keyForIndex labels. Pure; assumes a validated spec (stops strictly ascending). */
function stopPositions(spec) {
    const n = spec.count;
    const stops = spec.stops;
    if (stops) {
        const min = stops[0];
        const span = stops[n - 1] - min;
        return stops.map((s) => ({ t: span === 0 ? 0 : (s - min) / span, key: keyForStop(s) }));
    }
    return Array.from({ length: n }, (_, i) => ({ t: i / (n - 1), key: keyForIndex(i, n) }));
}
export function generate(spec) {
    validateSpec(spec);
    const { count: n, hue, displayGamut: gamut, channels } = spec;
    const positions = stopPositions(spec);
    const swatches = [];
    for (let i = 0; i < n; i++) {
        const { t, key } = positions[i];
        const Lr = sampleChannel(channels.L, { t, hue, stopIndex: i, gamut });
        const L = toeInv(Lr);
        const H = wrapHue(sampleChannel(channels.H, { t, hue, stopIndex: i, gamut }));
        const cap = peakC(L, H, gamut);
        const C = sampleChannel(channels.C, { t, hue: H, L, cap, stopIndex: i, gamut });
        const f = fit({ L, C, H }, gamut);
        swatches.push({
            index: i,
            key,
            oklch: f.oklch,
            hex: f.hex,
            inGamut: f.inGamut,
            clampedChromaDelta: f.clampedChromaDelta,
        });
    }
    return { spec, swatches };
}
// ── Count reconciliation ─────────────────────────────────────────────────────
/** Re-sample to a new count, carrying overrides by FRACTION-NEAREST (SPEC §6):
 *  each old override re-anchors to round(ot·(N′−1)). Placement is GLOBAL
 *  BEST-FIT, not key-order-greedy: overrides are placed in ascending order of
 *  |pos − round(pos)| (exact fits first; ties → lower OLD index, deterministic),
 *  so an exact-fit override always keeps its ideal slot. The M7 review council
 *  proved the old ascending-key greedy violated SPEC §6's motivation ("a tweak
 *  'at the middle' stays in the middle"): with overrides at t=0.4/0.5/0.6
 *  (count 11 → 3), t=0.4 claimed index 1 first and evicted the exact-middle
 *  t=0.5 override to index 0. A collision relocates to the nearest FREE index —
 *  probed by increasing |Δt| from the ideal fractional position ot·(N′−1), ties
 *  broken to the LOWER index (deterministic). An override drops ONLY when no
 *  free index remains (more overrides than stops), and every drop is reported
 *  (never silently lost — SPEC §6, AC A8). Channels reconcile independently.
 *  Relocations are likewise surfaced (D-21 #1b, v0.3): `relocated` carries one
 *  entry per override whose FINAL index differs from its ideal slot round(pos)
 *  — { key: old-spec key, to: new-spec key } — purely additive alongside
 *  `dropped` (identical key→to pairs across channels dedupe, like dropped's
 *  key set; dropped and relocated are disjoint by construction).
 *  The INPUT spec is not re-validated here — generate() enforces the full §11
 *  rules on whatever is generated next. */
export function reconcileCount(spec, nextCount) {
    if (!Number.isInteger(nextCount) || nextCount < 2 || nextCount > 91) {
        fail('count must be an integer in [2, 91]', 'count'); // D-11 bound, same as validateSpec
    }
    const oldN = spec.count;
    const dropped = new Set();
    const relocated = new Map();
    const remap = (stack) => {
        const next = {};
        const entries = Object.entries(stack.overrides).map(([k, m]) => {
            const oldIdx = Number(k);
            const pos = (oldIdx / (oldN - 1)) * (nextCount - 1); // ideal fractional position
            const ideal = Math.round(pos);
            return { oldIdx, m, pos, ideal, miss: Math.abs(pos - ideal) };
        });
        // Global best-fit order: smaller |pos − ideal| first, then lower OLD index.
        // Old indices are unique, so the order is total — deterministic.
        entries.sort((a, b) => a.miss - b.miss || a.oldIdx - b.oldIdx);
        for (const e of entries) {
            if (next[e.ideal] == null) {
                next[e.ideal] = e.m;
                continue;
            }
            // Collision: nearest free index by |Δt| from `pos` (∝ |i − pos|); tie → lower index.
            const free = Array.from({ length: nextCount }, (_, i) => i)
                .filter((i) => next[i] == null)
                .sort((a, b) => Math.abs(a - e.pos) - Math.abs(b - e.pos) || a - b);
            if (free.length > 0) {
                const finalIdx = free[0];
                next[finalIdx] = e.m;
                // finalIdx ≠ e.ideal always here (the ideal slot is occupied) — report
                // where the tweak LANDED, not just that it moved (D-21 #1b).
                const key = keyForIndex(e.oldIdx, oldN);
                const to = keyForIndex(finalIdx, nextCount);
                relocated.set(`${key}->${to}`, { key, to });
            }
            else
                dropped.add(keyForIndex(e.oldIdx, oldN)); // unplaceable — reported, never silent
        }
        return { ...stack, overrides: next };
    };
    // A count change abandons any explicit `stops` (the custom positional scale no
    // longer matches the new count) — reverting to uniform keeps the output a valid
    // spec (D-32; a stops-aware re-scale is future work, R-15-adjacent).
    const { stops: _droppedStops, ...rest } = spec;
    const nextSpec = {
        ...rest,
        count: nextCount,
        channels: { L: remap(spec.channels.L), C: remap(spec.channels.C), H: remap(spec.channels.H) },
    };
    return { spec: nextSpec, dropped: [...dropped], relocated: [...relocated.values()] };
}
export const SCALE_IDS = [11, 25, 37];
// The owner's SEMANTIC-COMPLETE default (v0.13): every-25 surface ends MINUS the
// unused 225/775, the 350/450/550/650 accent mid-tones, and the 250/500/750 scrim
// anchors — so every semantic role (surfaces, accents, scrims) resolves to an EXACT key.
const SEMANTIC_25 = [
    50, 75, 100, 125, 150, 175, 200, 250,
    300, 350, 400, 450, 500, 550, 600, 650, 700,
    750, 800, 825, 850, 875, 900, 925, 950,
];
export const SCALE_PRESETS = {
    11: { count: 11 }, // coarse Tailwind (050,100,200,…,950) — no surface stepping
    25: { count: 25, stops: SEMANTIC_25 }, // semantic-complete (studio default) — every role lands exact
    37: { count: 37, stops: Array.from({ length: 37 }, (_, i) => 50 + 25 * i) }, // every 25, 050–950
};
/** Switch a spec to a fixed scale (D-32): reconciles overrides to the scale's
 *  count (fraction-nearest, exactly like the count control — §6/D-5) and applies
 *  its stops (or clears them for the uniform 11). Returns the reconcile report
 *  so callers can surface dropped/relocated overrides. Pure; result is a valid
 *  spec (generate re-validates). */
export function withScale(spec, scale) {
    const preset = SCALE_PRESETS[scale];
    const r = reconcileCount(spec, preset.count); // reconciles indices + strips any old stops
    const next = preset.stops ? { ...r.spec, stops: [...preset.stops] } : r.spec;
    return { spec: next, dropped: r.dropped, relocated: r.relocated };
}
/** SPEC §6 "Flatten all → published" — implemented as flatten-to-LOOKUP, the
 *  §6 row's own parenthetical (base ← "current output as a lookup"). D-15
 *  closed, v0.3. Returns a new spec where channel `ch`'s base is a `lookup`
 *  of the COUNT per-stop SAMPLED values — the same pipeline ctx generate()
 *  uses (L in Lr; H UNWRAPPED — generate wraps mod 360 at the boundary, and a
 *  wrapped value could escape the H drift rails; C with the per-stop cap
 *  resolved from the already-resolved L/H) — bezier ← identity, overrides ←
 *  {}: the "snapshot for hand-off". Because values.length === count, the
 *  lookup nodes coincide with the stop positions (x = t_i·(count−1) = i
 *  exactly), so generate() output is preserved at every stop (tests assert
 *  ≤ 1e-9 — the identity easing's ulp-level round-trip is the only residue).
 *  Other channels are untouched. Validates the input spec. Pure. */
export function flattenChannel(spec, ch) {
    validateSpec(spec);
    const { count: n, hue, displayGamut: gamut, channels } = spec;
    const values = [];
    for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const Lr = sampleChannel(channels.L, { t, hue, stopIndex: i, gamut });
        if (ch === 'L') {
            values.push(Lr); // L curve math runs in Lr (§7) — the lookup stays in Lr
            continue;
        }
        const rawH = sampleChannel(channels.H, { t, hue, stopIndex: i, gamut });
        if (ch === 'H') {
            values.push(rawH); // unwrapped — see doc comment
            continue;
        }
        const L = toeInv(Lr);
        const H = wrapHue(rawH);
        const cap = peakC(L, H, gamut);
        values.push(sampleChannel(channels.C, { t, hue: H, L, cap, stopIndex: i, gamut }));
    }
    const flattened = {
        ...channels[ch],
        base: { kind: 'lookup', values },
        bezier: IDENTITY_WARP,
        overrides: {},
    };
    return {
        ...spec,
        channels: {
            L: ch === 'L' ? flattened : channels.L,
            C: ch === 'C' ? flattened : channels.C,
            H: ch === 'H' ? flattened : channels.H,
        },
    };
}
/** Build the default spec for a hue + count (SPEC §8 defaults). */
export function defaultSpec(hue, count = 11) {
    return {
        version: '0.1.0',
        hue: wrapHue(hue),
        count,
        displayGamut: 'srgb',
        channels: {
            // L: monotone smoothstep in Lr, additive overrides, accessibility rails.
            L: {
                channel: 'L',
                base: { kind: 'smoothstep' },
                bezier: IDENTITY_WARP,
                overrides: {},
                op: 'add',
                bounds: { min: 0.03, max: 0.97 },
            },
            // C: sinusoidal mid-ramp bell (0 at ends, peak mid), multiplicative,
            // clamped to the live gamut cusp. sine c=0.5,d=-0.25 ⇒ cos peaks at t=0.5.
            C: {
                channel: 'C',
                base: { kind: 'sine', a: 0.01, b: 0.13, c: 0.5, d: -0.25 },
                bezier: IDENTITY_WARP,
                overrides: {},
                op: 'mul',
                bounds: { min: 0.01, max: 'gamut' },
            },
            // H: constant seed hue (flat), additive drift room ±30° for hue-shift edits.
            H: {
                channel: 'H',
                base: { kind: 'sine', a: wrapHue(hue), b: 0, c: 0, d: 0 },
                bezier: IDENTITY_WARP,
                overrides: {},
                op: 'add',
                bounds: { min: wrapHue(hue) - 30, max: wrapHue(hue) + 30 },
            },
        },
    };
}
