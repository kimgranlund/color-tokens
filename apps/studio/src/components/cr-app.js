/**
 * <cr-app> — studio shell/layout (PLAN §3.4, M3.2; SPEC §10 *error state*).
 *
 * Owns the page scaffold: header (title + a gamut-note slot the M5 export
 * panel will populate), the main grid (seed controls, an empty M4 canvas
 * slot, ramp strip), the toast outlet, and the inline error region bound to
 * the store's `lastError` signal. Per D-20a the store is an ESM module
 * singleton — invalid edits never enter `spec`; they land in `lastError`
 * and are surfaced here (`role="alert"`), never thrown at the user.
 *
 * D-21 council #5 (error-surface fixes):
 * - NO DOUBLE DISPLAY: the global banner suppresses an error the
 *   field-adjacent surface owns — <cr-base-picker>'s inline region filters to
 *   `channels.<active>.base*`, so while `lastError.field` matches THAT prefix
 *   for the CURRENT view.activeChannel the banner stays hidden (the picker is
 *   showing it). Every other error — count/hue/displayGamut/field-less, or a
 *   base error on an INACTIVE channel's tab — shows here, role="alert".
 * - HUMANIZED FIELD PATHS: `channels.L.base.gamma` renders as
 *   'Lightness base · gamma' (CHANNEL_LABELS — single source, imported from
 *   cr-readout-chip per D-21 #13 dedup); the raw path is kept in the chip's
 *   `title` attribute for debuggability.
 *
 * Header affordances (the [data-header-actions] cluster):
 * - UNDO/REDO (R-7): [data-undo]/[data-redo] drive the store's bounded
 *   spec-snapshot history (store.undo/redo), disabled-bound to the frozen
 *   canUndo/canRedo signals; titles carry the shortcuts. A GLOBAL keydown
 *   listener (window, registered via this.on → auto-disposed with the scope)
 *   maps ⌘Z/Ctrl+Z → undo and ⌘⇧Z/Ctrl+Y → redo — GUARDED off while the
 *   event target is an input/select/textarea/contentEditable, so typing
 *   keeps the browser's NATIVE undo (R-7 AC7). Both paths ANNOUNCE the
 *   result ('Undid last edit' / 'Redid last edit'; no-ops say 'Nothing to
 *   undo/redo') via the shared polite status region (C4-#5 — undo was
 *   SR-silent). An undo/redo CLICK that self-disables its button moves focus
 *   to the twin (or, failing that, the copy-link button) — never a
 *   focus dead-end on a disabled control (C4-#6).
 * - COPY LINK (R-8): the hash already round-trips; discoverability was the
 *   gap. [data-copy-link] copies `store.currentShareUrl()` — the CURRENT
 *   spec, synchronously, never the (≤300 ms-stale) location.hash — with the
 *   export panel's explicit success/failure status pattern: a polite
 *   role=status region, ~3 s clear, timer cleaned up on disconnect. On
 *   clipboard failure the hash is synced FIRST (history.replaceState with
 *   the same URL), so the manual fallback — copy the address bar — is
 *   truthful even inside the debounce window.
 * - THEME TOGGLE (R-22): [data-theme-toggle] cycles System → Light → Dark →
 *   System. Mechanism (frozen): `data-theme="light"|"dark"` on <html>,
 *   absent = system — the tokens package's global.css override rule flips
 *   `color-scheme` and every light-dark() pair follows. Ephemeral UI state
 *   (NOT in PaletteSpec): persisted in localStorage 'cr-theme' ('system'
 *   stores nothing — absent key ≡ absent attribute), applied on boot here.
 *   Boot FOUC is pre-empted by index.html's inline head script (C1-#3 /
 *   C2-F10) — THIS element stays the only runtime writer. Each toggle click
 *   announces the NEW state ('Theme: light') through the shared status
 *   region (C1-#6 + C4-#4 — the visual label change was SR-silent).
 *
 * SHARED STATUS REGION: copy-link, theme, and undo/redo all announce through
 * the one [data-copy-link-status] polite region via the `announce` helper
 * (one ~3 s clear timer, last writer wins). C2-F7's extraction threshold (3
 * consumers) is met by the helper — the REGION stays singular by design:
 * simultaneous announcements can't happen (all three are user-initiated,
 * one gesture at a time).
 *
 * Styles consume SEMANTIC tokens only (token gate T3, PLAN §3.3).
 */
import { UIElement, html, css, signal } from '@curve-ramp/base'
import * as store from '../store.js'
import { CHANNEL_LABELS } from './cr-readout-chip.js'

/** @typedef {'system' | 'light' | 'dark'} ThemeChoice */

