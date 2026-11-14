// Preloading: download the tiles of a view BEFORE the camera gets there, so it arrives sharp.
//
// Why: Cesium only asks for the tiles the camera sees now. It refines the ground from coarse
// to fine, one level after the other, and each level waits for its own downloads. After a
// flight that is many network round trips, so the destination stayed blurry for seconds.
//
// What we found in the Cesium 1.147 source, and why we chose this way:
// - Cesium's own flight preload (scene.preloadFlightCamera, set by camera.flyTo) only feeds
//   3D Tiles tilesets. Scene.updatePreloadFlightPass calls primitives.updateForPass, the globe
//   never sees it. globe.preloadAncestors / preloadSiblings only work around the CURRENT view.
// - So we run Cesium's tile choice ourselves, for a camera placed at the destination: the same
//   rule as QuadtreePrimitive (refine a visible tile while its screen-space error is above
//   globe.maximumScreenSpaceError) and the same imagery level rule as
//   ImageryLayer._createTileImagerySkeletons.
// - A low view that looks at the horizon needs a lot: about 1,300 visible tiles for the Jezero
//   descent (measured with this planner). So we keep only the NEAREST ones, up to a cap. They
//   cover most of the screen, and a parent tile is always nearer than its children, so Cesium
//   gets every level it needs on the way down. Far tiles near the horizon are small on screen
//   and Cesium loads them quickly after arrival. Hidden siblings are skipped for the same reason.
// - We download those tiles early, a few at a time, at low priority. The browser keeps them in
//   its HTTP cache (Trek and the terrain server send Last-Modified and ETag, Esri sends a
//   30-day max-age). When Cesium asks for them later, they come back without a network trip.
// - Imagery is only downloaded, never decoded or tinted here: Cesium does that once, as
//   before. Terrain goes through the provider's own requestTileGeometry (same URL and headers
//   as Cesium's request), the parsed result is simply dropped.
// - waitForTiles lets a flight hold its pause until the view is loaded, with a time limit.
// Simple and robust: no Cesium internals are changed. If a guess is off, the only cost is a few
// extra or missing downloads, never a wrong picture.
import * as Cesium from 'cesium'
import { layerConfig, tileUrl, isTileHidden } from './imagery'

/** A camera position and orientation, as for camera.setView / camera.flyTo. */
export interface CameraView {
  destination: Cesium.Cartesian3
  orientation: { heading: number; pitch: number; roll: number }
}

/**
 * Most tiles (terrain + imagery) one view may download. Measured with this planner on a
 * 1600 x 900 screen: the Jezero overview needs about 170, and 500 covers every visible tile of
 * the descent view up to about 9 km from the camera (the screen centre is about 6 km ahead).
 */
const MAX_TILES_PER_VIEW = 500
/** Safety limit for the planning loop itself (pure maths, no downloads). */
const MAX_TILES_PLANNED = 5_000
/** Downloads at the same time. Low, so the tiles of the current view are not slowed down. */
const PARALLEL_DOWNLOADS = 6
/** Ground heights assumed around the destination, for the tile boxes (Trek scale). */
const HEIGHT_BAND_M = 800
/** Never plan deeper than this level (Trek terrain stops at about 17). */
const MAX_LEVEL = 20

interface Job {
  key: string
  load: () => Promise<unknown> | undefined
}

interface TileXY {
  x: number
  y: number
  level: number
}

interface PlannedTile extends TileXY {
  /** Metres from the destination camera to the tile. */
  distance: number
}

/** Same lens as the real camera: aspect ratio of the screen and field of view. */
function destinationCamera(viewer: Cesium.Viewer, view: CameraView) {
  const { scene } = viewer
  const camera = new Cesium.Camera(scene)
  const frustum = camera.frustum as Cesium.PerspectiveFrustum
  frustum.aspectRatio = scene.canvas.clientWidth / Math.max(1, scene.canvas.clientHeight)
  const real = viewer.camera.frustum
  if (real instanceof Cesium.PerspectiveFrustum && real.fov !== undefined) frustum.fov = real.fov
  camera.setView(view)
  return { camera, frustum }
}

