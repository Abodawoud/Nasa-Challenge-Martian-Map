// Switching map layers on and off, and their transparency. The Layers panel calls these.
//
// Efficient by design:
//   - a hidden imagery layer is `show = false`: Cesium asks for no tiles and draws nothing.
//     Its tiles stay in the tile cache, so switching it back on is instant.
//   - the rover path is downloaded and built only the first time it is switched on.
import * as Cesium from 'cesium'
import type { PanelLayer } from './layers.config'
import { createRoverPathLayer, loadRoverPath } from './pathLayer'
import type { RoverPath } from './pathLayer'

interface ViewerLayers {
  imagery: Map<string, Cesium.ImageryLayer>
  path?: { layer: Cesium.ImageryLayer; marker: Cesium.Entity; data: RoverPath }
}

const registry = new WeakMap<Cesium.Viewer, ViewerLayers>()

/** Called once by MarsViewer with the layers it created from the config. */
export function registerImageryLayers(viewer: Cesium.Viewer, imagery: Map<string, Cesium.ImageryLayer>) {
  registry.set(viewer, { imagery })
}

export interface RoverPathInfo {
  lastSol: number
  lengthKm: number
  driveCount: number
}

async function showRoverPath(viewer: Cesium.Viewer, layers: ViewerLayers, alpha: number): Promise<RoverPathInfo> {
  if (!layers.path) {
    const data = await loadRoverPath()
    if (viewer.isDestroyed()) throw new Error('The map was closed')
    // Two fast clicks: the first one may have finished while this one waited.
    if (!layers.path) {
      const layer = createRoverPathLayer(data)
      viewer.imageryLayers.add(layer) // on top of every photo layer
      // A dot and a label where the rover was at the end of the file. The height is ignored
      // for drawing order (always on top), so it needs no terrain height.
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
      layers.path = { layer, marker, data }
      // Put the marker on the ground the map draws (Trek terrain), when that is available.
      void Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, [Cesium.Cartographic.fromDegrees(data.last.lon, data.last.lat)])
        .then(([ground]) => {
          if (viewer.isDestroyed() || ground.height === undefined) return
          marker.position = new Cesium.ConstantPositionProperty(Cesium.Cartesian3.fromDegrees(data.last.lon, data.last.lat, ground.height))
          viewer.scene.requestRender()
        })
        .catch(() => undefined) // smooth sphere: the marker stays at height 0
    }
  }
  const { layer, marker, data } = layers.path
  layer.show = true
  layer.alpha = alpha
  marker.show = true
  return { lastSol: data.lastSol, lengthKm: data.lengthM / 1000, driveCount: data.driveCount }
}

/**
 * Show or hide one entry of the Layers panel. Resolves with facts about the rover path when
 * that layer was switched on. Rejects when the path could not be downloaded.
 */
export async function setLayerVisible(viewer: Cesium.Viewer, entry: PanelLayer, visible: boolean, alpha: number): Promise<RoverPathInfo | undefined> {
  const layers = registry.get(viewer)
  if (!layers) return undefined
  let info: RoverPathInfo | undefined
  if (entry.kind === 'rover-path') {
    if (visible) info = await showRoverPath(viewer, layers, alpha)
    else if (layers.path) {
      layers.path.layer.show = false
      layers.path.marker.show = false
    }
  } else {
    for (const id of entry.imageryIds) {
      const layer = layers.imagery.get(id)
      if (!layer) continue
      layer.show = visible
      layer.alpha = alpha
    }
  }
  viewer.scene.requestRender()
  return info
}

/** Transparency of one entry: 0 = invisible, 1 = solid. */
export function setLayerOpacity(viewer: Cesium.Viewer, entry: PanelLayer, alpha: number) {
  const layers = registry.get(viewer)
  if (!layers) return
  if (entry.kind === 'rover-path') {
    if (layers.path) layers.path.layer.alpha = alpha
  } else {
    for (const id of entry.imageryIds) {
      const layer = layers.imagery.get(id)
      if (layer) layer.alpha = alpha
    }
  }
  viewer.scene.requestRender()
}
