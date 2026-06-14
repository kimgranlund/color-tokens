/**
 * <cr-export-panel> — format + gamut toggles, copy, APCA readout (PLAN §3.4,
 * M5.1/M5.3; SPEC §10 *export open*: "format toggle (OKLCH / CSS / hex /
 * tokens), gamut toggle (sRGB / P3), copy-to-clipboard with explicit
 * success/failure feedback (don't swallow clipboard errors)").
 *
 * Gamut toggle (D-14): the sRGB/P3 radios WRITE `spec.displayGamut` via
 * `store.setGamut` — the one source of truth. `generate` re-clamps C, the
 * strip's OOG badges, the canvas cap line, and every export re-derive from
 * that single field; this panel only reflects `spec.value.displayGamut` back
 * into the radios. Hex is the exception: it has no P3 form, so its option is
 * labeled "sRGB" and a note appears while the display gamut is P3.
 *
 * Idle scheduling (PLAN Δ4/D-9): the export text AND the APCA matrix are
 * built in ONE `this.effectIdle` pass — they never recompute mid-drag (the
 * idle scheduler drains after microtask + rAF work; a write during a drag
 * frame schedules the NEXT idle, never the current one). `effectIdle` is the
 * SCOPED instance method (base R-13, shipped Wave-1 T2; adopted here per
 * T2's finding): scope-registered like every binding — disposed on
 * disconnect, re-created by the next `connected()` — replacing the hand-held
 * module-level-import + `#idleDispose` pattern this component used to carry.
 * First paint consequence: [data-export-output] is EMPTY until the first
 * idle callback — by design, not a bug.
 *
 * APCA surface (M5.3; SPEC §7 honesty): a <details data-apca> holds the N×N
 * `apcaMatrix` table — rows are foregrounds, columns backgrounds, headers the
 * swatch keys. Every label says "APCA-verified"; readouts are informational
 * ONLY (SPEC §9.2: not an auditor, no pass/fail gate) and no WCAG-3
 * compliance claim exists anywhere (AC A10 greps the repo for it).
 *
 * Copy (SPEC §10, TS K1/K2 lesson): navigator.clipboard.writeText in
 * try/catch → [data-copy-status] (role=status, aria-live=polite) shows
 * "Copied ✓" or "Copy failed — select the text manually"; the status clears
 * after ~3 s and the timer is cleaned up on disconnect (cr-toast pattern).
 *
 * Styles consume SEMANTIC tokens only (token gate T3, PLAN §3.3).
 */
import { UIElement, html, css, signal } from '@curve-ramp/base'
import { toOklchJson, toCssVars, toHex, toTokens, toCssVarsSet, toSemanticTokens, toFigmaTokens, apcaMatrix, apcaTier } from '@curve-ramp/curve-engine'
import * as store from '../store.js'
import { zipStore } from '../zip.js'

/** @typedef {import('@curve-ramp/curve-engine').Palette} Palette */
/** @typedef {'oklch' | 'css' | 'hex' | 'tokens' | 'full' | 'semantic' | 'figma'} ExportFormat */

/** Download filename + MIME per format (v0.7 download button). @type {Record<ExportFormat, { file: string, mime: string }>} */
const DOWNLOAD_INFO = {
  oklch: { file: 'palette.json', mime: 'application/json' },
  css: { file: 'palette.css', mime: 'text/css' },
  hex: { file: 'palette.txt', mime: 'text/plain' },
  tokens: { file: 'palette.tokens.json', mime: 'application/json' },
  full: { file: 'palette.css', mime: 'text/css' },
  semantic: { file: 'semantic.css', mime: 'text/css' },
  figma: { file: 'Light.tokens.json', mime: 'application/json' }, // Figma exports a PAIR — see the download handler
}

const STATUS_CLEAR_MS = 3000