/** Imagery level Cesium picks for a terrain tile with this geometric error (ImageryLayer.js). */
function imageryLevel(provider: Cesium.ImageryProvider, geometricError: number) {
  const scheme = provider.tilingScheme
  // Geographic tiling: no latitude factor.
  const levelZeroTexel =
    (scheme.ellipsoid.maximumRadius * scheme.rectangle.width) / (provider.tileWidth * scheme.getNumberOfXTilesAtLevel(0))
  let level = Math.max(0, Math.round(Math.log2(levelZeroTexel / geometricError)))
  if (provider.maximumLevel !== undefined) level = Math.min(level, provider.maximumLevel)
  return Math.max(level, provider.minimumLevel ?? 0)
}

/** The visible terrain tiles Cesium would load for this view, nearest first. */
function planTerrain(viewer: Cesium.Viewer, view: CameraView, groundHeight: number): PlannedTile[] {
  const { scene } = viewer
  const { globe } = scene
  const terrain = scene.terrainProvider
  const tiling = terrain.tilingScheme
  const ellipsoid = globe.ellipsoid
  const { camera, frustum } = destinationCamera(viewer, view)
  const position = camera.positionWC
  const culling = frustum.computeCullingVolume(position, camera.directionWC, camera.upWC)
  // Tiles behind the planet's edge are not drawn. The smooth sphere is below Trek's ground,
  // so this hides a little less than Cesium does (safe side).
  const occluder = new Cesium.Occluder(new Cesium.BoundingSphere(Cesium.Cartesian3.ZERO, ellipsoid.minimumRadius), position)
  // Screen-space error = geometric error * screen height / (distance * 2 tan(fovy / 2)).
  const errorPerMetre = scene.canvas.clientHeight / (2 * Math.tan((frustum.fovy ?? Cesium.Math.PI_OVER_THREE) / 2))

  const planned: PlannedTile[] = []
  let candidates: TileXY[] = []
  for (let x = 0; x < tiling.getNumberOfXTilesAtLevel(0); x++) {
    for (let y = 0; y < tiling.getNumberOfYTilesAtLevel(0); y++) candidates.push({ x, y, level: 0 })
  }
  while (candidates.length > 0 && planned.length < MAX_TILES_PLANNED) {
    const next: TileXY[] = []
    for (const tile of candidates) {
      const rectangle = tiling.tileXYToRectangle(tile.x, tile.y, tile.level)
      const box = Cesium.OrientedBoundingBox.fromRectangle(
        rectangle,
        groundHeight - HEIGHT_BAND_M,
        groundHeight + HEIGHT_BAND_M,
        ellipsoid,
      )
      const visible =
        culling.computeVisibility(box) !== Cesium.Intersect.OUTSIDE &&
        occluder.isBoundingSphereVisible(Cesium.BoundingSphere.fromOrientedBoundingBox(box))
      // Cesium always loads the level 0 tiles. Other hidden tiles are not needed on arrival.
      if (!visible && tile.level > 0) continue
      const distance = Math.sqrt(box.distanceSquaredTo(position))
      planned.push({ ...tile, distance })
      if (!visible || tile.level >= MAX_LEVEL) continue
      const error = (terrain.getLevelMaximumGeometricError(tile.level) * errorPerMetre) / Math.max(1, distance)
      if (error <= globe.maximumScreenSpaceError) continue
      for (let i = 0; i < 4; i++) {
        const child = { x: tile.x * 2 + (i % 2), y: tile.y * 2 + (i >> 1), level: tile.level + 1 }
        if (terrain.getTileDataAvailable(child.x, child.y, child.level) !== false) next.push(child)
      }
    }
    candidates = next
  }
  // Nearest first. A parent's box holds its children, so it is never further than they are:
  // the cap can cut far tiles, but never a level that a kept tile needs. Coarse first on ties.
  return planned.sort((a, b) => a.distance - b.distance || a.level - b.level)
}