const COPY_STATUS_CLEAR_MS = 3000 // the export panel's ~3 s status clear
const THEME_KEY = 'cr-theme'
/** Cycle order (R-22). @type {ThemeChoice[]} */
const THEME_CYCLE = ['system', 'light', 'dark']

/** Apply a theme choice to <html> (R-22 frozen mechanism): light/dark set
 *  `data-theme`; 'system' REMOVES the attribute (absent = follow the OS).
 *  @param {ThemeChoice} theme */
function applyTheme(theme) {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', theme)
}

/** The persisted override, or 'system' for an absent/garbage value AND for
 *  inaccessible storage (privacy modes throw on access). @returns {ThemeChoice} */
function storedTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

/** Humanize an engine field path for the banner chip (D-21 council #5 "raw
 *  field-path jargon"): `channels.<ch>.base[.param]` → '<Channel> base[ · param]',
 *  any other `channels.<ch>.<rest>` → '<Channel> · <rest>'; non-channel paths
 *  ('count', 'hue', …) already read as field names and pass through verbatim.
 *  The RAW path stays available in the chip's title attribute.
 *  @param {string} field @returns {string} */
export function humanizeField(field) {
  const m = /^channels\.([LCH])\.(.*)$/.exec(field)
  if (m == null) return field
  const label = CHANNEL_LABELS[/** @type {'L' | 'C' | 'H'} */ (m[1])]
  const rest = /** @type {string} */ (m[2])
  if (rest === 'base') return `${label} base`
  if (rest.startsWith('base.')) return `${label} base · ${rest.slice('base.'.length)}`
  return `${label} · ${rest}`
}

export class CrApp extends UIElement {
  static template = () => html`
    <header>
      <h1>Curve Ramp</h1>
      <span data-gamut-note hidden></span>
      <span data-header-actions>
        <span data-copy-link-status role="status" aria-live="polite"></span>
        <button type="button" class="cr-btn" data-undo
          title="undo the last edit (⌘Z / Ctrl+Z)">Undo</button>
        <button type="button" class="cr-btn" data-redo
          title="redo the undone edit (⌘⇧Z / Ctrl+Y)">Redo</button>
        <button type="button" class="cr-btn" data-copy-link
          title="copy a shareable URL of the current palette">Copy link</button>
        <button type="button" class="cr-btn" data-save-project
          title="download this palette as a .json project file (the editable specs)">Save project</button>
        <button type="button" class="cr-btn" data-open-project
          title="load a palette from a .json project file">Open project</button>
        <input type="file" data-open-project-input accept="application/json,.json" hidden>
        <button type="button" class="cr-btn" data-theme-toggle
          title="cycle the color theme: system → light → dark">Theme: system</button>
      </span>
    </header>
    <div data-error role="alert" hidden>
      <span data-error-message></span>
      <code data-error-field hidden></code>
      <button type="button" data-error-dismiss>Dismiss</button>
    </div>
    <main>
      <cr-family-menu></cr-family-menu>
      <cr-seed-controls></cr-seed-controls>
      <section data-canvas-slot aria-label="Curve canvas">
        <cr-base-picker></cr-base-picker>
        <cr-channel-legend></cr-channel-legend>
        <cr-curve-canvas></cr-curve-canvas>
      </section>
      <cr-ramp-strip></cr-ramp-strip>
      <cr-export-panel></cr-export-panel>
      <cr-palette-overview></cr-palette-overview>
    </main>
    <cr-toast></cr-toast>
  `

  static styles = css`
    cr-app {
      display: block;
      max-inline-size: calc(var(--space-8) * 16);
      margin-inline: auto;
      padding: var(--space-5);
    }
    cr-app > header {
      display: flex;
      align-items: baseline;
      gap: var(--space-3);
      margin-block-end: var(--space-5);
    }
    cr-app [data-gamut-note] {
      color: var(--color-text-muted);
      font-size: var(--text-sm);
    }
    /* Header action cluster (R-8 copy link + R-22 theme toggle). The status
       region sits BEFORE the buttons so its appearing text grows leftward —
       the buttons never shift. Resting button chrome is the shared .cr-btn
       recipe (tokens global layer, D-21 #12); only layout lives here. */
    cr-app [data-header-actions] {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      margin-inline-start: auto;
    }
    cr-app [data-copy-link-status] {
      color: var(--color-text-muted);
      font-size: var(--text-sm);
    }
    /* SPEC §10 error state — inline, dismissible, never display-forced over [hidden]. */
    cr-app [data-error]:not([hidden]) {
      display: flex;
      align-items: center;
    }
    cr-app [data-error] {
      gap: var(--space-3);
      margin-block-end: var(--space-4);
      padding: var(--space-3) var(--space-4);
      background: var(--color-surface-raised);
      border-inline-start: 2px solid var(--color-warning);
      border-radius: var(--radius-2);
    }
    cr-app [data-error-field] {
      color: var(--color-text-muted);
      font-size: var(--text-sm);
    }
    cr-app [data-error] button {
      margin-inline-start: auto;
      padding: var(--space-1) var(--space-2);
      background: transparent;
      color: inherit;
      border: 1px solid var(--color-text-muted);
      border-radius: var(--radius-2);
      cursor: pointer;
    }
    cr-app main {
      display: grid;
      gap: var(--space-6);
    }
    cr-app [data-canvas-slot] {
      display: grid;
      gap: var(--space-3);
    }
  `