/** Render the export text for a format. `toCssVars(p)` reads
 *  `p.spec.displayGamut` for its default gamut — the D-14 single source —
 *  so no gamut plumbing happens here. `cssOpts` carries the D-32 family/scrims
 *  (CSS-vars only). @param {Palette} p @param {ExportFormat} fmt
 *  @param {{ family?: string, scrims?: { anchors: number[], levels: number[] } }} [cssOpts]
 *  @returns {string} */
function renderExport(p, fmt, cssOpts) {
  switch (fmt) {
    case 'css':
      return toCssVars(p, cssOpts)
    case 'hex':
      return toHex(p).join('\n') // sRGB only — hex has no P3 form (D-14)
    case 'tokens':
      return JSON.stringify(toTokens(p), null, 2) // experimental DTCG 2025.10 (D-6)
    default:
      return toOklchJson(p)
  }
}

/** |Lc| band for cell coloring (matches apcaTier's 75/60 thresholds).
 *  @param {number} lc @returns {'body' | 'large' | 'below'} */
const tierBand = (lc) => (Math.abs(lc) >= 75 ? 'body' : Math.abs(lc) >= 60 ? 'large' : 'below')

/** Build the N×N APCA table's inner HTML. Safe as direct innerHTML: every
 *  interpolated value is engine-generated (keys are '\d{3}' strings from
 *  keys.ts, Lc values are numbers, tiers come from a closed set) — the
 *  escaping `html` tag would mangle the markup for no safety gain.
 *  @param {Palette} p @returns {string} */
function apcaTableHtml(p) {
  const keys = p.swatches.map((s) => s.key)
  const m = apcaMatrix(p) // [fg][bg], signed Lc on concrete Y (SPEC §7/§12)
  const head = `<tr><th scope="col">fg \\ bg</th>${keys
    .map((k) => `<th scope="col">${k}</th>`)
    .join('')}</tr>`
  const rows = m
    .map((row, i) => {
      const cells = row
        .map((lc, j) => {
          const title = `Lc ${lc.toFixed(1)} — ${apcaTier(lc)}`
          return `<td data-apca-cell data-fg="${keys[i]}" data-bg="${keys[j]}" data-tier="${tierBand(lc)}" title="${title}">${lc.toFixed(0)}</td>`
        })
        .join('')
      return `<tr><th scope="row">${keys[i]}</th>${cells}</tr>`
    })
    .join('')
  return `<caption>APCA L<sup>c</sup> — row swatch as text on column swatch as background</caption><thead>${head}</thead><tbody>${rows}</tbody>`
}

let headingUid = 0

export class CrExportPanel extends UIElement {
  static template = () => html`
    <h3 data-export-heading>Export</h3>
    <div data-controls>
      <fieldset data-format>
        <legend>Format</legend>
        <label><input type="radio" name="format" value="oklch" checked><span>OKLCH JSON</span></label>
        <label><input type="radio" name="format" value="css"><span>CSS vars</span></label>
        <label><input type="radio" name="format" value="hex"><span>Hex (sRGB)</span></label>
        <label><input type="radio" name="format" value="tokens"><span>DTCG tokens (experimental)</span></label>
        <label><input type="radio" name="format" value="full"><span>Full palette (all families)</span></label>
        <label><input type="radio" name="format" value="semantic"><span>Semantic tokens (M3 roles)</span></label>
        <label><input type="radio" name="format" value="figma"><span>Figma variables (Light + Dark)</span></label>
      </fieldset>
      <fieldset data-gamut>
        <legend>Gamut</legend>
        <label><input type="radio" name="gamut" value="srgb"><span>sRGB</span></label>
        <label><input type="radio" name="gamut" value="p3"><span>P3</span></label>
      </fieldset>
      <fieldset data-css-opts>
        <legend>CSS vars (D-32)</legend>
        <label><span>Family</span><input name="family" type="text" placeholder="(none)" autocomplete="off" spellcheck="false"></label>
        <span data-scrim-note>Scrims (250/500/750 @ 10/17.5/25%) always included</span>
      </fieldset>
      <div data-copy-row>
        <button type="button" class="cr-btn" data-copy>Copy</button>
        <button type="button" class="cr-btn" data-download>Download</button>
        <span data-copy-status role="status" aria-live="polite"></span>
      </div>
    </div>
    <p data-hex-note hidden>Hex stays sRGB — hex has no P3 form (the other formats follow the P3 toggle).</p>
    <pre data-export-output></pre>
    <details data-apca>
      <summary>Contrast (APCA-verified — informational)</summary>
      <div data-apca-scroll>
        <table data-apca-table></table>
      </div>
      <p data-apca-footnote>APCA-verified readouts are informational only.</p>
    </details>
  `