/** Terrain and imagery downloads for a view, nearest first, at most MAX_TILES_PER_VIEW. */
function planView(viewer: Cesium.Viewer, view: CameraView, groundHeight: number): { jobs: Job[]; wanted: number } {
  const { scene } = viewer
  const terrain = scene.terrainProvider
  const tiling = terrain.tilingScheme
  // The smooth-sphere fallback has nothing to download.
  const trek = terrain instanceof Cesium.CesiumTerrainProvider ? terrain : undefined
  const layers: Array<{ layer: Cesium.ImageryLayer; minimumZoomLevel: number }> = []
  for (let i = 0; i < viewer.imageryLayers.length; i++) {
    const layer = viewer.imageryLayers.get(i)
    const config = layerConfig(layer)
    // Cesium does not load hidden layers either.
    if (layer.show && config) layers.push({ layer, minimumZoomLevel: config.minimumZoomLevel ?? 0 })
  }

  const jobs: Job[] = []
  // Every tile the view would need, kept or not (for the log).
  const seen = new Set<string>()
  const add = (key: string, load: Job['load']) => {
    if (seen.has(key)) return
    seen.add(key)
    if (jobs.length < MAX_TILES_PER_VIEW) jobs.push({ key, load })
  }

  for (const tile of planTerrain(viewer, view, groundHeight)) {
    const { x, y, level } = tile
    if (trek) add(`terrain/${level}/${x}/${y}`, () => (viewer.isDestroyed() ? undefined : trek.requestTileGeometry(x, y, level)))

    const rectangle = tiling.tileXYToRectangle(x, y, level)
    const geometricError = terrain.getLevelMaximumGeometricError(level)
    for (const { layer, minimumZoomLevel } of layers) {
      if (level < minimumZoomLevel) continue
      const config = layerConfig(layer)
      const provider = layer.imageryProvider
      const overlap = Cesium.Rectangle.intersection(rectangle, provider.rectangle)
      if (!config || !overlap) continue
      const imageLevel = imageryLevel(provider, geometricError)
      // Move the corners in a little, so a shared edge does not pull in the neighbour tile
      // (Cesium does the same with 1/512 of the tile size).
      const dx = Math.min(rectangle.width / 512, overlap.width / 2)
      const dy = Math.min(rectangle.height / 512, overlap.height / 2)
      const scheme = provider.tilingScheme
      const nw = scheme.positionToTileXY(new Cesium.Cartographic(overlap.west + dx, overlap.north - dy), imageLevel)
      const se = scheme.positionToTileXY(new Cesium.Cartographic(overlap.east - dx, overlap.south + dy), imageLevel)
      // positionToTileXY returns undefined outside the tiling scheme, despite its type.
      if (!nw || !se) continue
      for (let ix = nw.x; ix <= se.x; ix++) {
        for (let iy = nw.y; iy <= se.y; iy++) {
          if (isTileHidden(config, scheme, ix, iy, imageLevel)) continue
          const url = tileUrl(config, ix, iy, imageLevel)
          add(url, () => download(url))
        }
      }
    }
  }
  return { jobs, wanted: seen.size }
}

async function download(url: string) {
  // Low priority: the tiles of the current view always go first.
  const response = await fetch(url, { priority: 'low' })
  // The body must be read, or the browser does not keep the tile in its cache.
  if (response.ok) await response.blob()
}

// One small queue for all preloads. A tile already loaded or on its way is not asked for again.
const known = new Map<string, Promise<void>>()
const queue: Array<() => void> = []
let running = 0

function pump() {
  while (running < PARALLEL_DOWNLOADS && queue.length > 0) queue.shift()?.()
}

