/**
 * <cr-curve-canvas> — the curve canvas: RENDERING core (PLAN M4.1/M4.2/M4.8;
 * SPEC §8.1 overlay/single modes + per-channel y-normalization, §10 canvas
 * states) + the INTERACTION layer (PLAN M4.3–M4.6; SPEC §6 edit resolution,
 * §10 hover/drag/clamp/reset states; D-7a click-to-activate).
 *
 * Rendering contracts (the interaction layer codes against these):
 *
 * - `this.layout` (plain field, NOT reactive — updated each paint): the
 *   CanvasLayout (see curve-math.js typedef) — {width, height, activeChannel,
 *   dots, handles, curvePolylines} in CSS-px canvas space. Hit-test it with
 *   `hitTest(pt, el.layout)`.
 * - `[data-chip-anchor]` — an absolutely-positioned overlay div the M4.4
 *   readout chip (<cr-readout-chip>) positions inside via canvas pixel
 *   coordinates (D-20b).
 * - `static _ctxFactory` — pluggable 2D-context factory: happy-dom's
 *   getContext('2d') returns null, so render tests inject a recording context
 *   (`CrCurveCanvas._ctxFactory = () => recordingCtx`) before mounting.
 *
 * Paint model (D-9): ONE `this.effectRaf` repaints the whole frame; it reads
 * store.spec / store.view / store.palette + the ResizeObserver-fed size
 * signal, so any batch of store writes coalesces to one paint per frame (B5).
 * A separate microtask `this.effect` owns DPR-aware bitmap sizing
 * (canvas.width = cssW·dpr).
 *
 * Interaction model (PLAN §3.4, M4.3–M4.5):
 * - pointerdown hit-tests `this.layout` (CSS px, canvas offset removed).
 *   Active-channel DOT → point drag (`store.dragPoint` back-solves the
 *   override, SPEC §6); HANDLE → handle drag (`store.dragHandle`, x
 *   PRE-CLAMPED monotone in pointer math so the UI can never produce an
 *   invalid warp — engine validateWarp stays the backstop); an INACTIVE
 *   channel's curve → `store.setActiveChannel` (D-7a; SPEC §10 *switch*);
 *   the active curve / empty space → nothing. Pointer capture for the drag.
 * - Grab-offset compensation (D-23, owner field report 2026-06-10 "the
 *   position jumps"): pointerdown records `grabDx/grabDy` = pointer −
 *   target's painted position (dot/handle center); EVERY pointermove
 *   subtracts them before value math, so pressing anywhere inside the hit
 *   radius never snaps the target to the pointer. Applies to all drag kinds
 *   (point / handle / hue); keyboard nudges are untouched. NOTHING commits
 *   on pointerdown — the first pointermove is the first store write.
 * - Each drag snapshots the channel stack first; Esc mid-drag restores it via
 *   `store.replaceChannel` (SPEC §10 cancel). `:state(dragging)` while live.
 * - Hover (and the strip's bubbling 'cr-swatch-hover' / 'cr-swatch-leave',
 *   D-21 #13) drives the readout chip; a drag keeps the chip on the dragged
 *   dot. The canvas cursor telegraphs
 *   the hit affordance (grab over dots/handles, pointer over an inactive
 *   curve — council MAJOR #3); :state(dragging) owns the grabbing cursor.
 * - Keyboard (M4.5 + R-14): the canvas is focusable (role=application); ←/→
 *   select along the channel's cycle (wrap, painted ring, `:state(keyboard)`).
 *   The cycle ORDER is pinned per channel (R-14 added the warp handles —
 *   closing the I-7-adjacent gap where they were pointer-only):
 *     L / non-tent C:  N dots → warp p1 → warp p2
 *     C tent:          N dots → tent peak → rise (low) → fall (high) → warp p1 → warp p2
 *     H:               dark end → center → light end → warp p1 → warp p2
 *   (the warp handles drop out of the cycle in the N=2 empty state, mirroring
 *   the painter — the warp cannot affect a two-stop ramp). ↑/↓ nudges the
 *   selected target's y: dots by 1% of the channel display range (Shift ×10)
 *   through the same dragPoint path; warp handles by ±0.05 easing-y
 *   (Shift ×10), clamped to the [−0.2, 1.2] overshoot window. Alt+←/→ (R-14)
 *   nudges x where an x degree of freedom exists: tent peak peakT ±0.01 /
 *   flanks ±0.02 segment-local x (Shift ×10, clamped [0.02, 0.98]); warp
 *   handles ±0.02 warp-x (Shift ×10) under the same monotone pre-clamp as
 *   #dragHandleTo (0 < p1.x ≤ p2.x < 1, 0.01 end margins — p1 cannot cross
 *   p2). Alt+←/→ is INERT on stop dots (fixed t = i/(N−1)) and on the three
 *   H handles (ends pinned at t=0/1, center at 0.5) — no x freedom; the
 *   keydown still preventDefaults so Alt+arrows never trigger browser history
 *   navigation mid-edit. Esc restores the pre-nudge snapshot (warp edits run
 *   store.dragHandle → setBezier, which touches ONLY channels[ch].bezier —
 *   the single-channel snapshot covers them; nothing couples). Commit is
 *   implicit on blur/selection change. An aria-live=polite region mirrors the
 *   readout — announced on drag END, keyboard nudge (Alt x-nudges included),
 *   and ←/→ selection CHANGE (C4-#2: 'Selected …' via the same per-role
 *   formatters — the ring/chip are visual-only), never per pointermove frame.
 * - Resets (M4.6, SPEC §6 scoped): point / channel / all buttons under the
 *   canvas — overrides → identity, base + bézier untouched, no confirmation.
 *
 * H-channel parameter handles (D-22): when the active channel is H the canvas
 * does NOT render the N per-stop dots. It renders exactly THREE control
 * handles — dark end (t=0) and light end (t=1) ride the live base⊗bézier
 * curve's endpoints (the D-23 warp band pins them at hue+Δdark / hue+Δlight
 * exactly, under ANY warp); the CENTER (drawn slightly larger: it moves
 * everything) anchors at its SEMANTIC value — hue + (Δdark+Δlight)/2, the
 * translation anchor — NOT the warped t=0.5 curve sample (D-23). It therefore
 * holds still while a Bézier handle flexes the transition, and under a strong
 * warp it may visually DETACH from the curve — intended: it is the
 * move-everything anchor, not a curve sample.
 * They are published as `layout.dots` ({i: 0|1|2} = handle ROLE, not a stop
 * index) so the existing hitTest/grab machinery works unchanged. End drags
 * back-solve the drift through `store.setHueDrift`; the CENTER drag
 * TRANSLATES `spec.hue` (store preserves the offsets) — the Y_RANGES(hue)
 * viewport recenters per frame, so the curve visually stays put while the
 * axis slides. Esc restores BOTH: setHue(snapshot hue) FIRST, then
 * replaceChannel('H', snapshot stack) — setHue translates the H base by the
 * hue delta, so the reverse order would corrupt the restored base. Keyboard
 * ←/→ cycles the 3 handles, then the two warp handles (R-14); ↑/↓ nudges
 * drift (ends) or hue (center) by 0.5° (Shift ×10). Alt+←/→ is INERT on the
 * 3 H handles — they have no x degree of freedom (ends pinned at t=0/1,
 * center at 0.5); R-14 lifted the keyboard-x limitation only where x freedom
 * exists. H per-stop overrides (URL-loaded specs) remain honored by the
 * engine/palette but lose their canvas affordance: no dots, no chip, and
 * 'Reset point' is disabled on H ('Reset channel' still clears them).
 *
 * C-channel tent handles (D-24): when the active channel is C AND its base is
 * the tent family (`store.tentOf(spec) != null`), the canvas renders THREE
 * parameter handles IN ADDITION to the N per-stop dots (unlike H — C keeps
 * its A3/A5 per-stop affordance). PEAK (filled r=6 + outer ring) sits at the
 * BASE's ask (peakT, peakC) — ABOVE the dashed cap line whenever the spec
 * asks more chroma than the gamut affords. LOW/HIGH (hollow r=5) are the
 * quadratic flank CONTROL points mapped segment-local → absolute (near but
 * NOT ON the curve — a quadratic Bézier interpolates its endpoints, not its
 * middle control point; correct, not a bug). All three PARK inside the
 * canvas (±HANDLE_INSET — the curve-math bezierHandlePositions precedent).
 * Published as `layout.tent` ({peak, low, high}); hit-tested by a component
 * pre-check (#preHit) that runs BEFORE the frozen curve-math hitTest, with
 * priority bézier handles (9px) > tent handles (peak 8 / flank 7) > dots >
 * curves. The PEAK drag is the LIVE-2D coupled gesture (store.dragTentPeak,
 * x AND y; x clamped [0.02, 0.98], y NOT cap-clamped): asking past the cap
 * makes the store borrow lightness via a coupled per-stop L override, which
 * invalidates the capLUT cache (keyed on the L stack ref) — the dashed cap
 * line LIFTS under the pointer on the next frame. Esc therefore snapshots
 * and restores BOTH the C and L stacks (batched). Flank drags invert the
 * display mapping into store.setTent — C-only edits. Keyboard: the three
 * handles extend the C ←/→ cycle AFTER the N dots (indices count..count+2,
 * ahead of the warp handles — R-14); ↑/↓ nudges y — peak via dragTentPeak by
 * 1% of the C display range, flanks via setTent y ±0.02, both Shift ×10.
 * Alt+←/→ nudges x (R-14 lifted the old 'x is pointer-only' D-24 recorded
 * limitation): peak peakT ±0.01 via dragTentPeak(newT, peakC) — the SAME
 * live-2D coupled gesture as the pointer, so the lightness borrow/release
 * bookkeeping stays consistent and the Esc session restores BOTH stacks —
 * flanks low.x/high.x ±0.02 via setTent (C-only); both Shift ×10, clamped
 * [0.02, 0.98]. A muted diamond marks cuspInfo().t on the cap line
 * (a landmark, not a control — no hover/chip/title; the picker's 'Peak at
 * cusp' preset is the actionable affordance). The N=2 empty state suppresses
 * tent handles alongside the bézier handles (both stops sit at bounds.min —
 * nothing the peak can move). Chip roles: 'C · peak' (+ ', lightness
 * borrowed' while the coupling bookkeeping is live), 'C · rise shape',
 * 'C · fall shape'. Tent handles are NOT per-stop reset targets ('Reset
 * point' ignores indices ≥ count).
 *
 * peakC budget (PLAN §3.4, M4.1): the C cap line renders from a capLUT cached
 * per (hue, displayGamut, L-stack, H-stack) — reference equality is sound
 * because specs are immutable (copies on every action). Steady-state repaints
 * (e.g. a point drag) rebuild ZERO LUTs: curves resample against the cached
 * LUT (zero peakC) and only C dots cost N peakC calls. The readout adds at
 * most ONE peakC per hover/spec change (single-stop resolve, microtask tier).
 *
 * States (SPEC §10): `:state(empty)` at N=2 (endpoints only, no handles, the
 * "nothing to tune yet" hint); warning (--color-warning, orange-red) dot fill
 * PLUS a warning ring (r+2.5, lw 1.5 — owner QA 2026-06-10: the flag must
 * survive palette proximity to the C stroke) when a C dot sits at the gamut
 * cap; `:state(dragging)` / `:state(keyboard)` per M4.5.
 *
 * Colors resolve from semantic tokens via getComputedStyle ONCE per paint
 * (--curve-l/c/h etc); the keyword fallbacks only apply where tokens are not
 * loaded (test DOMs) — canvas pixels are runtime data, not authored CSS, so
 * token gates T3/T4 are unaffected.
 */
import { UIElement, html, css, signal, batch } from '@curve-ramp/base'
import { baseBezier, peakC, resetOverride, sampleChannel, toeInv, warpBand } from '@curve-ramp/curve-engine'
import * as store from '../store.js'
import {
  nominalBand,
  HANDLE_INSET,
  HIT_RADIUS,
  PAD,
  V_PAD,
  Y_RANGES,
  capLUT,
  sampleCurve,
  dotPositions,
  bezierHandlePositions,
  hitTest,
  tToX,
  xToT,
  valueToY,
  yToValue,
} from '../curve-math.js'
import {
  CrReadoutChip,
  formatHueReadout,
  formatReadout,
  formatTentReadout,
  formatWarpReadout,
} from './cr-readout-chip.js'

