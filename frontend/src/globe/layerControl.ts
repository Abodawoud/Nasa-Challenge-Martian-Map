// Switching map layers on and off, and their transparency. The Layers panel calls these.
//
// Efficient by design:
//   - a hidden imagery layer is `show = false`: Cesium asks for no tiles and draws nothing.
//     Its tiles stay in the tile cache, so switching it back on is instant.
//   - the rover path and the geologic map layers are downloaded and built only the first
//     time they are switched on.
import * as Cesium from 'cesium'
import { PANEL_LAYERS } from './layers.config'
import type { PanelLayer } from './layers.config'
import { createRoverPathLayer, loadRoverPath } from './pathLayer'
import { createGeologyLayer, loadGeology } from './geologyLayer'

interface ViewerLayers {
  /** The photo and heat layers MarsViewer made from IMAGERY_LAYERS, by id. */
  imagery: Map<string, Cesium.ImageryLayer>
  /** Layers built on first use (rover path, geologic map), by panel id. */
  built: Map<string, { layer: Cesium.ImageryLayer; marker?: Cesium.Entity; info?: string }>
  /** Being built right now, so two fast clicks build a layer once. */
  building: Map<string, Promise<void>>
}

const registry = new WeakMap<Cesium.Viewer, ViewerLayers>()

/** Called once by MarsViewer with the layers it created from the config. */
export function registerImageryLayers(viewer: Cesium.Viewer, imagery: Map<string, Cesium.ImageryLayer>) {
  registry.set(viewer, { imagery, built: new Map(), building: new Map() })
}

/**
 * Keep the drawing order of the built layers the same whatever order they were switched on:
 * the order of PANEL_LAYERS, last entry at the bottom (areas under lines under the path).
 */
function restack(viewer: Cesium.Viewer, layers: ViewerLayers) {
  for (let i = PANEL_LAYERS.length - 1; i >= 0; i--) {
    const built = layers.built.get(PANEL_LAYERS[i].id)
    if (built) viewer.imageryLayers.raiseToTop(built.layer)
  }
}

async function build(viewer: Cesium.Viewer, layers: ViewerLayers, entry: PanelLayer) {
  if (entry.kind === 'rover-path') {
    const data = await loadRoverPath()
    if (viewer.isDestroyed()) throw new Error('The map was closed')
    const layer = createRoverPathLayer(data)
    viewer.imageryLayers.add(layer)
    // A dot and a label where the rover was at the end of the file.
    const marker = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(data.last.lon, data.last.lat, 0),
      point: {
        pixelSize: 9,
        color: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.fromCssColorString('#0c1a3d'),
        outlineWidth: 2.5,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: `Perseverance · sol ${data.lastSol}`,
        font: '600 12px Inter, sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.fromCssColorString('#0c1a3d'),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -16),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })
    layers.built.set(entry.id, {
      layer,
      marker,
      info: `${data.driveCount} drives · ${(data.lengthM / 1000).toFixed(1)} km · up to sol ${data.lastSol} (a sol is one Mars day)`,
    })
    // Put the marker on the ground the map draws (Trek terrain), when that is available.
    void Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, [Cesium.Cartographic.fromDegrees(data.last.lon, data.last.lat)])
      .then(([ground]) => {
        if (viewer.isDestroyed() || ground.height === undefined) return
        marker.position = new Cesium.ConstantPositionProperty(Cesium.Cartesian3.fromDegrees(data.last.lon, data.last.lat, ground.height))
        viewer.scene.requestRender()
      })
      .catch(() => undefined) // smooth sphere: the marker stays at height 0
  } else if (entry.kind === 'geology') {
    const shapes = await loadGeology(entry.geology)
    if (viewer.isDestroyed()) throw new Error('The map was closed')
    const layer = createGeologyLayer(shapes, entry.geology)
    viewer.imageryLayers.add(layer)
    layers.built.set(entry.id, { layer, info: `${shapes.length.toLocaleString('en')} ${entry.geology.countWord}` })
  }
  restack(viewer, layers)
}

/**
 * Show or hide one entry of the Layers panel. Resolves with a line of facts about the layer
 * when there is one. Rejects when the layer could not be downloaded.
 */
export async function setLayerVisible(viewer: Cesium.Viewer, entry: PanelLayer, visible: boolean, alpha: number): Promise<string | undefined> {
  const layers = registry.get(viewer)
  if (!layers) throw new Error('The map is not ready yet')
  let info: string | undefined

  if (entry.kind === 'imagery') {
    for (const id of entry.imageryIds) {
      const layer = layers.imagery.get(id)
      if (!layer) continue
      layer.show = visible
      layer.alpha = alpha
    }
  } else {
    if (visible && !layers.built.has(entry.id)) {
      let pending = layers.building.get(entry.id)
      if (!pending) {
        pending = build(viewer, layers, entry).finally(() => layers.building.delete(entry.id))
        layers.building.set(entry.id, pending)
      }
      await pending
    }
    const built = layers.built.get(entry.id)
    if (built) {
      built.layer.show = visible
      built.layer.alpha = alpha
      if (built.marker) built.marker.show = visible
      info = built.info
    }
  }
  viewer.scene.requestRender()
  return info
}

/** Transparency of one entry: 0 = invisible, 1 = solid. */
export function setLayerOpacity(viewer: Cesium.Viewer, entry: PanelLayer, alpha: number) {
  const layers = registry.get(viewer)
  if (!layers) return
  if (entry.kind === 'imagery') {
    for (const id of entry.imageryIds) {
      const layer = layers.imagery.get(id)
      if (layer) layer.alpha = alpha
    }
  } else {
    const built = layers.built.get(entry.id)
    if (built) built.layer.alpha = alpha
  }
  viewer.scene.requestRender()
}