function schedule(job: Job): Promise<void> {
  const existing = known.get(job.key)
  if (existing) return existing
  // Forget old entries now and then, so the list does not grow forever.
  if (known.size > 20_000) known.clear()
  const done = new Promise<void>((resolve) => {
    queue.push(() => {
      running++
      let pending: Promise<unknown> | undefined
      try {
        pending = job.load()
      } catch (err) {
        pending = Promise.reject(err)
      }
      Promise.resolve(pending)
        // A failed tile may be tried again by a later preload. Cesium handles its own errors.
        .catch(() => known.delete(job.key))
        .finally(() => {
          running--
          resolve()
          pump()
        })
    })
  })
  known.set(job.key, done)
  pump()
  return done
}

/**
 * Start downloading every tile the view needs. Returns a promise that resolves when all of
 * them are done or failed (never rejects). Safe to call many times: tiles are fetched once.
 * groundHeight: Trek ground height at the destination (about 5,600 m at Jezero).
 */
export function preloadView(viewer: Cesium.Viewer, view: CameraView, groundHeight: number, name = 'view'): Promise<void> {
  try {
    if (viewer.isDestroyed()) return Promise.resolve()
    const { jobs, wanted } = planView(viewer, view, groundHeight)
    if (import.meta.env.DEV) console.info(`[preload] ${name}: ${jobs.length} of ${wanted} visible tiles, nearest first`)
    return Promise.all(jobs.map(schedule)).then(() => undefined)
  } catch (err) {
    // Preloading is a bonus. It must never break a flight.
    console.warn('[preload] skipped', err)
    return Promise.resolve()
  }
}

/**
 * Resolve when the globe has loaded every tile of the current view (and `also` is done),
 * but not before minMs and never after maxMs. Never rejects.
 */
/**
 * True when every tile the camera can SEE is loaded.
 *
 * Cesium's `globe.tilesLoaded` also waits for its low-priority queue: the tiles around the
 * view that it preloads for later (preloadSiblings / preloadAncestors). Measured: that queue
 * kept "loading" for a long time after the view was already sharp. For "is the picture ready"
 * only the high and medium queues matter. They are internal Cesium fields, so if they are
 * ever missing this falls back to `tilesLoaded`.
 */
export function visibleTilesLoaded(viewer: Cesium.Viewer): boolean {
  const globe = viewer.scene.globe
  const surface = (globe as unknown as { _surface?: { _tileLoadQueueHigh?: unknown[]; _tileLoadQueueMedium?: unknown[] } })
    ._surface
  const high = surface?._tileLoadQueueHigh
  const medium = surface?._tileLoadQueueMedium
  if (!high || !medium) return globe.tilesLoaded
  return high.length === 0 && medium.length === 0
}

export function waitForTiles(
  viewer: Cesium.Viewer,
  { minMs, maxMs, also }: { minMs: number; maxMs: number; also?: Promise<unknown> },
): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now()
    let alsoDone = !also
    also?.finally(() => (alsoDone = true)).catch(() => {})
    const check = () => {
      let ready = true
      try {
        if (!viewer.isDestroyed()) {
          viewer.scene.requestRender()
          ready = visibleTilesLoaded(viewer) && alsoDone
        }
      } catch {
        // A viewer in a bad state: stop waiting.
      }
      const elapsed = performance.now() - start
      if (elapsed >= maxMs || (elapsed >= minMs && ready)) {
        clearInterval(timer)
        resolve()
      }
    }
    // A light check 10 times a second, only while waiting.
    const timer = setInterval(check, 100)
  })
}

/** Resolve when the current view is loaded and the browser has a quiet moment. */
export function whenIdle(viewer: Cesium.Viewer): Promise<void> {
  return waitForTiles(viewer, { minMs: 500, maxMs: 15_000 }).then(
    () =>
      new Promise<void>((resolve) => {
        if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(() => resolve(), { timeout: 2_000 })
        else setTimeout(resolve, 200)
      }),
  )
}