/** @typedef {import('@curve-ramp/curve-engine').Channel} Channel */
/** @typedef {import('@curve-ramp/curve-engine').PaletteSpec} PaletteSpec */
/** @typedef {import('@curve-ramp/curve-engine').Palette} Palette */
/** @typedef {import('@curve-ramp/curve-engine').ChannelStack} ChannelStack */
/** @typedef {import('../curve-math.js').CanvasLayout} CanvasLayout */
/** @typedef {import('../curve-math.js').Dot} Dot */
/** @typedef {import('../curve-math.js').Pt} Pt */
/** @typedef {import('./cr-readout-chip.js').ChipData} ChipData */
/** @typedef {import('./cr-readout-chip.js').HueRole} HueRole */
/** @typedef {import('./cr-readout-chip.js').TentRole} TentRole */
/** @typedef {import('./cr-readout-chip.js').WarpRole} WarpRole */

/** D-24: the tent base's editable params, as the store's `tentOf` derives them
 *  (structural — works with or without the BaseFamily `kind` tag).
 *  @typedef {{ peakT: number, peakC: number,
 *              low: { x: number, y: number },
 *              high: { x: number, y: number } }} TentParams */
/** D-24: the three tent handles' painted canvas positions, published per
 *  frame as `layout.tent` (null when the C base is not the tent family, when
 *  another channel is active, or in the N=2 empty state).
 *  @typedef {{ peak: Pt, low: Pt, high: Pt }} TentLayout */
/** D-24: what #preHit can resolve ahead of the frozen hitTest.
 *  @typedef {{ kind: 'handle', channel: Channel, index: number }
 *          | { kind: 'tent', channel: 'C', index: number }} PreHit */

/**
 * An in-flight pointer drag. `snapshot` is the channel stack as it was on
 * pointerdown — Esc restores it wholesale via store.replaceChannel (M4.3).
 * `index` is the stop index for 'point' drags, 0 (p1) | 1 (p2) for 'handle',
 * and the HANDLE ROLE (0 dark | 1 center | 2 light) for 'hue' drags (D-22).
 * Hue drags also snapshot the seed hue (`startHue` — the center drag
 * translates it; Esc restores it) and the GRAB-COMPENSATED pointer value at
 * pointerdown (`startValue`, measured in the startHue frame — the center
 * translate's reference, see #dragHueTo).
 * `grabDx`/`grabDy` (D-23): pointer − target display position at pointerdown;
 * every pointermove subtracts them before value math (grab-offset
 * compensation — see the header). `grabDx` is only ever non-zero for
 * 'handle' and 'tent' drags (dots/hue handles sit on a fixed t, so x never
 * matters there).
 * 'tent' drags (D-24): `index` is the tent handle ROLE (0 peak | 1 low/rise |
 * 2 high/fall); `snapshot` is the C stack and `snapshotL` the L stack — the
 * PEAK is the live-2D coupled gesture (dragTentPeak may write an L override),
 * so Esc restores BOTH; flanks are C-only (`snapshotL` null).
 * @typedef {{ kind: 'point' | 'handle', channel: Channel, index: number,
 *             pointerId: number, snapshot: ChannelStack,
 *             grabDx: number, grabDy: number }} PointDrag
 * @typedef {{ kind: 'hue', channel: 'H', index: number, pointerId: number,
 *             snapshot: ChannelStack, startHue: number, startValue: number,
 *             grabDx: number, grabDy: number }} HueDrag
 * @typedef {{ kind: 'tent', channel: 'C', index: number, pointerId: number,
 *             snapshot: ChannelStack, snapshotL: ChannelStack | null,
 *             grabDx: number, grabDy: number }} TentDrag
 * @typedef {PointDrag | HueDrag | TentDrag} DragState
 */

/** Samples per curve/LUT (PLAN M4.1 budget basis). */
const SAMPLES = 256
/** Layout polylines keep every 4th sample (+ the last) — plenty for 5px hit-testing. */
const DOWNSAMPLE = 4
/** Paint size when the host DOM reports no layout (happy-dom) — deterministic tests. */
const FALLBACK_W = 640
const FALLBACK_H = 320
/** Dimmed-context alpha for inactive channels (SPEC §8.1). */
const DIM_ALPHA = 0.35
/** Handle-x margin against the 0/1 ends (M4.3 pre-clamp: 0 < p1.x ≤ p2.x < 1). */
const HANDLE_X_MARGIN = 0.01
/** Handle-y overshoot range (CSS easings legally overshoot; D-7b viewport). */
const HANDLE_Y_MIN = -0.2
const HANDLE_Y_MAX = 1.2
/** Keyboard nudge: 1% of the channel's display range per arrow (Shift ×10). */
const NUDGE_FRACTION = 0.01
/** D-22 H-mode keyboard nudge: degrees per arrow (Shift ×10 → 5°). */
const HUE_NUDGE_DEG = 0.5
/** D-22: H-mode handle roles by layout.dots index (0 dark | 1 center | 2 light). */
/** @type {HueRole[]} */
const HUE_ROLES = ['dark', 'center', 'light']
/** D-22: dot radii — the center hue handle reads larger (it moves everything). */
const DOT_RADIUS = 4.5
const HUE_CENTER_RADIUS = 6
/** D-24: tent handle paint radii — PEAK filled + ringed (a parameter handle,
 *  not one of the r=4.5 stop-dot family), flanks hollow/stroked. */
const TENT_PEAK_RADIUS = 6
const TENT_FLANK_RADIUS = 5
/** D-24: tent hit radii (component pre-check — curve-math is frozen). */
const TENT_HIT = Object.freeze({ peak: 8, flank: 7 })
/** D-24: pointer clamp for peakT / flank x (mirrors engine validation). */
const TENT_X_MIN = 0.02
const TENT_X_MAX = 0.98
/** D-24 keyboard: flank-y nudge per arrow (segment-local units, Shift ×10). */
const TENT_FLANK_NUDGE = 0.02
/** D-24: tent handle roles by (cycle index − count) / TentDrag.index. */
/** @type {TentRole[]} */
const TENT_ROLES = ['peak', 'rise', 'fall']
/** R-14 keyboard x-nudges (Alt+←/→, Shift ×10) for handles WITH an x degree
 *  of freedom: tent peak (peakT), tent flanks (segment-local x), warp handles
 *  (warp x). Stop dots and the three H handles have none — Alt+arrows are
 *  inert there (header). */
const TENT_PEAK_X_NUDGE = 0.01
const TENT_FLANK_X_NUDGE = 0.02
const WARP_X_NUDGE = 0.02
/** R-14 keyboard: warp-handle y nudge per arrow (easing-y units, Shift ×10;
 *  clamped to the HANDLE_Y_MIN/MAX overshoot window — same as the pointer). */
const WARP_Y_NUDGE = 0.05
/** R-14: warp-handle roles by (cycle index − warp base). */
/** @type {WarpRole[]} */
const WARP_ROLES = ['p1', 'p2']

/** @type {Channel[]} */
const CHANNELS = ['L', 'C', 'H']

export class CrCurveCanvas extends UIElement {
  static template = () => html`
    <div data-wrap>
      <canvas
        data-canvas
        tabindex="0"
        role="application"
        aria-label="Channel curves editor: lightness, chroma, hue. Left and right arrows select a control; up and down nudge it; Alt with left and right moves it horizontally where possible; Shift for ×10 steps. Escape cancels."
      ></canvas>
      <div data-chip-anchor>
        <cr-readout-chip hidden></cr-readout-chip>
      </div>
      <p data-empty-hint>nothing to tune yet — raise the count</p>
      <p data-live aria-live="polite"></p>
    </div>
    <div data-resets role="group" aria-label="Reset overrides">
      <button type="button" class="cr-btn" data-reset-point>Reset point</button>
      <button type="button" class="cr-btn" data-reset-channel>Reset channel</button>
      <button type="button" class="cr-btn" data-reset-all>Reset all</button>
    </div>
  `

  static styles = css`
    cr-curve-canvas {
      display: block;
    }
    cr-curve-canvas [data-wrap] {
      position: relative;
      block-size: calc(var(--space-8) * 6);
      border-radius: var(--radius-3);
      background: var(--color-surface);
    }
    cr-curve-canvas [data-canvas] {
      display: block;
      inline-size: 100%;
      block-size: 100%;
      touch-action: none; /* M4.3 pointer drags must not pan/zoom */
    }
    /* No focus-visible override here (D-21 #12): the canvas takes the GLOBAL
       2px focus-ring policy (tokens global.css) like every other focusable. */
    /* SPEC §10 dragging state (M4.5 :state()-driven styling). */
    cr-curve-canvas:state(dragging) [data-canvas] {
      cursor: grabbing;
    }
    /* D-20b: the readout chip (M4.4) absolutely positions inside this overlay
       using canvas pixel coordinates. */
    cr-curve-canvas [data-chip-anchor] {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }
    /* SPEC §10 empty state — N=2 degenerate floor. */
    cr-curve-canvas [data-empty-hint] {
      display: none;
    }
    cr-curve-canvas:state(empty) [data-empty-hint] {
      display: block;
      position: absolute;
      inset-block-start: 50%;
      inset-inline: 0;
      margin: 0;
      transform: translateY(-50%);
      text-align: center;
      color: var(--color-text-muted);
      font-size: var(--text-sm);
      pointer-events: none;
    }
    /* M4.5 aria-live readout mirror — visually hidden, still announced. */
    cr-curve-canvas [data-live] {
      position: absolute;
      inline-size: 1px;
      block-size: 1px;
      margin: 0;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    /* M4.6 reset cluster (SPEC §6 scoped resets — no confirmation). Button
       chrome (incl. :disabled) is the shared .cr-btn recipe — tokens GLOBAL
       layer, D-21 #12; only the cluster LAYOUT lives here. */
    cr-curve-canvas [data-resets] {
      display: flex;
      gap: var(--space-2);
      margin-block-start: var(--space-2);
    }
  `

  /**
   * Test hook (documented): 2D-context factory. happy-dom returns null from
   * getContext('2d'); the render suite injects a recording context here.
   * @type {(canvas: HTMLCanvasElement) => CanvasRenderingContext2D | null}
   */
  static _ctxFactory = (canvas) => canvas.getContext('2d')

  /**
   * Last painted frame's geometry — the interaction layer hit-tests against
   * this (plain field on purpose: writing it must NOT schedule work).
   * D-24 extends the frozen CanvasLayout with `tent` (the three C-tent
   * handle positions, or null) — published here, hit-tested by #preHit.
   * @type {(CanvasLayout & { tent?: TentLayout | null }) | null}
   */
  layout = null

  /** ResizeObserver-fed CSS-pixel size of the wrapper. */
  #size = signal({ w: 0, h: 0 })
  /** @type {ResizeObserver | null} */
  #ro = null
  /** @type {CanvasRenderingContext2D | null} */
  #ctx = null

  /** C1-#1: theme epoch — bumped whenever the RESOLVED token colors may have
   *  changed without any store signal moving: (a) a `data-theme` flip on
   *  <html> (the R-22 toggle), (b) an OS scheme change under 'system'
   *  (matchMedia). Canvas pixels resolve `--curve-*`/`--color-*` at PAINT
   *  time via getComputedStyle, so without this read the raster kept the
   *  previous theme's colors until the next spec/view edit (stale light grid
   *  on a dark page). The paint effect reads it; both sources write it. */
  #themeEpoch = signal(0)
  /** data-theme observer on <html> (C1-#1) — disconnected in disconnected().
   *  @type {MutationObserver | null} */
  #themeObserver = null

  /** capLUT cache, keyed by (hue, gamut, L stack ref, H stack ref) — see header.
   *  @type {{ hue: number, gamut: string, L: object, H: object, lut: Float64Array } | null} */
  #lutCache = null

  // ── interaction state (M4.3–M4.5) ──────────────────────────────────────────

  /** Hovered active-channel dot (pointer over the canvas, or the strip's
   *  'cr-swatch-hover'). Cleared on pointerleave / 'cr-swatch-leave'; a drag
   *  pins it to the dragged dot. */
  #hover = signal(/** @type {{ channel: Channel, index: number } | null} */ (null))

  /** Keyboard-selected stop index on the active channel (M4.5); drives the
   *  painted selection ring + `:state(keyboard)`. */
  #selected = signal(/** @type {number | null} */ (null))

  /** Sticky 'last interacted stop' (D-21 #4): the per-stop reset target the
   *  reset cluster reads. Hover, point drag, and keyboard selection all SET
   *  it; unlike #hover it SURVIVES pointerleave — so 'Reset point' is not a
   *  pointer trap (hover used to die en route to the button). Cleared on
   *  channel switch, count change, and any reset click. H handle roles and
   *  C tent handles never write it (no per-stop override there). */
  #sticky = signal(/** @type {number | null} */ (null))

