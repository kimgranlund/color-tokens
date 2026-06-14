/**
 * @curve-ramp/base — the single public entry point (CR-BASE-001 §1).
 * Everything not re-exported here is private.
 */

export { signal, computed, effect, effectRaf, effectIdle, batch, untracked, isSignal, subscriberCount } from './signals.js'
export { html, raw, css } from './dom.js'
export { UIElement, provideContext, asString, asNumber, asInteger, asBoolean, asEnum, asJSON } from './element.js'
