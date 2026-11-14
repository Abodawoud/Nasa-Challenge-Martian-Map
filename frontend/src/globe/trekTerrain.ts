// Trek's Mars terrain, with a fix for its tile bounding spheres.
//
// Problem (found 2026-11-14): every Trek quantized-mesh tile header carries a bounding
// sphere that was computed for a different planet shape. Example, level 14 tile near
// Jezero: header sphere centre at 17.837°N, height 4,382 m, while the tile really sits at
// 18.034°N, 6,227 to 6,321 m. Cesium uses that sphere to decide what is on screen and to
// set the camera's near and far planes, so tiles near the camera were dropped. That made
// holes in the ground and "cut" strips through Jezero.
//
// Fix: replace the header sphere with one built from the tile's oriented bounding box,
// which Cesium computes itself from the tile rectangle and min / max heights on OUR
// Mars sphere. The horizon culling point is already recomputed by Cesium's worker.
import * as Cesium from 'cesium'
import { MARS_ELLIPSOID, TREK_TERRAIN_URL } from './mars'

interface QuantizedMeshInternals {
  _boundingSphere?: Cesium.BoundingSphere
  _orientedBoundingBox?: Cesium.OrientedBoundingBox
}

function fixBoundingSphere(data: Cesium.TerrainData): Cesium.TerrainData {
  if (data instanceof Cesium.QuantizedMeshTerrainData) {
    const internals = data as unknown as QuantizedMeshInternals
    if (internals._orientedBoundingBox) {
      internals._boundingSphere = Cesium.BoundingSphere.fromOrientedBoundingBox(internals._orientedBoundingBox)
    }
  }
  return data
}

export async function createTrekTerrain(): Promise<Cesium.CesiumTerrainProvider> {
  const terrain = await Cesium.CesiumTerrainProvider.fromUrl(TREK_TERRAIN_URL, {
    ellipsoid: MARS_ELLIPSOID,
    requestVertexNormals: true,
  })
  const original = terrain.requestTileGeometry.bind(terrain)
  terrain.requestTileGeometry = (x, y, level, request) => {
    const pending = original(x, y, level, request)
    return pending ? pending.then(fixBoundingSphere) : pending
  }
  return terrain
}