  /** Manual theme override (R-22) — ephemeral UI state, NOT in PaletteSpec;
   *  the localStorage 'cr-theme' key is the only persistence. */
  #theme = signal(/** @type {ThemeChoice} */ ('system'))

  /** Copy-link status clear timer (export-panel pattern).
   *  @type {ReturnType<typeof setTimeout> | undefined} */
  #copyStatusTimer

  connected() {
    const region = /** @type {HTMLElement} */ (this.first('[data-error]'))
    const message = /** @type {HTMLElement} */ (this.first('[data-error-message]'))
    const field = /** @type {HTMLElement} */ (this.first('[data-error-field]'))
    const dismiss = /** @type {HTMLElement} */ (this.first('[data-error-dismiss]'))
    const copyLink = /** @type {HTMLButtonElement} */ (this.first('[data-copy-link]'))
    const saveProject = /** @type {HTMLButtonElement} */ (this.first('[data-save-project]'))
    const openProject = /** @type {HTMLButtonElement} */ (this.first('[data-open-project]'))
    const openInput = /** @type {HTMLInputElement} */ (this.first('[data-open-project-input]'))
    const copyStatus = /** @type {HTMLElement} */ (this.first('[data-copy-link-status]'))
    const themeToggle = /** @type {HTMLButtonElement} */ (this.first('[data-theme-toggle]'))
    const undoBtn = /** @type {HTMLButtonElement} */ (this.first('[data-undo]'))
    const redoBtn = /** @type {HTMLButtonElement} */ (this.first('[data-redo]'))

    /** D-21 #5 no-double-display: true while <cr-base-picker>'s inline region
     *  is showing this error — its filter is `channels.<active>.base*`, so the
     *  same prefix test against the LIVE view.activeChannel decides ownership.
     *  A tab switch moves ownership back here (tracked view read). */
    const ownedByPicker = () => {
      const f = store.lastError.value?.field
      return f != null && f.startsWith(`channels.${store.view.value.activeChannel}.base`)
    }

    this.bindAttr(region, 'hidden', () => store.lastError.value == null || ownedByPicker())
    this.bindText(message, () => store.lastError.value?.message ?? '')
    // Humanized path in the chip (D-21 #5), raw path preserved in title.
    this.bindText(field, () => {
      const f = store.lastError.value?.field
      return f == null ? '' : humanizeField(f)
    })
    this.bindAttr(field, 'title', () => store.lastError.value?.field ?? null)
    this.bindAttr(field, 'hidden', () => !store.lastError.value?.field)
    this.on(dismiss, 'click', () => store.clearError())

    // ── Shared polite status (copy-link / theme / undo-redo) ─────────────────
    // ONE region, one clear timer (the export panel's ~3 s pattern); the last
    // announcement wins. See the header doc — C2-F7 extraction at 3 consumers.
    /** @param {string} text */
    const announce = (text) => {
      copyStatus.textContent = text
      clearTimeout(this.#copyStatusTimer)
      this.#copyStatusTimer = setTimeout(() => {
        copyStatus.textContent = ''
        this.#copyStatusTimer = undefined
      }, COPY_STATUS_CLEAR_MS)
    }

