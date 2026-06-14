/**
 * Studio boot (PLAN §3.4, M3.2/M3.5; D-8 boot contract): index.html links the
 * tokens CSS — which declares the @layer order — BEFORE this module runs, so
 * every customElements.define below adopts its component sheet into an
 * already-ordered `components` layer. index.html provides <cr-app>.
 */
import './components/cr-app.js'
import './components/cr-seed-controls.js'
import './components/cr-ramp-strip.js'
import './components/cr-toast.js'
import './components/cr-base-picker.js'
import './components/cr-channel-legend.js'
import './components/cr-readout-chip.js'
import './components/cr-curve-canvas.js'
import './components/cr-export-panel.js'
import './components/cr-family-menu.js'
import './components/cr-palette-overview.js'
import { initFromUrl } from './store.js'

initFromUrl()
