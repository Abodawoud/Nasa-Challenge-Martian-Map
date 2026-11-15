// Small helpers shared by the map tools (Measure, Identify): where a click hits the ground,
// distances on Mars, and a flag that lets a tool take the mouse away from the camera.
import * as Cesium from 'cesium'
import { MARS_ELLIPSOID, MARS_RADIUS_M } from './mars'

export interface LonLat {
  /** Degrees, east-positive. */
  lon: number
  /** Degrees. */
  lat: number
}

/**
 * True while a tool drags something on the map (a measurement point). groundControls.ts
 * reads it and leaves the camera alone, so the map does not slide under the point.
 */
export const toolInput = {
  dragging: false,
  /** The mouse cursor a tool wants on the map (a CSS cursor name), or '' for the usual one. */
  cursor: '',
}

/**
 * The mouse cursor of a map tool: an arrow (the Lucide "mouse-pointer-2" shape) with a small
 * round badge that says what a click will do. The tip of the arrow is the exact spot.
 *   measure   a ruler line with two end marks
 *   identify  the letter i
 *   route     a small flag
 * If the browser cannot show it, the plain crosshair is used.
 */
export function toolCursor(kind: 'measure' | 'identify' | 'route'): string {
  const badge =
    kind === 'measure'
      ? '<path d="M18.2 23h9.6M18.2 20.2v5.6M27.8 20.2v5.6" stroke="#fff" stroke-width="1.8" stroke-linecap="round" fill="none"/>'
      : kind === 'route'
        ? '<path d="M20.2 27.6v-9.4" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/><path d="M20.2 18.6h6.6l-1.9 2.3 1.9 2.3h-6.6z" fill="#fff"/>'
        : '<circle cx="23" cy="19.4" r="1.25" fill="#fff"/><path d="M23 22.4v4.6" stroke="#fff" stroke-width="2" stroke-linecap="round"/>'
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
    // The arrow: white with a navy edge, readable on bright and on dark ground.
    '<path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z" fill="#fff" stroke="#0c1a3d" stroke-width="1.6" stroke-linejoin="round"/>' +
    '<circle cx="23" cy="23" r="8" fill="#0c1a3d" stroke="#fff" stroke-width="1.5"/>' +
    badge +
    '</svg>'
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 4 4, crosshair`
}

/** The place on the ground under a screen position, in 2D and 3D. */
export function pickPlace(viewer: Cesium.Viewer, position: Cesium.Cartesian2): LonLat | undefined {
  const { scene, camera } = viewer
  // 3D: the real ground first. The smooth sphere is wrong when the view is tilted, because
  // the Trek terrain sits above it.
  const ray = scene.mode !== Cesium.SceneMode.SCENE2D ? camera.getPickRay(position) : undefined
  const cartesian = (ray ? scene.globe.pick(ray, scene) : undefined) ?? camera.pickEllipsoid(position, MARS_ELLIPSOID)
  if (!cartesian) return undefined
  const carto = Cesium.Cartographic.fromCartesian(cartesian, MARS_ELLIPSOID)
  return { lon: Cesium.Math.toDegrees(carto.longitude), lat: Cesium.Math.toDegrees(carto.latitude) }
}

/**
 * A point to DRAW at a place: on the ground the map shows (Trek terrain), lifted a little so
 * it does not sink into it. The height is only for drawing, it is never shown as a number.
 * Where the ground is not loaded yet, height 0 is used: tools draw on top of the ground
 * anyway (depth test off), so the mark is still seen.
 */
export function drawPosition(viewer: Cesium.Viewer, place: LonLat, lift = 2): Cesium.Cartesian3 {
  const carto = Cesium.Cartographic.fromDegrees(place.lon, place.lat)
  const ground = viewer.scene.mode === Cesium.SceneMode.SCENE2D ? 0 : (viewer.scene.globe.getHeight(carto) ?? 0)
  return Cesium.Cartesian3.fromDegrees(place.lon, place.lat, ground + lift, MARS_ELLIPSOID)
}

/**
 * Call `redraw` whenever the ground on screen has changed, so shapes can be put on it again.
 *
 * Why this is needed (measured 2026-11-15): the map draws coarse ground from far away and
 * detailed ground from near, and the two can differ by up to 100 m in height at the same
 * place (Trek's terrain is built from different height sources per zoom level). A shape that
 * took its height once is then under or above the ground that is shown: in a tilted view a
 * line seemed to cut through the air. So shapes take their heights again when the camera has
 * moved or new ground tiles have arrived, at most a few times per second.
 *
 * Returns a function that stops it.
 */
export function onGroundChanged(viewer: Cesium.Viewer, redraw: () => void): () => void {
  const { scene, camera } = viewer
  const MIN_GAP_MS = 180
  let last = 0
  let tilesChanged = true
  const seen = new Cesium.Cartesian3()
  const stops = [
    scene.globe.tileLoadProgressEvent.addEventListener(() => {
      tilesChanged = true
    }),
    scene.morphComplete.addEventListener(() => {
      tilesChanged = true
    }),
    scene.postRender.addEventListener(() => {
      const now = performance.now()
      if (now - last < MIN_GAP_MS) return
      const moved = !Cesium.Cartesian3.equalsEpsilon(camera.positionWC, seen, 0, 0.5)
      if (!moved && !tilesChanged) return
      last = now
      tilesChanged = false
      Cesium.Cartesian3.clone(camera.positionWC, seen)
      redraw()
    }),
  ]
  return () => {
    for (const stop of stops) stop()
  }
}

/** Screen position of a place, or undefined when it is behind the planet or off the map. */
export function screenPosition(viewer: Cesium.Viewer, place: LonLat): Cesium.Cartesian2 | undefined {
  return Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, drawPosition(viewer, place)) ?? undefined
}

/**
 * Distance between two places over the surface of the Mars sphere (radius 3,396.19 km), in
 * metres. It follows the curve of the planet. It does not add the ups and downs of the
 * ground, so a walk over hills is a little longer than this.
 */
export function surfaceDistanceM(a: LonLat, b: LonLat): number {
  const toRad = Math.PI / 180
  const dLat = (b.lat - a.lat) * toRad
  const dLon = (b.lon - a.lon) * toRad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2
  return 2 * MARS_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Points along the shortest way between two places (both ends included). */
export function pointsBetween(a: LonLat, b: LonLat, count: number): LonLat[] {
  const start = Cesium.Cartographic.fromDegrees(a.lon, a.lat)
  const end = Cesium.Cartographic.fromDegrees(b.lon, b.lat)
  const line = new Cesium.EllipsoidGeodesic(start, end, MARS_ELLIPSOID)
  const points: LonLat[] = []
  for (let i = 0; i <= count; i++) {
    const p = line.interpolateUsingFraction(i / count)
    points.push({ lon: Cesium.Math.toDegrees(p.longitude), lat: Cesium.Math.toDegrees(p.latitude) })
  }
  return points
}

/**
 * Fly to a top view of a place. `acrossM` is about how much ground is seen from side to side.
 * 3D: the camera height is counted from the ground the map draws at that place when it is
 * loaded (else from the Trek ground near Jezero, about 5.6 km above Cesium's zero). The
 * height only frames the view, it is never shown.
 */
export function flyToPlace(viewer: Cesium.Viewer, place: LonLat, acrossM: number) {
  const flat = viewer.scene.mode === Cesium.SceneMode.SCENE2D
  const ground = viewer.scene.globe.getHeight(Cesium.Cartographic.fromDegrees(place.lon, place.lat)) ?? 5640
  viewer.camera.flyTo({
    // In 2D the height given to flyTo becomes the width of the view.
    destination: Cesium.Cartesian3.fromDegrees(place.lon, place.lat, flat ? acrossM : ground + acrossM * 0.9, MARS_ELLIPSOID),
    orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0 },
    duration: 1.8,
  })
}

const number = (digits: number) => new Intl.NumberFormat('en', { minimumFractionDigits: digits, maximumFractionDigits: digits })

/**
 * The area inside a closed shape on the Mars sphere, in square metres. The corners are joined
 * in the order given. Good for shapes up to a few hundred kilometres across.
 */
export function surfaceAreaM2(corners: LonLat[]): number {
  if (corners.length < 3) return 0
  const toRad = Math.PI / 180
  let sum = 0
  corners.forEach((a, i) => {
    const b = corners[(i + 1) % corners.length]
    sum += (b.lon - a.lon) * toRad * (2 + Math.sin(a.lat * toRad) + Math.sin(b.lat * toRad))
  })
  return Math.abs((sum * MARS_RADIUS_M * MARS_RADIUS_M) / 2)
}

// Distances and areas as text live in units.ts (they follow the units setting).
export { formatArea, formatDistance } from './units'

/** "18.4446° N, 77.4509° E". */
export function formatPlace(place: LonLat): string {
  const lat = `${number(4).format(Math.abs(place.lat))}° ${place.lat >= 0 ? 'N' : 'S'}`
  return `${lat}, ${number(4).format(place.lon)}° E`
}
