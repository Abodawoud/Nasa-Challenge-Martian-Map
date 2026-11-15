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

const number = (digits: number) => new Intl.NumberFormat('en', { minimumFractionDigits: digits, maximumFractionDigits: digits })

/** "86 m", "1.24 km", "1,530 km". */
export function formatDistance(metres: number): string {
  if (metres < 1000) return `${number(metres < 100 ? 1 : 0).format(metres)} m`
  const km = metres / 1000
  return `${number(km < 100 ? 2 : 0).format(km)} km`
}

/** "18.4446° N, 77.4509° E". */
export function formatPlace(place: LonLat): string {
  const lat = `${number(4).format(Math.abs(place.lat))}° ${place.lat >= 0 ? 'N' : 'S'}`
  return `${lat}, ${number(4).format(place.lon)}° E`
}