  static styles = css`
    cr-export-panel {
      display: grid;
      gap: var(--space-3);
    }
    cr-export-panel [data-export-heading] {
      margin: 0;
      font-size: var(--text-sm);
      font-weight: normal;
      color: var(--color-text-muted);
    }
    cr-export-panel [data-controls] {
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      gap: var(--space-5);
    }
    cr-export-panel fieldset {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-3);
      margin: 0;
      padding: 0;
      border: 0;
    }
    cr-export-panel legend {
      padding: 0;
      margin-block-end: var(--space-1);
      font-size: var(--text-sm);
      color: var(--color-text-muted);
    }
    cr-export-panel fieldset label {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      font-size: var(--text-sm);
      color: var(--color-text);
      cursor: pointer;
    }
    cr-export-panel input[type='radio'],
    cr-export-panel input[type='checkbox'] {
      accent-color: var(--color-accent);
    }
    cr-export-panel [data-copy-row] {
      display: flex;
      align-items: center;
      gap: var(--space-3);
    }
    cr-export-panel [data-copy] {
      padding: var(--space-1) var(--space-3);
      background: transparent;
      color: var(--color-text);
      border: 1px solid var(--color-text-muted);
      border-radius: var(--radius-2);
      font-size: var(--text-sm);
      cursor: pointer;
    }
    cr-export-panel [data-copy-status] {
      font-size: var(--text-sm);
      color: var(--color-text-muted);
    }
    cr-export-panel [data-hex-note] {
      margin: 0;
      font-size: var(--text-sm);
      color: var(--color-text-muted);
    }
    cr-export-panel [data-export-output] {
      margin: 0;
      padding: var(--space-3);
      max-block-size: calc(var(--space-8) * 8);
      overflow: auto;
      background: var(--color-surface-raised);
      color: var(--color-text);
      border-radius: var(--radius-2);
      font-size: var(--text-xs);
    }
    cr-export-panel [data-apca] summary {
      font-size: var(--text-sm);
      color: var(--color-text);
      cursor: pointer;
    }
    cr-export-panel [data-apca-scroll] {
      overflow-x: auto;
      margin-block: var(--space-3);
    }
    cr-export-panel [data-apca-table] {
      border-collapse: collapse;
      font-size: var(--text-xs);
      font-variant-numeric: tabular-nums;
    }
    cr-export-panel [data-apca-table] caption {
      margin-block-end: var(--space-2);
      text-align: start;
      color: var(--color-text-muted);
    }
    cr-export-panel [data-apca-table] th,
    cr-export-panel [data-apca-table] td {
      padding: var(--space-1) var(--space-2);
      text-align: end;
      border: 1px solid var(--color-surface-raised);
    }
    cr-export-panel [data-apca-table] th {
      font-weight: normal;
      color: var(--color-text-muted);
    }
    /* |Lc| bands — semantic tokens only (T3): the readable pairs stand out,
       the below-threshold mass recedes. Informational shading, not a gate. */
    cr-export-panel [data-apca-cell][data-tier='body'] {
      background: var(--color-surface-raised);
      color: var(--color-text);
      font-weight: 600;
    }
    cr-export-panel [data-apca-cell][data-tier='large'] {
      color: var(--color-text);
    }
    cr-export-panel [data-apca-cell][data-tier='below'] {
      color: var(--color-text-muted);
    }
    cr-export-panel [data-apca-footnote] {
      margin: 0;
      font-size: var(--text-xs);
      color: var(--color-text-muted);
    }
  `

