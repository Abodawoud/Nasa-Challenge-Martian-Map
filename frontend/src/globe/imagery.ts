// Builds Cesium imagery providers from layers.config.ts entries.
import * as Cesium from 'cesium'
import { MARS_ELLIPSOID, MARS_TILING } from './mars'
import { TREK_TILE_ROOT } from './layers.config'
import type { ImageryLayerConfig } from './layers.config'
import { tintToMars } from './tint'
import type { GreyLevels } from './tint'

type TileImage = CanvasImageSource & { width: number; height: number }

/** Recolour every tile of a black-and-white provider to Mars colours (visual only). */
function withMarsTint<T extends Cesium.ImageryProvider>(provider: T, levels?: GreyLevels): T {
  const original = provider.requestImage.bind(provider)
  provider.requestImage = ((x: number, y: number, level: number, request?: Cesium.Request) => {
    const pending = original(x, y, level, request)
    if (!pending) return pending
    return Promise.resolve(pending).then((img) => tintToMars(img as TileImage, levels))
  }) as typeof provider.requestImage
  return provider
}

function createProvider(layer: ImageryLayerConfig): Cesium.ImageryProvider {
  const rectangle = layer.bounds ? Cesium.Rectangle.fromDegrees(...layer.bounds) : undefined
  const credit = new Cesium.Credit(layer.source)

  if (layer.kind === 'trek-wmts') {
    return new Cesium.WebMapTileServiceImageryProvider({
      // The double slash after 1.0.0 is how Trek publishes its template. It is correct.
      url: `${TREK_TILE_ROOT}/${layer.layerId}/1.0.0//{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.${layer.ext}`,
      layer: layer.layerId,
      style: 'default',
      tileMatrixSetID: 'default028mm',
      format: layer.ext === 'jpg' ? 'image/jpeg' : 'image/png',
      tilingScheme: MARS_TILING,
      maximumLevel: layer.maximumLevel,
      rectangle,
      credit,
    })
  }

  return new Cesium.UrlTemplateImageryProvider({
    url: layer.url,
    tilingScheme: new Cesium.GeographicTilingScheme({ ellipsoid: MARS_ELLIPSOID }),
    tileWidth: layer.tileSize,
    tileHeight: layer.tileSize,
    maximumLevel: layer.maximumLevel,
    rectangle,
    credit,
  })
}

/** Add every configured layer to the viewer, in order (later layers draw on top). */
export function addImageryLayers(viewer: Cesium.Viewer, layers: ImageryLayerConfig[]) {
  const added = new Map<string, Cesium.ImageryLayer>()
  for (const layer of layers) {
    let provider = createProvider(layer)
    if (layer.tintToMars) provider = withMarsTint(provider, layer.greyLevels)
    const imagery = new Cesium.ImageryLayer(provider, {
      minimumTerrainLevel: layer.minimumZoomLevel,
    })
    imagery.alpha = layer.defaultOpacity
    imagery.show = layer.visible
    viewer.imageryLayers.add(imagery)
    added.set(layer.id, imagery)
  }
  return added
}