    // ── Undo/redo (R-7) — buttons disable at the stack ends (frozen signals) ─
    this.bindProp(undoBtn, 'disabled', () => !store.canUndo.value)
    this.bindProp(redoBtn, 'disabled', () => !store.canRedo.value)
    // C4-#5: every path announces its outcome — including the silent no-op
    // (an empty stack reached via shortcut; the buttons disable before a
    // click can get here). store.undo/redo never reject: snapshots were
    // previously-valid specs, so the optimistic announcement is truthful.
    const doUndo = () => {
      if (!store.canUndo.peek()) {
        announce('Nothing to undo')
        return
      }
      store.undo()
      announce('Undid last edit')
    }
    const doRedo = () => {
      if (!store.canRedo.peek()) {
        announce('Nothing to redo')
        return
      }
      store.redo()
      announce('Redid last edit')
    }
    /** C4-#6 focus dead-end repair: an undo/redo click can disable the very
     *  button under focus. After the disabled bindings flush (microtask
     *  drain — same two ticks the tests use), a now-disabled source hands
     *  focus to its twin, or to the copy-link button when the twin is
     *  disabled too. @param {HTMLButtonElement} source @param {HTMLButtonElement} twin */
    const refocusFrom = async (source, twin) => {
      await null
      await null // let the disabled bindings flush
      if (!source.disabled) return
      ;(twin.disabled ? copyLink : twin).focus()
    }
    this.on(undoBtn, 'click', () => {
      doUndo()
      void refocusFrom(undoBtn, redoBtn)
    })
    this.on(redoBtn, 'click', () => {
      doRedo()
      void refocusFrom(redoBtn, undoBtn)
    })
    // Global shortcut: ⌘Z/Ctrl+Z → undo, ⌘⇧Z/Ctrl+Y → redo. Registered via
    // this.on so the scope disposes it on disconnect (no zombie listener).
    // GUARD (AC7): never fire — and never preventDefault — while the event
    // target is a text-editing element; typing keeps its NATIVE undo. Empty
    // stacks make undo()/redo() silent no-ops, matching the disabled buttons.
    this.on(window, 'keydown', (e) => {
      const ev = /** @type {KeyboardEvent} */ (e)
      if (!(ev.metaKey || ev.ctrlKey) || ev.altKey) return
      const key = ev.key.toLowerCase()
      const wantsUndo = key === 'z' && !ev.shiftKey
      const wantsRedo = (key === 'z' && ev.shiftKey) || (key === 'y' && !ev.shiftKey)
      if (!wantsUndo && !wantsRedo) return
      const t = ev.target
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t instanceof HTMLSelectElement ||
        (t instanceof HTMLElement && t.isContentEditable)
      ) {
        return // native editing undo wins (R-7 AC7)
      }
      ev.preventDefault() // ours — the browser must not also act on it
      if (wantsUndo) doUndo()
      else doRedo()
    })

    // ── Copy share link (R-8) — export-panel status pattern, never swallowed ─
    this.on(copyLink, 'click', async () => {
      const url = await store.currentShareUrl() // the CURRENT full set (gzipped) — never the ≤300 ms-stale hash
      let statusText
      try {
        await navigator.clipboard.writeText(url)
        statusText = 'Copied ✓'
      } catch {
        // Permission denied, insecure context, no clipboard API. Sync the
        // address bar FIRST (same write the debounce would make) so the
        // manual fallback is truthful even mid-debounce-window.
        history.replaceState(null, '', url)
        statusText = 'Copy failed — copy the URL from the address bar'
      }
      announce(statusText)
    })

    // ── Save / Open palette project files (D-41) — the editable specs as .json ─
    this.on(saveProject, 'click', () => {
      const blob = new Blob([store.exportProject()], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'curve-ramp-palette.json'
      document.body.append(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      announce('Palette saved ✓')
    })
    this.on(openProject, 'click', () => openInput.click()) // the visible button drives the hidden input
    this.on(openInput, 'change', async () => {
      const file = openInput.files?.[0]
      if (!file) return
      const text = await file.text()
      const ok = store.importProject(text) // bad file → lastError (banner), current palette intact
      openInput.value = '' // clear so re-selecting the SAME file fires 'change' again
      announce(ok ? 'Palette loaded ✓' : 'Import failed — see the error')
    })

    // ── Theme toggle (R-22) — boot-apply, cycle, persist ─────────────────────
    this.#theme.value = storedTheme()
    applyTheme(this.#theme.peek()) // applied on boot (reload restores the stored choice)
    this.bindText(themeToggle, () => `Theme: ${this.#theme.value}`)
    this.on(themeToggle, 'click', () => {
      const i = THEME_CYCLE.indexOf(this.#theme.peek())
      const next = THEME_CYCLE[(i + 1) % THEME_CYCLE.length] ?? 'system'
      this.#theme.value = next
      applyTheme(next)
      announce(`Theme: ${next}`) // C1-#6 + C4-#4: the NEW state, SR-audible
      try {
        // 'system' REMOVES the key: absent key ≡ absent attribute ≡ system.
        if (next === 'system') localStorage.removeItem(THEME_KEY)
        else localStorage.setItem(THEME_KEY, next)
      } catch {
        // Storage unavailable (privacy mode) — the override still applies
        // for this session; it just won't survive a reload.
      }
    })
  }

  disconnected() {
    clearTimeout(this.#copyStatusTimer) // disposal contract: no orphan timer fires after disconnect
    this.#copyStatusTimer = undefined
  }
}

customElements.define('cr-app', CrApp)
