/**
 * DOM template helpers (CR-BASE-001 §3). Carries the reference's exact
 * escaping semantics; `html` stays a plain escaper — no in-tag parsing
 * heuristics (PLAN §1.4). No signals import.
 */

const RAW = Symbol('base.raw')

/** @type {Record<string, string>} */
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/** @param {unknown} s */
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c])

/**
 * Mark a string as trusted HTML so `html` interpolates it verbatim
 * (e.g. rendered markdown).
 * @param {unknown} value
 * @returns {object}
 */
export function raw(value) {
  return { [RAW]: String(value) }
}

/** @param {unknown} v @returns {string} */
function interpolate(v) {
  if (v == null || v === false || v === true) return ''
  if (Array.isArray(v)) return v.map(interpolate).join('')
  const trusted = typeof v === 'object' ? /** @type {any} */ (v)[RAW] : undefined
  if (trusted !== undefined) return trusted
  return escapeHtml(v)
}

/**
 * Tagged template → an HTML string. Interpolations are escaped via the
 * 5-entry table; `null`/`undefined`/`true`/`false` → `""`; arrays flattened
 * and joined; wrap with `raw()` to opt out.
 * @param {TemplateStringsArray} strings
 * @param {...unknown} values
 * @returns {string}
 */
export function html(strings, ...values) {
  let out = strings[0]
  for (let i = 0; i < values.length; i++) out += interpolate(values[i]) + strings[i + 1]
  return out
}

/**
 * Tagged template → a constructable CSSStyleSheet whose text is wrapped in
 * `@layer components { … }` automatically — unless the trimmed source already
 * starts with `@layer` (escape hatch, Δ7/D-8). This package never declares
 * layer ORDER — `packages/tokens` owns it (boot contract, D-8: tokens CSS
 * must load before any `customElements.define`).
 * @param {TemplateStringsArray} strings
 * @param {...unknown} values
 * @returns {CSSStyleSheet}
 */
export function css(strings, ...values) {
  let text = strings[0]
  for (let i = 0; i < values.length; i++) text += String(values[i]) + strings[i + 1]
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(text.trim().startsWith('@layer') ? text : `@layer components {\n${text}\n}`)
  return sheet
}
