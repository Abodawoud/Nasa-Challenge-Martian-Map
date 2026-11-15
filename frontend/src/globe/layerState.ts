// Which layers are on, and how strong: ONE record for the whole app.
// The Layers panel, the TOC and the legend all read it, so they always agree, and each of
// them can switch a layer. The work on the map itself is done by layerControl.ts.
import type * as Cesium from 'cesium'
import { PANEL_LAYERS } from './layers.config'
import type { PanelLayer } from './layers.config'
import { setLayerOpacity, setLayerVisible } from './layerControl'

export interface LayerRow {
  /** Switched on in the Layers panel: the layer is part of the map (it is listed in the TOC). */
  on: boolean
  /** Hidden with the eye in the TOC: still part of the map, but not drawn, and not in the legend. */
  hidden: boolean
  opacity: number
  /** True while a layer that is downloaded on first use is on its way. */
  loading: boolean
  error: boolean
  /** Why it failed, for the small print under the message. */
  reason?: string
  /** A line of facts about the layer, from its data. */
  info?: string
}

export type LayerRows = Record<string, LayerRow>

let rows: LayerRows = Object.fromEntries(PANEL_LAYERS.map((entry) => [entry.id, { on: entry.defaultOn, hidden: false, opacity: entry.defaultOpacity, loading: false, error: false }]))
let viewer: Cesium.Viewer | null = null
const listeners = new Set<() => void>()

function patch(id: string, change: Partial<LayerRow>) {
  rows = { ...rows, [id]: { ...rows[id], ...change } }
  for (const listener of listeners) listener()
}

export const layerStore = {
  get: () => rows,
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  /** The map the switches work on. Set by the Layers panel when the map is ready. */
  setViewer(next: Cesium.Viewer | null) {
    viewer = next
  },
  /** Switch one layer on or off. A layer that cannot be loaded goes back to off, with the reason. */
  toggle(entry: PanelLayer, on: boolean) {
    if (!viewer || viewer.isDestroyed()) return
    // Switching a layer on (or off) in Layers always clears the eye: it starts visible.
    patch(entry.id, { on, hidden: false, error: false, loading: on && entry.kind !== 'imagery' })
    setLayerVisible(viewer, entry, on, rows[entry.id].opacity)
      .then((info) => patch(entry.id, { loading: false, ...(info ? { info } : {}) }))
      .catch((error) => {
        console.warn('[Layers] could not show', entry.id, error)
        patch(entry.id, { on: false, loading: false, error: true, reason: error instanceof Error ? error.message : String(error) })
      })
  },
  /**
   * The eye in the TOC: hide a layer on the map, or show it again. The layer stays switched
   * on (it stays in the TOC), so it is one click to bring it back.
   */
  setHidden(entry: PanelLayer, hidden: boolean) {
    if (!viewer || viewer.isDestroyed() || !rows[entry.id].on) return
    patch(entry.id, { hidden })
    setLayerVisible(viewer, entry, !hidden, rows[entry.id].opacity).catch((error) => {
      console.warn('[Layers] could not change', entry.id, error)
    })
  },
  /** How strong a layer is drawn: 0 = invisible, 1 = solid. */
  fade(entry: PanelLayer, opacity: number) {
    patch(entry.id, { opacity })
    if (viewer && !viewer.isDestroyed()) setLayerOpacity(viewer, entry, opacity)
  },
}