  /** Selected export format — ephemeral view state, local to the panel
   *  (never persisted; SPEC §11 keeps PaletteSpec output-format-free). */
  #format = signal(/** @type {ExportFormat} */ ('oklch'))

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  #statusTimer

  connected() {
    const heading = /** @type {HTMLElement} */ (this.first('[data-export-heading]'))
    const output = /** @type {HTMLElement} */ (this.first('[data-export-output]'))
    const table = /** @type {HTMLElement} */ (this.first('[data-apca-table]'))
    const status = /** @type {HTMLElement} */ (this.first('[data-copy-status]'))
    const copy = /** @type {HTMLButtonElement} */ (this.first('[data-copy]'))
    const download = /** @type {HTMLButtonElement} */ (this.first('[data-download]'))
    const hexNote = /** @type {HTMLElement} */ (this.first('[data-hex-note]'))

    // a11y: labeled group, heading as accessible name (cr-base-picker pattern).
    if (!heading.id) heading.id = `cr-export-panel-heading-${headingUid++}`
    this.setAttribute('role', 'group')
    this.setAttribute('aria-labelledby', heading.id)

    // ── Format radios — drive the local #format signal ──────────────────────
    for (const radio of /** @type {HTMLInputElement[]} */ (this.all('input[name="format"]'))) {
      this.bindProp(radio, 'checked', () => this.#format.value === radio.value)
      this.on(radio, 'change', () => {
        if (radio.checked) this.#format.value = /** @type {ExportFormat} */ (radio.value)
      })
    }

    // ── Gamut radios — write spec.displayGamut (D-14 single source); the
    // checked state REFLECTS the spec, so external changes (URL load, tests)
    // re-bind the radios too.
    for (const radio of /** @type {HTMLInputElement[]} */ (this.all('input[name="gamut"]'))) {
      this.bindProp(radio, 'checked', () => store.spec.value.displayGamut === radio.value)
      this.on(radio, 'change', () => {
        if (radio.checked) store.setGamut(/** @type {'srgb' | 'p3'} */ (radio.value))
      })
    }
    this.bindAttr(hexNote, 'hidden', () => store.spec.value.displayGamut !== 'p3')

    // ── CSS-vars family (D-32) — UI-only export config; scrims are always on ──
    const family = /** @type {HTMLInputElement} */ (this.first('input[name="family"]'))
    this.bindProp(family, 'value', () => store.exportFamily.value)
    this.on(family, 'input', () => store.setExportFamily(family.value))
    // CSS-opts matter for the CSS-vars + Full-palette formats — dim otherwise.
    // (The Family field is used by CSS-vars only — Full palette names families
    // from the set; scrims are always included in both — v0.7.)
    const cssOptsBox = /** @type {HTMLElement} */ (this.first('[data-css-opts]'))
    this.bindAttr(cssOptsBox, 'data-inactive', () => String(this.#format.value !== 'css' && this.#format.value !== 'full'))

    // ── ONE idle pass builds export text + APCA matrix (PLAN Δ4/M5.3) ───────
    // Tracked reads: palette (recomputes on any committed spec change), the
    // format signal, and the D-32 export config. Mid-drag palette churn
    // coalesces into a single idle run. Scoped (base R-13): auto-labeled
    // 'cr-export-panel.effectIdle', disposed on disconnect, re-created by the
    // next connected() — no hand-held disposer.
    this.effectIdle(() => {
      const p = store.palette.value
      const fmt = this.#format.value
      if (fmt === 'full') {
        // Full multi-family palette (D-33). Scrims (D-32 — the 250/500/750 @
        // 10/17.5/25% the owner emphasized) are passed through; toCssVarsSet
        // auto-filters anchors to the keys each family's scale actually has.
        output.textContent = toCssVarsSet(store.currentSet.value, { scrims: store.exportScrims.value })
      } else if (fmt === 'semantic') {
        // M3-style semantic role tokens aliasing the raw family tokens (D-35).
        // Emits light-dark(light, dark) per role — one output covers both schemes.
        output.textContent = toSemanticTokens(store.currentSet.value)
      } else if (fmt === 'figma') {
        // Figma variable import (D-42): a PAIR of mode files. The preview shows the
        // Light file; the download writes both Light.tokens.json + Dark.tokens.json.
        output.textContent = JSON.stringify(toFigmaTokens(store.currentSet.value).light, null, 2)
      } else {
        const fam = store.exportFamily.value
        /** @type {{ family?: string, scrims?: { anchors: number[], levels: number[] } }} */
        const cssOpts = {}
        if (fam) cssOpts.family = fam
        if (store.exportScrims.value && store.scrimAnchors.value.length) {
          cssOpts.scrims = { anchors: store.scrimAnchors.value, levels: [0.1, 0.175, 0.25] }
        }
        output.textContent = renderExport(p, fmt, cssOpts)
      }
      table.innerHTML = apcaTableHtml(p)
    })

    // ── Copy — explicit success/failure, never swallowed (SPEC §10) ─────────
    this.on(copy, 'click', async () => {
      const text = output.textContent ?? ''
      let message
      try {
        await navigator.clipboard.writeText(text)
        message = 'Copied ✓'
      } catch {
        // Permission denied, insecure context, no clipboard API — all land
        // here; the user gets a path forward instead of silence.
        message = 'Copy failed — select the text manually'
      }
      status.textContent = message
      clearTimeout(this.#statusTimer)
      this.#statusTimer = setTimeout(() => {
        status.textContent = ''
        this.#statusTimer = undefined
      }, STATUS_CLEAR_MS)
    })

    // ── Download — current output as a file, extension per format (v0.7) ─────
    /** @param {string} file @param {Blob} blob */
    const saveFile = (file, blob) => {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = file
      a.click()
      // Revoke AFTER the download has started — an immediate revoke can cancel it.
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
    this.on(download, 'click', () => {
      let downloaded
      if (this.#format.value === 'figma') {
        // Figma wants a file per MODE (D-42); deliver BOTH in one .zip — two rapid
        // <a download> clicks get blocked / prompt for "multiple files" (D-42 follow-up).
        const { light, dark } = toFigmaTokens(store.currentSet.peek())
        saveFile(
          'figma-tokens.zip',
          zipStore([
            { name: 'Light.tokens.json', text: JSON.stringify(light, null, 2) },
            { name: 'Dark.tokens.json', text: JSON.stringify(dark, null, 2) },
          ]),
        )
        downloaded = 'figma-tokens.zip (Light + Dark)'
      } else {
        const info = DOWNLOAD_INFO[this.#format.value]
        saveFile(info.file, new Blob([output.textContent ?? ''], { type: info.mime }))
        downloaded = info.file
      }
      status.textContent = `Downloaded ${downloaded}`
      clearTimeout(this.#statusTimer)
      this.#statusTimer = setTimeout(() => {
        status.textContent = ''
        this.#statusTimer = undefined
      }, STATUS_CLEAR_MS)
    })
  }

  disconnected() {
    // The idle effect is scope-registered (this.effectIdle) — the scope tears
    // it down; only the manual timer needs hand cleanup here.
    clearTimeout(this.#statusTimer) // disposal contract: no orphan timer fires after disconnect
    this.#statusTimer = undefined
  }
}

customElements.define('cr-export-panel', CrExportPanel)