  /** In-flight pointer drag (signal so chip/state bindings track it). */
  #drag = signal(/** @type {DragState | null} */ (null))

  /** Pre-nudge channel snapshot for the keyboard "drag" (Esc restore; commit
   *  = dropping the restore point on blur/selection change). Plain field —
   *  nothing renders from it. @type {ChannelStack | null} */
  #kbSnapshot = null

  /** Pre-nudge seed hue for an H-mode keyboard session (D-22 — a center
   *  nudge translates spec.hue, so Esc must restore it BEFORE the stack).
   *  Written/read only alongside #kbSnapshot. @type {number | null} */
  #kbSnapshotHue = null

  /** Pre-nudge L snapshot for a C-tent PEAK keyboard session (D-24 — the
   *  peak nudge runs through dragTentPeak, which may borrow lightness via a
   *  coupled L override; Esc must restore BOTH stacks). Written/read only
   *  alongside #kbSnapshot. @type {ChannelStack | null} */
  #kbSnapshotL = null

  /** @type {HTMLElement | null} */
  #live = null

  /** Hidden probe for resolving token COLORS through a real CSS property —
   *  `getComputedStyle().getPropertyValue('--curve-l')` returns the raw
   *  token text, and since the curve tokens became `light-dark()` pairs
   *  (D-21 council #7) that raw string is an invalid canvas strokeStyle
   *  (curves painted colorless — caught on the first M6.3 screenshot).
   *  Setting `color: var(...)` on a real element resolves light-dark/var
   *  chains to an absolute rgb() the canvas can use.
   *  @type {HTMLElement | null} */
  #colorProbe = null

