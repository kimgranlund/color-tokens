import type { PaletteSpec, Palette, Channel } from './types.js';
/** Validate a PaletteSpec against EVERY SPEC §11 rule. Throws
 *  CurveRampError('invalid-field', msg, field) with a precise field path
 *  (e.g. 'channels.C.base.gamma') on the first violation. The only sanctioned
 *  coercion is hue-wrap (mod 360), which happens in parseSpec — here hue must
 *  simply be finite. */
export declare function validateSpec(spec: PaletteSpec): void;
/** Parse UNKNOWN input (URL hash, fixture JSON) into a validated PaletteSpec.
 *  Structural typeof checks throughout — no casts that lie. Normalizes hue by
 *  wrapping mod 360 (the one sanctioned coercion — SPEC §10/§11), then runs the
 *  full validateSpec. Throws CurveRampError('invalid-field') on any shape or
 *  rule violation (SPEC §11 "MUST reject with typed error"). */
export declare function parseSpec(json: unknown): PaletteSpec;
export declare function generate(spec: PaletteSpec): Palette;
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
export declare function reconcileCount(spec: PaletteSpec, nextCount: number): {
    spec: PaletteSpec;
    dropped: string[];
    relocated: {
        key: string;
        to: string;
    }[];
};
/** The fixed token scales (owner field report, D-32; refined D-36). 11 is a plain
 *  uniform count — keyForIndex labels it '050,100,200,…,950' (no stops); 25 and 37
 *  are non-uniform and carry explicit positional `stops`. Fixed presets — not an
 *  open count — keep scale-switching a choice among known grids (no arbitrary
 *  count→stops reconcile ambiguity). */
export type ScaleId = 11 | 25 | 37;
export declare const SCALE_IDS: readonly ScaleId[];
export declare const SCALE_PRESETS: Record<ScaleId, {
    count: number;
    stops?: number[];
}>;
/** Switch a spec to a fixed scale (D-32): reconciles overrides to the scale's
 *  count (fraction-nearest, exactly like the count control — §6/D-5) and applies
 *  its stops (or clears them for the uniform 11). Returns the reconcile report
 *  so callers can surface dropped/relocated overrides. Pure; result is a valid
 *  spec (generate re-validates). */
export declare function withScale(spec: PaletteSpec, scale: ScaleId): {
    spec: PaletteSpec;
    dropped: string[];
    relocated: {
        key: string;
        to: string;
    }[];
};
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
export declare function flattenChannel(spec: PaletteSpec, ch: Channel): PaletteSpec;
/** Build the default spec for a hue + count (SPEC §8 defaults). */
export declare function defaultSpec(hue: number, count?: number): PaletteSpec;