  connected() {
    const wrap = /** @type {HTMLElement} */ (this.first('[data-wrap]'))
    const canvas = /** @type {HTMLCanvasElement} */ (this.first('[data-canvas]'))
    const chip = /** @type {CrReadoutChip} */ (this.first('cr-readout-chip'))
    this.#live = /** @type {HTMLElement} */ (this.first('[data-live]'))

    // Size signal: ResizeObserver on the wrapper (disconnected in
    // disconnected()), seeded from clientWidth/Height for the first frame.
    // Zero sizes are ignored — the paint falls back to FALLBACK_W/H so
    // non-layout DOMs (happy-dom) still paint deterministically.
    if (typeof ResizeObserver !== 'undefined') {
      this.#ro = new ResizeObserver((entries) => {
        const e = entries[entries.length - 1]
        const box = e.contentBoxSize?.[0]
        const w = box != null ? box.inlineSize : e.contentRect.width
        const h = box != null ? box.blockSize : e.contentRect.height
        if (w > 0 && h > 0) this.#size.value = { w, h }
      })
      this.#ro.observe(wrap)
    }
    if (wrap.clientWidth > 0 && wrap.clientHeight > 0) {
      this.#size.value = { w: wrap.clientWidth, h: wrap.clientHeight }
    }

    // C1-#1: theme re-raster wiring. A theme flip changes the RESOLVED
    // `--curve-*`/`--color-*` tokens but writes no tracked signal — bump
    // #themeEpoch so the rAF paint (which reads it) re-resolves the colors.
    // (a) `data-theme` attribute flips on <html> (R-22 toggle mechanism);
    // disposal: #themeObserver.disconnect() in disconnected().
    if (typeof MutationObserver !== 'undefined') {
      this.#themeObserver = new MutationObserver((records) => {
        // attributeFilter already scopes this; the explicit check is the
        // belt-and-suspenders guard for hosts that ignore the filter.
        if (records.some((r) => r.attributeName === 'data-theme')) {
          this.#themeEpoch.value++
        }
      })
      this.#themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
      })
    }
    // (b) OS scheme change while data-theme is absent ('system'): the
    // light-dark() tokens follow the UA scheme, so repaint on the media flip.
    // Feature-detected (never throw on hosts without matchMedia / without
    // EventTarget MQLs); the listener disposes via the scope (this.on).
    if (typeof globalThis.matchMedia === 'function') {
      const mql = globalThis.matchMedia('(prefers-color-scheme: dark)')
      if (mql != null && typeof mql.addEventListener === 'function') {
        this.on(mql, 'change', () => this.#themeEpoch.value++)
      }
    }

    // DPR-aware bitmap sizing — its own microtask effect (M4.1): runs before
    // the rAF paint (the rAF drain flushes microtasks first, base §2.6).
    this.effect(() => {
      const { w, h } = this.#size.value
      const dpr = globalThis.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.round((w || FALLBACK_W) * dpr))
      canvas.height = Math.max(1, Math.round((h || FALLBACK_H) * dpr))
    })

    // SPEC §10 empty state: N=2 → endpoints only + hint via :state(empty).
    this.bindState('empty', () => store.spec.value.count === 2)
    // M4.5 :state()-driven styling: dragging (pointer) / keyboard (selection).
    this.bindState('dragging', () => this.#drag.value != null)
    this.bindState('keyboard', () => this.#selected.value != null)

    // THE paint (D-9): one frame-coalesced effect repaints everything.
    this.effectRaf(() => this.#paint(canvas))

    // ── pointer interaction (M4.3) ───────────────────────────────────────────
    this.on(canvas, 'pointerdown', (e) => this.#onPointerDown(/** @type {PointerEvent} */ (e), canvas))
    this.on(canvas, 'pointermove', (e) => this.#onPointerMove(/** @type {PointerEvent} */ (e), canvas))
    this.on(canvas, 'pointerup', (e) => this.#onPointerUp(/** @type {PointerEvent} */ (e), canvas))
    this.on(canvas, 'pointercancel', (e) => this.#onPointerUp(/** @type {PointerEvent} */ (e), canvas))
    this.on(canvas, 'pointerleave', () => {
      if (this.#drag.peek() == null) this.#hover.value = null
    })

    // Esc cancels an in-flight POINTER drag (SPEC §10/M4.3): document-level —
    // focus may sit anywhere mid-drag. The canvas's own keydown handler owns
    // the keyboard-session Esc and defers to this one while a drag is live.
    this.on(document, 'keydown', (e) => {
      if (/** @type {KeyboardEvent} */ (e).key === 'Escape' && this.#drag.peek() != null) {
        this.#cancelPointerDrag(canvas)
      }
    })

    // ── keyboard model (M4.5) ────────────────────────────────────────────────
    this.on(canvas, 'keydown', (e) => this.#onKeyDown(/** @type {KeyboardEvent} */ (e)))
    // Blur commits the keyboard session implicitly (drops the restore point);
    // the selection itself persists so the reset cluster keeps its target.
    this.on(canvas, 'blur', () => {
      this.#kbSnapshot = null
      this.#kbSnapshotHue = null
      this.#kbSnapshotL = null
    })

    // The strip's hover reaches the same hover surface (PLAN M4.4): the
    // 'cr-swatch-hover' CustomEvent bubbles to document from <cr-ramp-strip>
    // (D-21 #13: cr- prefixed). D-22: ignored while H is active — H has no
    // per-stop affordance, and a swatch index is NOT a handle role.
    this.on(document, 'cr-swatch-hover', (e) => {
      const detail = /** @type {CustomEvent<{ index: number }>} */ (e).detail
      if (typeof detail?.index !== 'number') return
      const activeCh = store.view.peek().activeChannel
      if (activeCh === 'H') return
      this.#hover.value = { channel: activeCh, index: detail.index }
      this.#sticky.value = detail.index // D-21 #4: strip hover is an interaction too
    })
    // D-21 #13: the strip announces its own pointer exit ('cr-swatch-leave')
    // — replaces the old reach-into-strip one-shot pointerleave listener.
    this.on(document, 'cr-swatch-leave', () => {
      if (this.#drag.peek() == null) this.#hover.value = null
    })

    // Channel switch / count change invalidate the keyboard session (its
    // snapshot belongs to the OLD stack) and re-scope hover/selection.
    let lastActive = store.view.peek().activeChannel
    let lastCount = store.spec.peek().count
    this.effect(() => {
      const active = store.view.value.activeChannel
      const count = store.spec.value.count
      if (active !== lastActive) {
        lastActive = active
        this.#kbSnapshot = null // implicit commit (M4.5 selection-change rule)
        this.#kbSnapshotHue = null
        this.#kbSnapshotL = null
        this.#selected.value = null
        this.#sticky.value = null // D-21 #4: the target was channel-scoped
        const hover = this.#hover.peek()
        if (hover != null && hover.channel !== active) this.#hover.value = null
      }
      if (count !== lastCount) {
        const oldCount = lastCount
        lastCount = count
        this.#kbSnapshot = null // stale against the reconciled override keys
        this.#kbSnapshotHue = null
        this.#kbSnapshotL = null
        this.#sticky.value = null // D-21 #4: stop indices just moved
        // D-22: H-mode indices are handle ROLES (0..2) plus the two warp
        // indices (R-14) — never count-scoped; the clamp below only applies
        // to per-stop selections/hovers.
        if (active !== 'H') {
          const sel = this.#selected.peek()
          if (sel != null && (sel >= count || sel >= oldCount)) {
            // D-24/R-14: indices ≥ the dot block (tent + warp handles) live
            // in an index space that just moved with the count — drop those
            // selections rather than mis-clamping onto a dot (sel ≥ oldCount
            // ⇒ the selection WAS a parameter/warp handle; in tent mode every
            // out-of-range index drops, the pre-R-14 rule). A DOT selection
            // that fell off the end (sel < oldCount) clamps to the last dot
            // as before.
            const tent = active === 'C' ? store.tentOf(store.spec.peek()) : null
            this.#selected.value = tent != null || sel >= oldCount ? null : count - 1
          }
          const hover = this.#hover.peek()
          if (hover != null && hover.index >= count) this.#hover.value = null
        }
      }
    })

    // ── readout chip data (M4.4, D-20b) ──────────────────────────────────────
    // Target precedence: dragged dot (drag pins the chip) → hovered dot →
    // keyboard selection. Recomputed per spec/palette change so the chip
    // tracks live values mid-drag. On H the index is a handle ROLE (0..2)
    // and the payload comes from the hue formatter (D-22). In C-tent mode
    // (D-24) indices count..count+2 are the tent handles — tent formatter;
    // 'tent' drags store the ROLE, so the chip maps it into count+role.
    this.effect(() => {
      const spec = store.spec.value
      const palette = store.palette.value
      const view = store.view.value
      const { w, h } = this.#size.value
      const drag = this.#drag.value
      const hover = this.#hover.value
      const sel = this.#selected.value
      const ch = view.activeChannel
      const index =
        drag != null && drag.kind !== 'handle'
          ? drag.kind === 'tent'
            ? spec.count + drag.index
            : drag.index
          : hover != null && hover.channel === ch
            ? hover.index
            : sel
      const tent = ch === 'C' && spec.count > 2 ? store.tentOf(spec) : null
      // R-14: the two warp-handle indices close every channel's cycle (after
      // H's 3 roles / the tent block / the N dots) — only keyboard selection
      // produces them (hover and drags never carry a warp index).
      const warpBase = ch === 'H' ? 3 : spec.count + (tent != null ? 3 : 0)
      if (spec.count > 2 && index != null && index >= warpBase && index < warpBase + 2) {
        chip.data = this.#warpReadoutData(
          spec,
          ch,
          index - warpBase,
          w || FALLBACK_W,
          h || FALLBACK_H,
        )
      } else if (ch === 'H') {
        chip.data =
          index != null && index >= 0 && index < 3
            ? this.#hueReadoutData(spec, index, w || FALLBACK_W, h || FALLBACK_H)
            : null
      } else if (tent != null && index != null && index >= spec.count && index < spec.count + 3) {
        chip.data = this.#tentReadoutData(
          spec,
          tent,
          index - spec.count,
          w || FALLBACK_W,
          h || FALLBACK_H,
        )
      } else {
        chip.data =
          index != null && index >= 0 && index < spec.count
            ? this.#readoutData(spec, palette, ch, index, w || FALLBACK_W, h || FALLBACK_H)
            : null
      }
    })

    // ── resets (M4.6; SPEC §6 "overrides → identity (scoped)") ───────────────
    const resetPoint = /** @type {HTMLButtonElement} */ (this.first('[data-reset-point]'))
    const resetChannel = /** @type {HTMLButtonElement} */ (this.first('[data-reset-channel]'))
    const resetAll = /** @type {HTMLButtonElement} */ (this.first('[data-reset-all]'))
    /** The reset-point target: live point drag → the STICKY last-interacted
     *  stop (D-21 #4 — hover/drag/keyboard all write it, and it survives
     *  pointerleave, so the button is reachable without losing the target).
     *  D-24: tent-handle indices (≥ count in C-tent mode) are NOT per-stop
     *  targets — they carry no override to reset, so they never write the
     *  sticky ('Reset point' disables, exactly like H's parameter handles). */
    const targetIndex = () => {
      const drag = this.#drag.value
      if (drag?.kind === 'point') return drag.index
      const count = store.spec.value.count
      const sticky = this.#sticky.value
      return sticky != null && sticky < count ? sticky : null
    }
    // D-22: H exposes no per-stop points — 'Reset point' has no target there
    // (per-stop H overrides are still cleared by 'Reset channel').
    this.bindAttr(
      resetPoint,
      'disabled',
      () => store.view.value.activeChannel === 'H' || targetIndex() == null,
    )
    // D-21 #4: the label NAMES the sticky target by its palette key
    // ('Reset point 600'), so the action's scope is legible from the button.
    this.bindText(resetPoint, () => {
      const i = store.view.value.activeChannel === 'H' ? null : targetIndex()
      const key = i == null ? null : store.palette.value.swatches[i]?.key
      return key == null ? 'Reset point' : `Reset point ${key}`
    })
    this.on(resetPoint, 'click', () => {
      const ch = store.view.peek().activeChannel
      if (ch === 'H') return // D-22 — disabled, but guard the action too
      const i = targetIndex()
      if (i != null) store.resetPoint(ch, i)
      this.#sticky.value = null // D-21 #4: a reset consumes the target
    })
    this.on(resetChannel, 'click', () => {
      store.resetChannel(store.view.peek().activeChannel)
      this.#sticky.value = null // D-21 #4
    })
    this.on(resetAll, 'click', () => {
      store.resetAll()
      this.#sticky.value = null // D-21 #4
    })
  }

  disconnected() {
    this.#ro?.disconnect()
    this.#ro = null
    this.#themeObserver?.disconnect() // C1-#1 (the matchMedia listener is scope-disposed)
    this.#themeObserver = null
    this.#ctx = null // re-resolved through _ctxFactory on the next connect
  }

  // ── pointer handlers (M4.3) ─────────────────────────────────────────────────

  /** Canvas-space point (CSS px) from a pointer event — the same space the
   *  painter publishes `layout` in. @param {PointerEvent} e
   *  @param {HTMLCanvasElement} canvas @returns {Pt} */
  #canvasPoint(e, canvas) {
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  /** @param {HTMLCanvasElement} canvas @param {number} pointerId */
  #capture(canvas, pointerId) {
    try {
      canvas.setPointerCapture?.(pointerId)
    } catch {
      /* inactive pointer (synthetic events) — capture is best-effort */
    }
  }

  /** @param {HTMLCanvasElement} canvas @param {number} pointerId */
  #release(canvas, pointerId) {
    try {
      canvas.releasePointerCapture?.(pointerId)
    } catch {
      /* already released / never captured */
    }
  }

  /**
   * D-24 hit pre-check, run BEFORE the frozen curve-math hitTest — active
   * only when the painted frame published tent handles (`layout.tent`).
   * Priority: bézier handles > tent handles > (hitTest:) dots > curves. The
   * bézier check is duplicated here because the frozen hitTest puts dots
   * FIRST — in tent mode the parameter handles must win over coincident stop
   * dots, and the bézier handles must keep their priority over the tent's.
   * Radii: bézier 9 (HIT_RADIUS.handle), tent peak 8, tent flank 7.
   * @param {Pt} pt @returns {PreHit | null}
   */
  #preHit(pt) {
    const layout = this.layout
    const tent = layout?.tent
    if (layout == null || tent == null) return null
    if (layout.handles != null) {
      const pts = [layout.handles.p1, layout.handles.p2]
      let best = null
      for (let i = 0; i < 2; i++) {
        const p = pts[i]
        if (p == null) continue
        const d = Math.hypot(pt.x - p.x, pt.y - p.y)
        if (d <= HIT_RADIUS.handle && (best == null || d < best.d)) best = { d, i }
      }
      if (best != null) return { kind: 'handle', channel: layout.activeChannel, index: best.i }
    }
    const candidates = [
      { p: tent.peak, r: TENT_HIT.peak, role: 0 },
      { p: tent.low, r: TENT_HIT.flank, role: 1 },
      { p: tent.high, r: TENT_HIT.flank, role: 2 },
    ]
    let bestTent = null
    for (const c of candidates) {
      const d = Math.hypot(pt.x - c.p.x, pt.y - c.p.y)
      if (d <= c.r && (bestTent == null || d < bestTent.d)) bestTent = { d, role: c.role }
    }
    if (bestTent != null) return { kind: 'tent', channel: 'C', index: bestTent.role }
    return null
  }

  /** @param {PointerEvent} e @param {HTMLCanvasElement} canvas */
  #onPointerDown(e, canvas) {
    if (e.button !== 0) return // primary button only
    const pt = this.#canvasPoint(e, canvas)
    // D-24: the tent pre-check resolves bézier/tent handles ahead of the
    // frozen hitTest (no-op outside C-tent mode — see #preHit).
    const hit = this.#preHit(pt) ?? hitTest(pt, this.layout)
    const active = store.view.peek().activeChannel
    if (hit.kind === 'dot' && hit.index != null) {
      // D-23 grab-offset: where inside the hit radius did the press land,
      // relative to the dot's PAINTED y? Every move subtracts this, so the
      // grabbed dot tracks the hand instead of snapping to the pointer.
      const dot = this.layout?.dots.find((d) => d.i === hit.index)
      const grabDy = dot != null ? pt.y - dot.y : 0
      if (active === 'H') {
        // D-22 *dragging a hue handle*: snapshot BOTH the stack and the seed
        // hue (a center drag translates spec.hue; Esc restores hue first).
        // startValue is GRAB-COMPENSATED — i.e. the handle's own displayed
        // value, not the pointer's (D-23: no jump on the first move).
        const s = store.spec.peek()
        this.#drag.value = {
          kind: 'hue',
          channel: 'H',
          index: hit.index,
          pointerId: e.pointerId,
          snapshot: structuredClone(s.channels.H),
          startHue: s.hue,
          startValue: yToValue('H', pt.y - grabDy, s.hue, this.layout?.height ?? FALLBACK_H),
          grabDx: 0,
          grabDy,
        }
      } else {
        // SPEC §10 *dragging point*: snapshot first (Esc restore), then drag.
        this.#drag.value = {
          kind: 'point',
          channel: active,
          index: hit.index,
          pointerId: e.pointerId,
          snapshot: structuredClone(store.spec.peek().channels[active]),
          grabDx: 0,
          grabDy,
        }
        this.#sticky.value = hit.index // D-21 #4: a grabbed stop is the reset target
      }
      this.#hover.value = { channel: active, index: hit.index } // chip pins to the dragged dot
      this.#capture(canvas, e.pointerId)
    } else if (hit.kind === 'handle' && hit.index != null) {
      // SPEC §10 *dragging handle*: dots ride along; pinned ones keep their delta (A4).
      // D-23 grab-offset: handles compensate BOTH axes (x drives the warp's
      // p.x). Measured against the PARKED display position (curve-math
      // HANDLE_INSET) — re-dragging a parked handle recomputes the warp from
      // the compensated pointer as always.
      const hp = hit.index === 0 ? this.layout?.handles?.p1 : this.layout?.handles?.p2
      this.#drag.value = {
        kind: 'handle',
        channel: active,
        index: hit.index,
        pointerId: e.pointerId,
        snapshot: structuredClone(store.spec.peek().channels[active]),
        grabDx: hp != null ? pt.x - hp.x : 0,
        grabDy: hp != null ? pt.y - hp.y : 0,
      }
      this.#capture(canvas, e.pointerId)
    } else if (hit.kind === 'tent') {
      // D-24 tent-handle drag. The PEAK (role 0) is the LIVE-2D coupled
      // gesture: dragTentPeak may write a coupled L override mid-drag, so
      // snapshot BOTH stacks (Esc restores C and L together — see
      // #cancelPointerDrag). Flanks are C-only setTent edits. Grab-offset
      // (D-23) compensates BOTH axes: the peak drag is 2D and the flank
      // inversion reads x and y.
      const s = store.spec.peek()
      const tl = this.layout?.tent
      const hp = tl == null ? null : [tl.peak, tl.low, tl.high][hit.index]
      this.#drag.value = {
        kind: 'tent',
        channel: 'C',
        index: hit.index,
        pointerId: e.pointerId,
        snapshot: structuredClone(s.channels.C),
        snapshotL: hit.index === 0 ? structuredClone(s.channels.L) : null,
        grabDx: hp != null ? pt.x - hp.x : 0,
        grabDy: hp != null ? pt.y - hp.y : 0,
      }
      // chip pins to the dragged handle (count+role — the tent chip index space)
      this.#hover.value = { channel: 'C', index: s.count + hit.index }
      this.#capture(canvas, e.pointerId)
    } else if (hit.kind === 'curve' && hit.channel != null && hit.channel !== active) {
      // D-7a click-to-activate (SPEC §10 *switch active channel*).
      store.setActiveChannel(hit.channel)
    }
    // Active curve / empty space: nothing (SPEC §10 — no accidental edits).
    // A started drag drops the inline hover cursor so the stylesheet's
    // :state(dragging) 'grabbing' applies (inline style would win otherwise).
    if (this.#drag.peek() != null) canvas.style.cursor = ''
  }

  /** @param {PointerEvent} e @param {HTMLCanvasElement} canvas */
  #onPointerMove(e, canvas) {
    const layout = this.layout
    if (layout == null) return
    const pt = this.#canvasPoint(e, canvas)
    const drag = this.#drag.peek()
    if (drag == null) {
      // Hover surface (SPEC §10 *hover point*): dots + tent handles — never
      // curves. Tent handles (D-24) share the dot hover surface using the
      // count+role chip index space.
      const hit = this.#preHit(pt) ?? hitTest(pt, layout)
      this.#hover.value =
        hit.kind === 'dot' && hit.index != null
          ? { channel: layout.activeChannel, index: hit.index }
          : hit.kind === 'tent'
            ? { channel: 'C', index: store.spec.peek().count + hit.index }
            : null
      // D-21 #4: a hovered STOP becomes the sticky reset target (survives
      // pointerleave). H-mode 'dots' are handle roles, tent handles carry no
      // per-stop override — neither is a target.
      if (hit.kind === 'dot' && hit.index != null && layout.activeChannel !== 'H') {
        this.#sticky.value = hit.index
      }
      // Hover signifiers (council MAJOR #3): cursor telegraphs the affordance —
      // dots/handles are grabbable, an INACTIVE channel's curve invites the
      // D-7a switch click. Inline style is runtime data, not authored CSS
      // (token gate T3 scans css`` literals only); the :state(dragging)
      // grabbing cursor stands during a drag (cleared on pointerdown).
      canvas.style.cursor =
        hit.kind === 'dot' || hit.kind === 'handle' || hit.kind === 'tent'
          ? 'grab'
          : hit.kind === 'curve' && hit.channel != null && hit.channel !== layout.activeChannel
            ? 'pointer'
            : ''
      return
    }
    const spec = store.spec.peek()
    // D-23 grab-offset compensation: ALL value math runs on the pointer MINUS
    // the offset recorded at pointerdown, so the target follows the hand
    // rather than jumping to wherever inside the hit radius the press landed.
    const gpt = { x: pt.x - drag.grabDx, y: pt.y - drag.grabDy }
    if (drag.kind === 'point') {
      // Value in channel units off the y axis; the store back-solves the
      // override delta (SPEC §6) and batches internally — the rAF paint
      // coalesces every move in a frame into one repaint (B5/D-9).
      store.dragPoint(drag.channel, drag.index, yToValue(drag.channel, gpt.y, spec.hue, layout.height))
    } else if (drag.kind === 'hue') {
      this.#dragHueTo(drag, gpt, spec, layout)
    } else if (drag.kind === 'tent') {
      this.#dragTentTo(drag, gpt, spec, layout)
    } else {
      this.#dragHandleTo(drag, gpt, spec, layout)
    }
  }

  /** D-24 tent-handle drag (`pt` is already GRAB-COMPENSATED — D-23).
   *  PEAK (role 0) — the LIVE-2D coupled gesture: x AND y forward to
   *  store.dragTentPeak per move. y is NOT cap-clamped (only viewport-clamped
   *  by yToValue): asking for more chroma than the local gamut affords makes
   *  the store borrow lightness (a coupled per-stop L override), which
   *  invalidates the painter's capLUT cache (keyed on the L stack reference) —
   *  the dashed cap line LIFTS under the pointer on the next frame. x clamps
   *  to [0.02, 0.98] (engine validation window).
   *  FLANKS (role 1 low/rise · 2 high/fall) — invert the display mapping
   *  (segment-local → absolute, see #tentLayout) back into segment-local
   *  {x, y}: low x = t/peakT, y = (v − min)/(peakC − min); high
   *  x = (t − peakT)/(1 − peakT), y = (peakC − v)/(peakC − min). x clamps to
   *  [0.02, 0.98], y to [0, 1]; dispatched through store.setTent — C-only.
   *  @param {TentDrag} drag @param {Pt} pt @param {PaletteSpec} spec
   *  @param {CanvasLayout} layout */
  #dragTentTo(drag, pt, spec, layout) {
    const tent = store.tentOf(spec)
    if (tent == null) return // base swapped away mid-drag — nothing to edit
    const clampX = (/** @type {number} */ x) => Math.min(TENT_X_MAX, Math.max(TENT_X_MIN, x))
    const t = xToT(pt.x, layout.width)
    const value = yToValue('C', pt.y, spec.hue, layout.height)
    if (drag.index === 0) {
      store.dragTentPeak(clampX(t), value)
      return
    }
    const min = spec.channels.C.bounds.min
    const span = tent.peakC - min
    const clampY = (/** @type {number} */ y) => Math.min(1, Math.max(0, y))
    if (drag.index === 1) {
      const x = clampX(tent.peakT <= 0 ? TENT_X_MIN : t / tent.peakT)
      const y = clampY(span <= 0 ? 0 : (value - min) / span)
      store.setTent({ low: { x, y } })
    } else {
      const x = clampX(tent.peakT >= 1 ? TENT_X_MAX : (t - tent.peakT) / (1 - tent.peakT))
      const y = clampY(span <= 0 ? 0 : (tent.peakC - value) / span)
      store.setTent({ high: { x, y } })
    }
  }

  /** D-22 hue-handle drag (`pt` is already GRAB-COMPENSATED — D-23). Ends
   *  (role 0 dark / 2 light) re-solve their drift endpoint from the pointer's
   *  absolute value (`value − hue`; the OTHER end
   *  is read fresh off the live spec each move). The CENTER (role 1)
   *  TRANSLATES the seed hue by the pointer delta, measured in the DRAG-START
   *  frame: Y_RANGES(hue) recenters the viewport on the live hue every frame,
   *  so measuring against the current hue would compound the translation —
   *  each move recomputes absolutely from `startHue + (value − startValue)`.
   *  (The curve visually stays put while the AXIS slides; that is correct.)
   *  yToValue clamps to the ±30° viewport, so a single gesture can't push
   *  drift past the channel bounds (the engine stays the backstop).
   *  @param {HueDrag} drag @param {Pt} pt @param {PaletteSpec} spec
   *  @param {CanvasLayout} layout */
  #dragHueTo(drag, pt, spec, layout) {
    if (drag.index === 1) {
      const value = yToValue('H', pt.y, drag.startHue, layout.height)
      store.setHue(drag.startHue + (value - drag.startValue))
      return
    }
    const value = yToValue('H', pt.y, spec.hue, layout.height)
    const { dark, light } = store.hueDriftOf(spec)
    if (drag.index === 0) store.setHueDrift(value - spec.hue, light)
    else store.setHueDrift(dark, value - spec.hue)
  }

  /** Handle drag (M4.3; `pt` is already GRAB-COMPENSATED on both axes —
   *  D-23): x PRE-CLAMPED monotone in pointer math — bounded by
   *  the OTHER handle's current x inward and a 0.01 margin at the 0/1 ends,
   *  so 0 < p1.x ≤ p2.x < 1 always holds and the engine's validateWarp can
   *  never fire from the UI. y inverts the SAME band-anchored mapping the
   *  painter draws with (D-21 #9): pointer y → channel VALUE over the display
   *  range → easing-y over the warp band (#warpBand) — the exact inverse of
   *  bezierHandlePositions' yOf, so a drag round-trips through one mapping.
   *  CSS-easing overshoot stays allowed in [-0.2, 1.2].
   *  @param {DragState} drag @param {Pt} pt @param {PaletteSpec} spec
   *  @param {CanvasLayout} layout */
  #dragHandleTo(drag, pt, spec, layout) {
    const { p1, p2 } = spec.channels[drag.channel].bezier
    const rawX = xToT(pt.x, layout.width)
    const band = this.#warpBand(spec, drag.channel)
    const r = Y_RANGES(spec.hue)[drag.channel]
    // pointer y → value (UNclamped — overshoot is the warp's, not the
    // viewport's; the D-21 #14 V_PAD plot area, the exact unclamped inverse
    // of curve-math's valueToY) → normalized easing-y over the band.
    const value =
      r.min + (1 - (pt.y - V_PAD) / (layout.height - 2 * V_PAD)) * (r.max - r.min)
    // Degenerate band (flat curve, e.g. no-drift H): the warp is INERT on the
    // curve, but the handles stay LIVE against the shared nominal centered
    // band (owner QA 2026-06-10 ×2 — a frozen handle reads as broken). The
    // stored easing shape activates when the band opens (drift added).
    const flat = band.max - band.min < 1e-9
    const eff = flat ? nominalBand(drag.channel, spec.hue, band.min) : band
    const rawY = (value - eff.min) / (eff.max - eff.min)
    const y = Math.min(HANDLE_Y_MAX, Math.max(HANDLE_Y_MIN, rawY))
    if (drag.index === 0) {
      const x = Math.min(Math.max(rawX, HANDLE_X_MARGIN), p2.x)
      store.dragHandle(drag.channel, { x, y }, p2) // p2 unchanged
    } else {
      const x = Math.max(Math.min(rawX, 1 - HANDLE_X_MARGIN), p1.x)
      store.dragHandle(drag.channel, p1, { x, y }) // p1 unchanged
    }
  }

  /** @param {PointerEvent} e @param {HTMLCanvasElement} canvas */
  #onPointerUp(e, canvas) {
    const drag = this.#drag.peek()
    if (drag == null) return
    this.#release(canvas, e.pointerId)
    this.#drag.value = null
    // M4.5 announce throttle: drag END only, never per-frame.
    if (drag.kind === 'point') this.#announce(drag.channel, drag.index)
    else if (drag.kind === 'hue') this.#announceHue(drag.index)
    else if (drag.kind === 'tent') this.#announceTent(drag.index)
  }

  /** Esc mid-drag (SPEC §10/M4.3 cancel): the pointerdown snapshot goes back
   *  in wholesale; base/bézier/all other overrides were never touched.
   *  D-22 hue drags restore spec.hue FIRST, then the stack: setHue TRANSLATES
   *  the H base by the hue delta (and recenters the hue±30 bounds), so the
   *  reverse order would re-translate — i.e. corrupt — the just-restored
   *  snapshot.
   *  D-24 tent PEAK drags are the coupled two-channel gesture: restore the C
   *  AND L snapshots together inside one batch — one repaint, no torn
   *  intermediate palette where the C ask exceeds a not-yet-restored L's cap.
   *  @param {HTMLCanvasElement} canvas */
  #cancelPointerDrag(canvas) {
    const drag = this.#drag.peek()
    if (drag == null) return
    this.#release(canvas, drag.pointerId)
    this.#drag.value = null
    if (drag.kind === 'hue') store.setHue(drag.startHue)
    if (drag.kind === 'tent' && drag.snapshotL != null) {
      const snapshotL = drag.snapshotL
      batch(() => {
        store.replaceChannel('C', drag.snapshot)
        store.replaceChannel('L', snapshotL)
      })
      return
    }
    store.replaceChannel(drag.channel, drag.snapshot)
  }

  // ── keyboard model (M4.5) ───────────────────────────────────────────────────

  /** R-14: the keyboard cycle's per-channel shape. The leading block is the
   *  dots / parameter handles (H: 3 roles — D-22; C tent: N dots + 3 tent
   *  handles — D-24; else: the N dots); the two warp handles close the cycle
   *  at [warpBase, warpBase+1] EXCEPT in the N=2 empty state (warpN 0 — the
   *  painter suppresses the handles there too; the warp cannot affect a
   *  two-stop ramp). Pinned cycle order (header + tests):
   *    L / non-tent C: dots → warp p1 → warp p2
   *    C tent:         dots → peak → rise → fall → warp p1 → warp p2
   *    H:              dark → center → light → warp p1 → warp p2
   *  @param {PaletteSpec} spec @param {Channel} ch
   *  @param {TentParams | null} tent
   *  @returns {{ warpN: number, warpBase: number, cycle: number }} */
  #cycleShape(spec, ch, tent) {
    const warpBase = ch === 'H' ? 3 : spec.count + (tent != null ? 3 : 0)
    const warpN = spec.count > 2 ? 2 : 0
    return { warpN, warpBase, cycle: warpBase + warpN }
  }

  /** Open the keyboard nudge session on its FIRST nudge (the Esc restore
   *  point — M4.5): the active channel stack always; the seed hue in H mode
   *  (a center nudge translates it — D-22); the L stack when `withL` (a
   *  C-tent PEAK session — dragTentPeak may borrow lightness, so Esc must
   *  restore BOTH stacks — D-24). No-op while a session is already open
   *  (selection change / blur / Esc are the only closers).
   *  @param {PaletteSpec} spec @param {Channel} ch @param {boolean} withL */
  #openKbSession(spec, ch, withL) {
    if (this.#kbSnapshot != null) return
    this.#kbSnapshot = structuredClone(spec.channels[ch])
    this.#kbSnapshotHue = ch === 'H' ? spec.hue : null
    this.#kbSnapshotL = withL ? structuredClone(spec.channels.L) : null
  }

  /** R-14 Alt+←/→ x-nudge dispatch (`dir` carries the arrow's sign AND the
   *  Shift ×10). Only handles WITH an x degree of freedom respond:
   *  - warp p1/p2: warp-x ±WARP_X_NUDGE under the #dragHandleTo monotone
   *    pre-clamp (0.01 end margins; p1.x ≤ p2.x — p1 cannot cross p2, and
   *    vice versa);
   *  - tent peak: peakT ±TENT_PEAK_X_NUDGE clamped [0.02, 0.98], dispatched
   *    through store.dragTentPeak(newT, peakC) — the SAME live-2D coupled
   *    gesture as the pointer, so lightness borrow/release bookkeeping stays
   *    consistent (the session snapshots L; Esc restores both stacks);
   *  - tent flanks: segment-local x ±TENT_FLANK_X_NUDGE clamped [0.02, 0.98]
   *    via setTent (C-only).
   *  Stop dots (fixed t = i/(N−1)) and the three H handles (ends pinned at
   *  t=0/1, center at 0.5) have NO x freedom — INERT: no store write, no
   *  selection change (the caller already preventDefaulted, so the browser
   *  never history-navigates on Alt+←/→). Nudges announce (M4.5 throttle);
   *  the peak announce carries its new POSITION (peakT) — the x axis is the
   *  thing that moved.
   *  @param {PaletteSpec} spec @param {Channel} ch
   *  @param {TentParams | null} tent @param {number} warpN
   *  @param {number} warpBase @param {number} dir */
  #xNudge(spec, ch, tent, warpN, warpBase, dir) {
    const i = this.#selected.peek()
    if (i == null) return
    if (warpN > 0 && i >= warpBase && i < warpBase + 2) {
      this.#openKbSession(spec, ch, false)
      const { p1, p2 } = spec.channels[ch].bezier
      const role = i - warpBase
      if (role === 0) {
        const x = Math.min(Math.max(p1.x + WARP_X_NUDGE * dir, HANDLE_X_MARGIN), p2.x)
        store.dragHandle(ch, { x, y: p1.y }, p2)
      } else {
        const x = Math.max(Math.min(p2.x + WARP_X_NUDGE * dir, 1 - HANDLE_X_MARGIN), p1.x)
        store.dragHandle(ch, p1, { x, y: p2.y })
      }
      this.#announceWarp(role)
      return
    }
    if (tent == null || i < spec.count || i >= spec.count + 3) return // no x freedom — inert
    const clampX = (/** @type {number} */ x) => Math.min(TENT_X_MAX, Math.max(TENT_X_MIN, x))
    const role = i - spec.count // 0 peak | 1 rise (low) | 2 fall (high)
    this.#openKbSession(spec, ch, role === 0)
    if (role === 0) {
      store.dragTentPeak(clampX(tent.peakT + TENT_PEAK_X_NUDGE * dir), tent.peakC)
      this.#announceTent(0, true) // x-nudge → announce the new peak position
    } else {
      const cur = role === 1 ? tent.low : tent.high
      const x = clampX(cur.x + TENT_FLANK_X_NUDGE * dir)
      store.setTent(role === 1 ? { low: { x, y: cur.y } } : { high: { x, y: cur.y } })
      this.#announceTent(role) // the flank readout already carries x
    }
  }

  /** @param {KeyboardEvent} e */
  #onKeyDown(e) {
    if (this.#drag.peek() != null) return // a pointer drag owns the gesture (Esc → document handler)
    const spec = store.spec.peek()
    const ch = store.view.peek().activeChannel
    // D-24: a C tent base appends its 3 parameter handles AFTER the N dots
    // (cycle indices count..count+2 = peak / rise / fall); suppressed in the
    // N=2 empty state, mirroring the painter (nothing the peak can move).
    const tent = ch === 'C' && spec.count > 2 ? store.tentOf(spec) : null
    // D-22: H mode cycles the 3 parameter handles, not the N stops. R-14:
    // the two warp handles close every cycle (#cycleShape).
    const { warpN, warpBase, cycle } = this.#cycleShape(spec, ch, tent)
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      // preventDefault even on the inert Alt paths: Alt+←/→ is browser
      // history navigation in several UAs — never mid-edit (R-14).
      e.preventDefault()
      const dir = e.key === 'ArrowRight' ? 1 : -1
      if (e.altKey) {
        // R-14: Alt+←/→ x-nudges the selection instead of cycling — part of
        // the SAME nudge session as ↑/↓ (no commit here).
        this.#xNudge(spec, ch, tent, warpN, warpBase, (e.shiftKey ? 10 : 1) * dir)
        return
      }
      this.#kbSnapshot = null // selection change commits the in-flight nudge session
      this.#kbSnapshotHue = null
      this.#kbSnapshotL = null
      const cur = this.#selected.peek()
      const next = cur == null ? (dir === 1 ? 0 : cycle - 1) : (cur + dir + cycle) % cycle
      this.#selected.value = next
      // C4-#2: a selection CHANGE announces what the ring landed on — the
      // ring/chip are visual-only, so without this `[data-live]` stayed
      // silent until the first nudge. Same per-role formatters as the nudge
      // announcements; same throttle tier (selection change + nudges only).
      this.#announceSelection(spec, ch, tent, warpBase, warpN, next)
      // D-21 #4: a keyboard-selected STOP is the sticky reset target (H handle
      // roles and tent/warp-cycle indices ≥ count are not per-stop targets).
      if (ch !== 'H' && next < spec.count) this.#sticky.value = next
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const i = this.#selected.peek()
      if (i == null) return
      e.preventDefault()
      const dir = (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1)
      // R-14 warp-handle y nudge (their indices close the cycle — checked
      // FIRST: they sit past the tent block and past H's 3 roles). ±0.05
      // easing-y (Shift ×10), clamped to the [−0.2, 1.2] overshoot window —
      // the same window as the pointer drag. dragHandle → setBezier touches
      // ONLY this channel's bezier, so the single-channel session suffices.
      if (warpN > 0 && i >= warpBase && i < warpBase + 2) {
        this.#openKbSession(spec, ch, false)
        const { p1, p2 } = spec.channels[ch].bezier
        const role = i - warpBase
        const y = Math.min(
          HANDLE_Y_MAX,
          Math.max(HANDLE_Y_MIN, (role === 0 ? p1.y : p2.y) + WARP_Y_NUDGE * dir),
        )
        if (role === 0) store.dragHandle(ch, { x: p1.x, y }, p2)
        else store.dragHandle(ch, p1, { x: p2.x, y })
        this.#announceWarp(role) // M4.5: keyboard nudges announce
        return
      }
      // Stale index past the live cycle (base/count/mode changed since the
      // selection): inert until re-selected — never mis-target a nudge.
      if (i >= warpBase) return
      // Snapshot on the FIRST nudge of a session (Esc restore point). H mode
      // also snapshots the seed hue (a center nudge translates it — D-22);
      // a C-tent PEAK session also snapshots the L stack (dragTentPeak may
      // borrow lightness — D-24).
      this.#openKbSession(spec, ch, tent != null && i === spec.count)
      if (tent != null && i >= spec.count) {
        // D-24 tent-handle ↑/↓ nudges — y (Alt+←/→ owns x since R-14). The
        // PEAK steps by 1% of the C display range (same basis as the
        // per-stop nudge, Shift ×10) through the SAME live-2D gesture as the
        // pointer — it may borrow/return lightness mid-session; Esc restores
        // both stacks. Flanks step their segment-local y by ±0.02
        // (Shift ×10), clamped to [0, 1].
        const role = i - spec.count // 0 peak | 1 rise (low) | 2 fall (high)
        if (role === 0) {
          const range = Y_RANGES(spec.hue).C
          const step = (range.max - range.min) * NUDGE_FRACTION * dir
          store.dragTentPeak(tent.peakT, Math.max(0, tent.peakC + step))
        } else {
          const cur = role === 1 ? tent.low : tent.high
          const y = Math.min(1, Math.max(0, cur.y + TENT_FLANK_NUDGE * dir))
          store.setTent(role === 1 ? { low: { x: cur.x, y } } : { high: { x: cur.x, y } })
        }
        this.#announceTent(role) // M4.5: keyboard nudges announce
        return
      }
      if (ch === 'H') {
        // D-22: ends nudge their drift offset; the center nudges the hue.
        const step = HUE_NUDGE_DEG * dir
        if (i === 1) {
          store.setHue(spec.hue + step)
        } else {
          const { dark, light } = store.hueDriftOf(spec)
          if (i === 0) store.setHueDrift(dark + step, light)
          else store.setHueDrift(dark, light + step)
        }
        this.#announceHue(i) // M4.5: keyboard nudges announce
        return
      }
      const range = Y_RANGES(spec.hue)[ch]
      const step = (range.max - range.min) * NUDGE_FRACTION * dir
      const stop = this.#resolveStop(spec, store.palette.peek(), ch, i)
      if (stop == null) return
      store.dragPoint(ch, i, stop.value + step)
      this.#announce(ch, i) // M4.5: keyboard nudges announce
    } else if (e.key === 'Escape') {
      if (this.#kbSnapshot != null) {
        const snapshot = this.#kbSnapshot
        const snapshotHue = this.#kbSnapshotHue
        const snapshotL = this.#kbSnapshotL
        this.#kbSnapshot = null
        this.#kbSnapshotHue = null
        this.#kbSnapshotL = null
        // D-22 restore order (see #cancelPointerDrag): hue first, then stack.
        if (ch === 'H' && snapshotHue != null) store.setHue(snapshotHue)
        if (snapshotL != null) {
          // D-24: the C-tent PEAK session is the coupled gesture — restore
          // C and L together (one batch, same as the pointer cancel).
          batch(() => {
            store.replaceChannel(ch, snapshot)
            store.replaceChannel('L', snapshotL)
          })
        } else {
          store.replaceChannel(ch, snapshot)
        }
      }
    }
  }

  // ── readout derivation (M4.4/M4.5 — one formatter for chip AND aria-live) ──

  /** Resolve one stop's displayed value exactly like the painter's dots
   *  (sampleChannel with generate's ctx — L in Lr, H unwrapped degrees; C
   *  against the stop's RESOLVED L/H off the palette, ONE peakC).
   *  @param {PaletteSpec} spec @param {Palette} palette @param {Channel} ch
   *  @param {number} i
   *  @returns {{ value: number, clamped: boolean, clampDelta: number } | null} */
  #resolveStop(spec, palette, ch, i) {
    const t = i / (spec.count - 1)
    const gamut = spec.displayGamut
    const stack = spec.channels[ch]
    if (ch === 'C') {
      const sw = palette.swatches[i]
      if (sw == null) return null // count/palette mismatch — transient
      const { L, H } = sw.oklch
      const cap = peakC(L, H, gamut)
      const value = sampleChannel(stack, { t, hue: H, L, cap, stopIndex: i, gamut })
      const clamped = value >= cap - 1e-9
      // Council MAJOR #2b: the swatch's clampedChromaDelta is 0 by
      // construction when C's bound is 'gamut' (it samples against this very
      // cap), so the chip's ΔC reads the OVERSHOOT instead: the unclamped
      // compound — (base⊗bézier) ⊗ override, i.e. sampleChannel WITHOUT its
      // final clamp — minus the cap. Composed from the two public engine
      // calls; the op apply is the one line below.
      let clampDelta = 0
      if (clamped) {
        const m = stack.overrides[i]
        const bb = baseBezier(stack, { t, hue: H, L, cap, gamut })
        const unclamped = m == null ? bb : stack.op === 'mul' ? bb * m : bb + m
        clampDelta = Math.max(0, unclamped - cap)
      }
      return { value, clamped, clampDelta }
    }
    const value = sampleChannel(stack, { t, hue: spec.hue, stopIndex: i, gamut })
    return { value, clamped: false, clampDelta: 0 }
  }

  /** Chip payload for stop `i` (SPEC §10 *hover point*): formatted readout +
   *  canvas-px placement. @param {PaletteSpec} spec @param {Palette} palette
   *  @param {Channel} ch @param {number} i @param {number} width
   *  @param {number} height @returns {ChipData | null} */
  #readoutData(spec, palette, ch, i, width, height) {
    const stop = this.#resolveStop(spec, palette, ch, i)
    if (stop == null) return null
    const fmt = formatReadout({
      channel: ch,
      op: spec.channels[ch].op,
      delta: spec.channels[ch].overrides[i] ?? null,
      value: stop.value,
      clamped: stop.clamped,
      clampDelta: stop.clampDelta,
      gamutLabel: spec.displayGamut === 'p3' ? 'P3' : 'sRGB',
    })
    return {
      ...fmt,
      clamped: stop.clamped,
      x: tToX(i / (spec.count - 1), width),
      y: valueToY(ch, stop.value, spec.hue, height),
      maxX: width,
    }
  }

  /** Chip payload for hue handle `role` ∈ 0..2 (D-22): hue formatter output +
   *  the handle's canvas-px placement — same anchoring as #hueHandleDots
   *  (ends sample the curve endpoints; the CENTER sits at its semantic value
   *  hue + drift mean, D-23 — the chip stays pinned to the handle).
   *  @param {PaletteSpec} spec
   *  @param {number} role @param {number} width @param {number} height
   *  @returns {ChipData} */
  #hueReadoutData(spec, role, width, height) {
    const t = role / 2
    const { dark, light } = store.hueDriftOf(spec)
    const v =
      role === 1
        ? spec.hue + (dark + light) / 2
        : baseBezier(spec.channels.H, { t, hue: spec.hue, gamut: spec.displayGamut })
    const fmt = formatHueReadout({
      role: HUE_ROLES[role] ?? 'center',
      hue: spec.hue,
      offset: role === 0 ? dark : light,
    })
    return {
      ...fmt,
      clamped: false,
      x: tToX(t, width),
      y: valueToY('H', v, spec.hue, height),
      maxX: width,
    }
  }

  /** Mirror a hue handle's readout to the aria-live region (D-22; same
   *  throttle rules as #announce: drag END + keyboard nudges only).
   *  @param {number} role */
  #announceHue(role) {
    if (this.#live == null) return
    const spec = store.spec.peek()
    const { dark, light } = store.hueDriftOf(spec)
    const fmt = formatHueReadout({
      role: HUE_ROLES[role] ?? 'center',
      hue: spec.hue,
      offset: role === 0 ? dark : light,
    })
    this.#live.textContent = fmt.text
  }

  /** D-24: is the peak's chroma being afforded by a lightness bend? TRUE iff
   *  an L override exists at the peak's nearest stop AND the tent's ask
   *  exceeds the UNBENT cap there (the cap with that override removed) — the
   *  same demand/release test the store's dragTentPeak runs. Derived from
   *  the SPEC on purpose, not from the store's bookkeeping probe
   *  (`_tentCouplingForTests`): the store assigns that record AFTER its
   *  commit's batch has already drained microtask effects, so signal-driven
   *  readers like the chip would see it one flush stale (the suffix would
   *  miss the very commit that borrowed). Cost: one sampleChannel + one
   *  peakC per tent-chip recompute — microtask tier, same single-stop shape
   *  as the M4.4 readout budget. @param {PaletteSpec} spec
   *  @param {TentParams} tent @returns {boolean} */
  #tentCouplingActive(spec, tent) {
    const i = Math.round(tent.peakT * (spec.count - 1))
    if (spec.channels.L.overrides[i] == null) return false
    const sw = store.palette.peek().swatches[i]
    if (sw == null) return false // count/palette mismatch — transient
    const gamut = spec.displayGamut
    const LrUnbent = sampleChannel(resetOverride(spec.channels.L, i), {
      t: i / (spec.count - 1),
      hue: spec.hue,
      stopIndex: i,
      gamut,
    })
    const capUnbent = peakC(toeInv(LrUnbent), sw.oklch.H, gamut)
    return tent.peakC > capUnbent + 1e-6
  }

  /** ONE formatter for the tent chip AND its aria-live mirror (the M4.4/M4.5
   *  one-formatter rule). `role` ∈ 0..2 — peak / rise (low) / fall (high).
   *  `withPosition` (R-14): the peak readout additionally carries peakT —
   *  used by the Alt+←/→ x-nudge announcements (the position is the thing
   *  that moved); the chip path omits it, keeping the D-24 format pinned.
   *  @param {PaletteSpec} spec @param {TentParams} tent @param {number} role
   *  @param {boolean} [withPosition] */
  #tentFormat(spec, tent, role, withPosition = false) {
    const r = TENT_ROLES[role] ?? 'peak'
    if (r === 'peak') {
      return formatTentReadout({
        role: 'peak',
        peakC: tent.peakC,
        peakT: withPosition ? tent.peakT : undefined,
        borrowed: this.#tentCouplingActive(spec, tent),
      })
    }
    const p = r === 'rise' ? tent.low : tent.high
    return formatTentReadout({ role: r, x: p.x, y: p.y })
  }

  /** Chip payload for tent handle `role` ∈ 0..2 (D-24): tent formatter output
   *  + the handle's canvas-px placement (the same parked geometry the painter
   *  publishes — #tentLayout). @param {PaletteSpec} spec
   *  @param {TentParams} tent @param {number} role @param {number} width
   *  @param {number} height @returns {ChipData} */
  #tentReadoutData(spec, tent, role, width, height) {
    const tl = this.#tentLayout(spec, tent, width, height)
    const p = [tl.peak, tl.low, tl.high][role] ?? tl.peak
    const fmt = this.#tentFormat(spec, tent, role)
    return { ...fmt, clamped: false, x: p.x, y: p.y, maxX: width }
  }

  /** Mirror a tent handle's readout to the aria-live region (D-24; same
   *  throttle rules as #announce: drag END + keyboard nudges only).
   *  `withPosition` (R-14): peak x-nudges announce the new peakT too.
   *  @param {number} role @param {boolean} [withPosition] */
  #announceTent(role, withPosition = false) {
    if (this.#live == null) return
    const spec = store.spec.peek()
    const tent = store.tentOf(spec)
    if (tent == null) return
    this.#live.textContent = this.#tentFormat(spec, tent, role, withPosition).text
  }

  /** Chip payload for warp handle `role` ∈ {0 = p1, 1 = p2} (R-14): warp
   *  formatter output + the handle's DISPLAYED canvas-px placement — the same
   *  parked / band-anchored geometry the painter draws
   *  (bezierHandlePositions through the #warpBand thread: flat bands display
   *  against curve-math's nominalBand; overshoot y parks at ±HANDLE_INSET).
   *  The chip/ring sit on the visible handle while the VALUES read the
   *  STORED warp coords (formatWarpReadout — display and readout agree, see
   *  the chip module header). @param {PaletteSpec} spec @param {Channel} ch
   *  @param {number} role @param {number} width @param {number} height
   *  @returns {ChipData} */
  #warpReadoutData(spec, ch, role, width, height) {
    const stack = spec.channels[ch]
    const hp = bezierHandlePositions(stack, ch, spec.hue, width, height, this.#warpBand(spec, ch))
    const pos = role === 0 ? hp.p1 : hp.p2
    const p = role === 0 ? stack.bezier.p1 : stack.bezier.p2
    const fmt = formatWarpReadout({ role: WARP_ROLES[role] ?? 'p1', x: p.x, y: p.y })
    return { ...fmt, clamped: false, x: pos.x, y: pos.y, maxX: width }
  }

  /** Mirror a warp handle's readout to the aria-live region (R-14; same
   *  throttle rules as #announce: keyboard nudges only — warp handles have
   *  no announced pointer path and pointer frames never announce). The
   *  announced x/y are the STORED warp coords: under a degenerate (flat)
   *  band the handle DISPLAYS against the nominal centered band at exactly
   *  this stored y (curve-math nominalBand), so announcement and display
   *  agree. @param {number} role 0 = p1 | 1 = p2 */
  #announceWarp(role) {
    if (this.#live == null) return
    const spec = store.spec.peek()
    const ch = store.view.peek().activeChannel
    const p = role === 0 ? spec.channels[ch].bezier.p1 : spec.channels[ch].bezier.p2
    this.#live.textContent = formatWarpReadout({
      role: WARP_ROLES[role] ?? 'p1',
      x: p.x,
      y: p.y,
    }).text
  }

  /** C4-#2: announce a ←/→ selection CHANGE — keyboard users otherwise get
   *  NOTHING until the first nudge (the ring + chip are visual-only). One
   *  text per keypress through the SAME per-role formatters the nudge
   *  announcements use, prefixed with position context:
   *    dots:  'Selected stop 5 of 11 — Lightness Δ identity, Lr 0.500'
   *    H:     'Selected: Hue · dark end Δ +0.0°, = 235.0°'
   *    tent:  'Selected: C · peak, C 0.100'
   *    warp:  'Selected: Warp · handle 1 — x 0.33, y 0.33'
   *  Throttle discipline unchanged: selection change + nudges announce;
   *  pointer frames never do. `tent`/`warpBase`/`warpN` come from the
   *  caller's #cycleShape so the role decode matches the live cycle exactly.
   *  @param {PaletteSpec} spec @param {Channel} ch
   *  @param {TentParams | null} tent @param {number} warpBase
   *  @param {number} warpN @param {number} index */
  #announceSelection(spec, ch, tent, warpBase, warpN, index) {
    if (this.#live == null) return
    if (warpN > 0 && index >= warpBase && index < warpBase + 2) {
      const role = index - warpBase
      const p = role === 0 ? spec.channels[ch].bezier.p1 : spec.channels[ch].bezier.p2
      const fmt = formatWarpReadout({ role: WARP_ROLES[role] ?? 'p1', x: p.x, y: p.y })
      this.#live.textContent = `Selected: ${fmt.text}`
      return
    }
    if (ch === 'H') {
      if (index < 0 || index >= 3) return
      const { dark, light } = store.hueDriftOf(spec)
      const fmt = formatHueReadout({
        role: HUE_ROLES[index] ?? 'center',
        hue: spec.hue,
        offset: index === 0 ? dark : light,
      })
      this.#live.textContent = `Selected: ${fmt.text}`
      return
    }
    if (tent != null && index >= spec.count && index < spec.count + 3) {
      this.#live.textContent = `Selected: ${this.#tentFormat(spec, tent, index - spec.count).text}`
      return
    }
    if (index < 0 || index >= spec.count) return
    const stop = this.#resolveStop(spec, store.palette.peek(), ch, index)
    if (stop == null) return // count/palette mismatch — transient, skip silently
    const fmt = formatReadout({
      channel: ch,
      op: spec.channels[ch].op,
      delta: spec.channels[ch].overrides[index] ?? null,
      value: stop.value,
      clamped: stop.clamped,
      clampDelta: stop.clampDelta,
      gamutLabel: spec.displayGamut === 'p3' ? 'P3' : 'sRGB',
    })
    this.#live.textContent = `Selected stop ${index + 1} of ${spec.count} — ${fmt.text}`
  }

  /** Mirror the readout to the aria-live region (M4.5). Called from drag END
   *  and keyboard nudges ONLY — never per pointermove frame (throttle rule).
   *  @param {Channel} ch @param {number} i */
  #announce(ch, i) {
    if (this.#live == null) return
    const spec = store.spec.peek()
    const stop = this.#resolveStop(spec, store.palette.peek(), ch, i)
    if (stop == null) return
    const fmt = formatReadout({
      channel: ch,
      op: spec.channels[ch].op,
      delta: spec.channels[ch].overrides[i] ?? null,
      value: stop.value,
      clamped: stop.clamped,
      clampDelta: stop.clampDelta,
      gamutLabel: spec.displayGamut === 'p3' ? 'P3' : 'sRGB',
    })
    this.#live.textContent = `Stop ${i + 1} of ${spec.count}: ${fmt.text}`
  }

  // ── paint (M4.1/M4.2/M4.8 — the rendering core) ─────────────────────────────

  /** Cached capLUT — rebuilt ONLY when hue/gamut/L-stack/H-stack change.
   *  @param {PaletteSpec} spec */
  #capLut(spec) {
    const c = this.#lutCache
    if (
      c != null &&
      c.hue === spec.hue &&
      c.gamut === spec.displayGamut &&
      c.L === spec.channels.L &&
      c.H === spec.channels.H
    ) {
      return c.lut
    }
    const lut = capLUT(spec, SAMPLES)
    this.#lutCache = {
      hue: spec.hue,
      gamut: spec.displayGamut,
      L: spec.channels.L,
      H: spec.channels.H,
      lut,
    }
    return lut
  }

  /** The active channel's warp band — the [bandMin, bandMax] the engine's
   *  D-23 value-warp normalizes against (engine `warpBand`; deferred D-21 #9,
   *  owner QA 2026-06-10). Drives the band-anchored Bézier tether geometry
   *  for BOTH paint (`bezierHandlePositions(..., band)`) and the drag inverse
   *  (#dragHandleTo) — one mapping, symmetric round-trip.
   *  For C (bounds.max === 'gamut') warpBand's resolveMax needs a resolved
   *  cap, so we thread the cached capLUT's MAXIMUM: exact for the
   *  cap-independent families (the default sine bell and the tent read their
   *  band off their own params — engine baseBand) and the display-true
   *  ceiling for the gamut-tracking fallback families (gamut-max /
   *  cusp-anchored, whose per-t band has no single closed form). Zero peakC
   *  calls — the LUT is the painter's existing cache.
   *  @param {PaletteSpec} spec @param {Channel} ch
   *  @returns {{ min: number, max: number }} */
  #warpBand(spec, ch) {
    const stack = spec.channels[ch]
    /** @type {import('@curve-ramp/curve-engine').SampleCtx} */
    const ctx = { t: 0, hue: spec.hue, gamut: spec.displayGamut }
    if (stack.bounds.max === 'gamut') {
      const lut = this.#capLut(spec)
      let cap = -Infinity
      for (let i = 0; i < lut.length; i++) cap = Math.max(cap, /** @type {number} */ (lut[i]))
      ctx.cap = cap
    }
    const [min, max] = warpBand(stack, ctx)
    return { min, max }
  }

  /** D-22: the H channel's THREE parameter handles in canvas coords. The END
   *  handles (roles 0 dark / 2 light) ride the live base⊗bézier curve's
   *  endpoints (the D-23 warp band pins t=0/t=1 at hue+Δdark / hue+Δlight
   *  exactly, under any warp). The CENTER (role 1) anchors at its SEMANTIC
   *  value — hue + (Δdark+Δlight)/2, the translation anchor it writes — NOT
   *  the warped t=0.5 curve sample (D-23: a Bézier drag must not move it).
   *  Under a strong warp it may visually detach from the curve; intended —
   *  it is the move-everything anchor, not a curve sample. Published as
   *  `layout.dots` so the hitTest/grab machinery works unchanged; `i` is the
   *  HANDLE ROLE (0|1|2), not a stop index. @param {PaletteSpec} spec
   *  @param {number} width @param {number} height @returns {Dot[]} */
  #hueHandleDots(spec, width, height) {
    const { hue, displayGamut: gamut } = spec
    const stack = spec.channels.H
    const { dark, light } = store.hueDriftOf(spec)
    return [0, 0.5, 1].map((t, i) => {
      const value = i === 1 ? hue + (dark + light) / 2 : baseBezier(stack, { t, hue, gamut })
      return { i, x: tToX(t, width), y: valueToY('H', value, hue, height), value, clamped: false }
    })
  }

  /** D-24: the C tent base's three control handles in canvas coords.
   *  PEAK sits at the BASE's ask (peakT, peakC) — when the spec asks more
   *  chroma than the gamut affords it sits ABOVE the dashed cap line
   *  (deliberate: the base layer is the editable truth, the cap the live
   *  constraint). LOW/HIGH map the segment-local flank coords to absolute:
   *    low   t = low.x·peakT               value = min + low.y·(peakC − min)
   *    high  t = peakT + high.x·(1−peakT)  value = peakC − high.y·(peakC − min)
   *  They are quadratic-Bézier CONTROL points — near but NOT ON the curve
   *  (a quadratic interpolates its endpoints, not its middle control point);
   *  correct and intended. Display y PARKS inside the canvas (±HANDLE_INSET,
   *  the curve-math bezierHandlePositions precedent): peakC may exceed the C
   *  display viewport (Y_RANGES max 0.4) and an off-canvas handle would be
   *  invisible AND ungrabbable. The drag math inverts the POINTER, never the
   *  parked pixel, so parking cannot corrupt a value (D-23 grab-offset is
   *  measured against the parked position, same as bézier handles).
   *  @param {PaletteSpec} spec @param {TentParams} tent @param {number} width
   *  @param {number} height @returns {TentLayout} */
  #tentLayout(spec, tent, width, height) {
    const { hue } = spec
    const min = spec.channels.C.bounds.min
    const span = tent.peakC - min
    const park = (/** @type {number} */ y) =>
      Math.min(height - HANDLE_INSET, Math.max(HANDLE_INSET, y))
    const at = (/** @type {number} */ t, /** @type {number} */ v) => ({
      x: tToX(t, width),
      y: park(valueToY('C', v, hue, height)),
    })
    return {
      peak: at(tent.peakT, tent.peakC),
      low: at(tent.low.x * tent.peakT, min + tent.low.y * span),
      high: at(tent.peakT + tent.high.x * (1 - tent.peakT), tent.peakC - tent.high.y * span),
    }
  }

  /** @param {HTMLCanvasElement} canvas */
  #paint(canvas) {
    // Tracked reads — any of these changing schedules the next frame's paint.
    const spec = store.spec.value
    const view = store.view.value
    const palette = store.palette.value
    const { w, h } = this.#size.value
    const selected = this.#selected.value // M4.5 keyboard ring
    void this.#themeEpoch.value // C1-#1: theme flips re-resolve the token colors below

    const ctx = (this.#ctx ??= CrCurveCanvas._ctxFactory(canvas))
    if (ctx == null) return // no 2D context on this host — nothing to paint

    const width = w || FALLBACK_W
    const height = h || FALLBACK_H
    const dpr = globalThis.devicePixelRatio || 1
    const { hue, count } = spec
    const active = view.activeChannel

    // Token resolution: ONCE per paint, cached in this frame-local record.
    // Plain color strings pass through; light-dark()/var() chains resolve via
    // the #colorProbe (see its declaration for why — M6.3 finding).
    const cs = getComputedStyle(this)
    const tok = (/** @type {string} */ name, /** @type {string} */ fallback) => {
      const raw = cs.getPropertyValue(name).trim()
      if (!raw) return fallback
      if (!raw.includes('light-dark(') && !raw.includes('var(')) return raw
      if (!this.#colorProbe) {
        const p = document.createElement('span')
        p.hidden = true
        p.setAttribute('aria-hidden', 'true')
        this.append(p)
        this.#colorProbe = p
      }
      this.#colorProbe.style.color = `var(${name}, ${fallback})`
      return getComputedStyle(this.#colorProbe).color || fallback
    }
    const colors = {
      L: tok('--curve-l', 'red'),
      C: tok('--curve-c', 'gold'),
      H: tok('--curve-h', 'green'),
      grid: tok('--color-surface-raised', 'gray'),
      warning: tok('--color-warning', 'orange'),
      accent: tok('--color-accent', 'royalblue'),
      muted: tok('--color-text-muted', 'gray'), // D-24 cusp marker
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0) // all math below in CSS px
    ctx.clearRect(0, 0, width, height)

    // ── grid: a vertical line per stop + horizontal quarters (subtle) ──────
    ctx.globalAlpha = 1
    ctx.strokeStyle = colors.grid
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = 0; i < count; i++) {
      const x = tToX(i / (count - 1), width)
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
    }
    for (let r = 0; r <= 4; r++) {
      // quarters of the PADDED plot area (D-21 #14) — aligned with the value
      // viewport so the r=0/4 lines sit under the range-extreme dots.
      const y = V_PAD + ((height - 2 * V_PAD) * r) / 4
      ctx.moveTo(PAD, y)
      ctx.lineTo(width - PAD, y)
    }
    ctx.stroke()

    // ── channel curves: overlay = all three (inactive first, dimmed), ──────
    //    single (M4.8) = active only.
    const lut = this.#capLut(spec)
    const drawn =
      view.canvasMode === 'single' ? [active] : [...CHANNELS.filter((c) => c !== active), active]
    /** @type {Partial<Record<Channel, Pt[]>>} */
    const polylines = {}
    for (const ch of drawn) {
      const values = sampleCurve(spec.channels[ch], ch, spec, SAMPLES, ch === 'C' ? lut : undefined)
      ctx.globalAlpha = ch === active ? 1 : DIM_ALPHA
      ctx.strokeStyle = colors[ch]
      ctx.lineWidth = 2
      ctx.beginPath()
      /** @type {Pt[]} */
      const line = []
      for (let i = 0; i < SAMPLES; i++) {
        const x = tToX(i / (SAMPLES - 1), width)
        const y = valueToY(ch, values[i], hue, height)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
        if (i % DOWNSAMPLE === 0 || i === SAMPLES - 1) line.push({ x, y })
      }
      ctx.stroke()
      polylines[ch] = line
    }

    // ── C gamut cap line (dashed, LUT-backed) wherever C is visible ────────
    if (drawn.includes('C')) {
      ctx.save()
      ctx.setLineDash([4, 4])
      ctx.globalAlpha = active === 'C' ? 0.6 : 0.3
      ctx.strokeStyle = colors.C
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let i = 0; i < SAMPLES; i++) {
        const x = tToX(i / (SAMPLES - 1), width)
        const y = valueToY('C', lut[i], hue, height)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
      ctx.restore()
    }

    // ── active channel: Bézier polygon + handles, then the N dots ──────────
    // N=2 empty state: endpoints only, no handles (the warp cannot affect a
    // two-stop ramp — easing pins (0,0)/(1,1) — so there is nothing to tune).
    const empty = count === 2
    // D-21 #9 (post-D-23): the tether renders over the WARP BAND — its
    // endpoints land on the active curve's real ends (L/H monotone bases) or
    // [min, peakC] (C tents/bells), not the plot's unit corners.
    const handles = empty
      ? null
      : bezierHandlePositions(
          spec.channels[active],
          active,
          hue,
          width,
          height,
          this.#warpBand(spec, active),
        )
    // D-24: the C tent base's three parameter handles — IN ADDITION to the N
    // stop dots (C keeps its per-stop A3/A5 affordance; contrast D-22's H,
    // which replaces them). Suppressed with the bézier handles in the N=2
    // empty state: both stops sit at bounds.min, nothing the peak can move.
    const tent = !empty && active === 'C' ? store.tentOf(spec) : null
    const tentLayout = tent == null ? null : this.#tentLayout(spec, tent, width, height)
    if (handles != null) {
      ctx.globalAlpha = 0.8
      ctx.strokeStyle = colors.accent
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(handles.start.x, handles.start.y)
      ctx.lineTo(handles.p1.x, handles.p1.y)
      ctx.moveTo(handles.end.x, handles.end.y)
      ctx.lineTo(handles.p2.x, handles.p2.y)
      ctx.stroke()
      ctx.fillStyle = colors.accent
      for (const p of [handles.p1, handles.p2]) {
        ctx.beginPath()
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // D-22: H renders 3 PARAMETER handles instead of the N per-stop dots
    // (per-stop H overrides still shape the palette but get no affordance).
    const dots =
      active === 'H'
        ? this.#hueHandleDots(spec, width, height)
        : dotPositions(palette, spec, active, width, height)
    ctx.globalAlpha = 1
    for (const d of dots) {
      ctx.beginPath()
      // The H center handle reads slightly larger — it moves everything.
      const r = active === 'H' && d.i === 1 ? HUE_CENTER_RADIUS : DOT_RADIUS
      ctx.arc(d.x, d.y, r, 0, Math.PI * 2)
      ctx.fillStyle = d.clamped ? colors.warning : colors[active]
      ctx.fill()
      if (d.clamped) {
        // Owner QA 2026-06-10: a clamped dot ALSO gets a warning ring — the
        // SPEC §10 'point at gamut limit' flag must survive any fill/channel
        // palette proximity (the retuned --color-warning handles hue
        // distance; the ring is the shape-level backstop).
        ctx.strokeStyle = colors.warning
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(d.x, d.y, r + 2.5, 0, Math.PI * 2)
        ctx.stroke()
      }
    }

    // ── D-24: tent parameter handles + cusp marker (above the dots) ────────
    if (tentLayout != null) {
      // Cusp marker: a small muted diamond ON the cap line at cuspInfo().t —
      // the hue's most-chroma-headroom position. A landmark, not a control:
      // no hover, no chip, no title (canvas pixels carry no title anyway);
      // the picker's 'Peak at cusp' preset is the actionable affordance.
      const info = store.cuspInfo()
      const cx = tToX(info.t, width)
      const cy = valueToY('C', info.C, hue, height)
      ctx.save()
      ctx.globalAlpha = 0.9
      ctx.fillStyle = colors.muted
      ctx.beginPath()
      ctx.moveTo(cx, cy - 4)
      ctx.lineTo(cx + 4, cy)
      ctx.lineTo(cx, cy + 4)
      ctx.lineTo(cx - 4, cy)
      ctx.closePath()
      ctx.fill()
      ctx.restore()

      // Flank shapers: hollow stroked circles (control points — near but NOT
      // ON the curve; see #tentLayout).
      ctx.globalAlpha = 1
      ctx.strokeStyle = colors.C
      ctx.lineWidth = 2
      for (const p of [tentLayout.low, tentLayout.high]) {
        ctx.beginPath()
        ctx.arc(p.x, p.y, TENT_FLANK_RADIUS, 0, Math.PI * 2)
        ctx.stroke()
      }
      // Peak: filled in the channel color + an outer ring, so it reads as a
      // parameter handle rather than one of the r=4.5 stop dots. It may sit
      // ABOVE the dashed cap line — the base's ask, not the clamped value.
      ctx.fillStyle = colors.C
      ctx.beginPath()
      ctx.arc(tentLayout.peak.x, tentLayout.peak.y, TENT_PEAK_RADIUS, 0, Math.PI * 2)
      ctx.fill()
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(tentLayout.peak.x, tentLayout.peak.y, TENT_PEAK_RADIUS + 2.5, 0, Math.PI * 2)
      ctx.stroke()
    }

    // ── keyboard selection ring (M4.5 — visible selection, SPEC §10) ───────
    if (selected != null) {
      /** @type {Pt | null} */
      let ringAt = null
      let ringR = 7.5
      const d = dots.find((dot) => dot.i === selected)
      if (d != null) {
        ringAt = d
      } else if (tentLayout != null && selected >= count && selected < count + 3) {
        // D-24: tent handles extend the C cycle past the N dots; the peak's
        // ring sits outside its own decoration ring.
        ringAt = [tentLayout.peak, tentLayout.low, tentLayout.high][selected - count] ?? null
        if (selected === count) ringR = TENT_PEAK_RADIUS + 4.5
      } else if (handles != null) {
        // R-14: the warp handles close every cycle — the ring paints at the
        // DISPLAYED (parked / band-anchored) handle position, exactly where
        // the accent dot renders.
        const warpBase = active === 'H' ? 3 : count + (tentLayout != null ? 3 : 0)
        if (selected === warpBase) ringAt = handles.p1
        else if (selected === warpBase + 1) ringAt = handles.p2
      }
      if (ringAt != null) {
        ctx.globalAlpha = 1
        ctx.strokeStyle = colors.accent
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(ringAt.x, ringAt.y, ringR, 0, Math.PI * 2)
        ctx.stroke()
      }
    }

    // ── publish this frame's geometry for the interaction layer ────────────
    this.layout = {
      width,
      height,
      activeChannel: active,
      dots,
      handles,
      curvePolylines: polylines,
      tent: tentLayout,
    }
  }
}

customElements.define('cr-curve-canvas', CrCurveCanvas)
