// The USGS geologic map of Jezero as map layers.
//
// Source: USGS Scientific Investigations Map 3464, "Geologic Map of Jezero Crater and the
// Nili Planum Region, Mars" (Sun and Stack, 2020), https://doi.org/10.3133/sim3464, read live
// from the USGS feature service behind their web map. Checked 2026-11-15: nine layers, open
// to requests from any page.
//
// Each layer is downloaded once, the first time it is switched on, already simplified by the
// server (points closer than 10 m to the line are left out: the map was made at 1:75,000).
// It is then painted as map tiles, exactly like the rover path (see pathLayer.ts for why):
// it lies on the ground in 2D and 3D, and a hidden layer costs nothing.
import * as Cesium from 'cesium'
import { MARS_TILING } from './mars'
import type { GeologySource, GeologyStyle } from './layers.config'

const SERVICE = 'https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Jezero_FeatureServiceFromPro/FeatureServer'
const TILE_SIZE = 512
const MARS_RADIUS_M = 3396190
/** The map's own projection: Transverse Mercator on the Mars sphere, centre line 77.5 E. */
const CENTRE_LON_DEG = 77.5
/** The server leaves out points closer than this to the line (metres). */
const SIMPLIFY_M = 10

/** Map metres (the service's projection) to Mars longitude and latitude in degrees. */
function toLonLat(x: number, y: number): [number, number] {
  const d = y / MARS_RADIUS_M
  const lon = CENTRE_LON_DEG + Cesium.Math.toDegrees(Math.atan2(Math.sinh(x / MARS_RADIUS_M), Math.cos(d)))
  const lat = Cesium.Math.toDegrees(Math.asin(Math.sin(d) / Math.cosh(x / MARS_RADIUS_M)))
  return [lon, lat]
}

/** One feature: its parts as [lon, lat, lon, lat, ...], the box around it, and its style. */
interface Shape {
  parts: Float64Array[]
  west: number
  south: number
  east: number
  north: number
  style: GeologyStyle
  /** The value of the layer's style attribute (for the units: the unit number). */
  key: string
}

interface ServiceFeature {
  attributes: Record<string, unknown>
  geometry?: { rings?: number[][][]; paths?: number[][][]; x?: number; y?: number }
}

const loaded = new Map<number, Promise<Shape[]>>()

/** Download one layer of the map. Asked for many times, downloaded once. */
export function loadGeology(source: GeologySource): Promise<Shape[]> {
  let pending = loaded.get(source.serviceLayer)
  if (!pending) {
    pending = (async () => {
      const shapes: Shape[] = []
      // The service gives at most 2000 features per answer, so ask page by page.
      for (let offset = 0; ; ) {
        const query = new URLSearchParams({
          where: '1=1',
          outFields: source.field ?? 'OBJECTID',
          returnGeometry: 'true',
          maxAllowableOffset: String(SIMPLIFY_M),
          geometryPrecision: '0',
          resultOffset: String(offset),
          f: 'json',
        })
        const response = await fetch(`${SERVICE}/${source.serviceLayer}/query?${query}`)
        if (!response.ok) throw new Error(`Geologic map layer ${source.serviceLayer}: HTTP ${response.status}`)
        const answer = (await response.json()) as { features?: ServiceFeature[]; exceededTransferLimit?: boolean; error?: { message: string } }
        if (answer.error || !answer.features) throw new Error(`Geologic map layer ${source.serviceLayer}: ${answer.error?.message ?? 'no features'}`)
        for (const feature of answer.features) {
          const key = source.field ? String(feature.attributes[source.field]) : ''
          const style = source.styles[key] ?? source.fallback
          const g = feature.geometry
          if (!style || !g) continue
          const lines = g.rings ?? g.paths ?? (g.x !== undefined && g.y !== undefined ? [[[g.x, g.y]]] : [])
          const shape: Shape = { parts: [], west: Infinity, south: Infinity, east: -Infinity, north: -Infinity, style, key }
          for (const line of lines) {
            const part = new Float64Array(line.length * 2)
            line.forEach(([x, y], i) => {
              const [lon, lat] = toLonLat(x, y)
              part[i * 2] = lon
              part[i * 2 + 1] = lat
              shape.west = Math.min(shape.west, lon)
              shape.east = Math.max(shape.east, lon)
              shape.south = Math.min(shape.south, lat)
              shape.north = Math.max(shape.north, lat)
            })
            shape.parts.push(part)
          }
          if (shape.parts.length) shapes.push(shape)
        }
        if (!answer.exceededTransferLimit || !answer.features.length) break
        offset += answer.features.length
      }
      if (!shapes.length) throw new Error(`Geologic map layer ${source.serviceLayer}: nothing to draw`)
      return shapes
    })()
    pending.catch(() => loaded.delete(source.serviceLayer)) // a later try downloads again
    loaded.set(source.serviceLayer, pending)
  }
  return pending
}

/**
 * The area of a layer that holds a place: its key (for the units layer: the unit number), or
 * undefined when the place is outside every area. Downloads the layer if it is not here yet.
 */
export async function geologyAt(source: GeologySource, lon: number, lat: number): Promise<string | undefined> {
  const shapes = await loadGeology(source)
  for (const shape of shapes) {
    if (lon < shape.west || lon > shape.east || lat < shape.south || lat > shape.north) continue
    // Even-odd rule over all rings: a place inside a hole of the area does not count.
    let inside = false
    for (const part of shape.parts) {
      for (let i = 0, j = part.length - 2; i < part.length; j = i, i += 2) {
        const xi = part[i]
        const yi = part[i + 1]
        const xj = part[j]
        const yj = part[j + 1]
        if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
      }
    }
    if (inside) return shape.key
  }
  return undefined
}

/** [west, south, east, north] of a loaded layer, degrees. */
export async function geologyBounds(source: GeologySource): Promise<[number, number, number, number]> {
  const shapes = await loadGeology(source)
  return [Math.min(...shapes.map((s) => s.west)), Math.min(...shapes.map((s) => s.south)), Math.max(...shapes.map((s) => s.east)), Math.max(...shapes.map((s) => s.north))]
}

/**
 * An imagery layer that paints the shapes. Shapes whose key is in `hidden` are left out
 * (the TOC can hide single kinds, for example one rock unit).
 */
export function createGeologyLayer(shapes: Shape[], source: GeologySource, hidden: ReadonlySet<string> = new Set()): Cesium.ImageryLayer {
  const PAD = 0.01
  const west = Math.min(...shapes.map((s) => s.west))
  const south = Math.min(...shapes.map((s) => s.south))
  const east = Math.max(...shapes.map((s) => s.east))
  const north = Math.max(...shapes.map((s) => s.north))
  // Shapes of one style are drawn together: fewer canvas calls, and one clean outline.
  const styles = [...new Set(shapes.map((s) => s.style))]

  const provider = new Cesium.UrlTemplateImageryProvider({
    url: `geology-${source.serviceLayer}/{z}/{x}/{y}`,
    tilingScheme: MARS_TILING,
    tileWidth: TILE_SIZE,
    tileHeight: TILE_SIZE,
    maximumLevel: 16,
    rectangle: Cesium.Rectangle.fromDegrees(west - PAD, south - PAD, east + PAD, north + PAD),
    credit: new Cesium.Credit('Geologic map: USGS SIM 3464 (Sun and Stack, 2020)'),
  })

  provider.requestImage = ((x: number, y: number, level: number) => {
    const tile = MARS_TILING.tileXYToRectangle(x, y, level)
    const tileWest = Cesium.Math.toDegrees(tile.west)
    const tileSouth = Cesium.Math.toDegrees(tile.south)
    const tileEast = Cesium.Math.toDegrees(tile.east)
    const tileNorth = Cesium.Math.toDegrees(tile.north)
    const perLon = TILE_SIZE / (tileEast - tileWest)
    const perLat = TILE_SIZE / (tileNorth - tileSouth)
    const reachLon = 12 / perLon
    const reachLat = 12 / perLat
    const inside = shapes.filter(
      (s) =>
        !hidden.has(s.key) && s.east >= tileWest - reachLon && s.west <= tileEast + reachLon && s.north >= tileSouth - reachLat && s.south <= tileNorth + reachLat,
    )
    // Nothing here: an empty image (never throw, never return a canvas: see imagery.ts).
    if (!inside.length) return createImageBitmap(new ImageData(1, 1))

    const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE)
    const ctx = canvas.getContext('2d')!
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    // Cesium wants tile images upside down (south at the top). See tint.ts.
    const px = (lon: number) => (lon - tileWest) * perLon
    const py = (lat: number) => (lat - tileSouth) * perLat

    for (const style of styles) {
      const group = inside.filter((s) => s.style === style)
      if (!group.length) continue
      ctx.beginPath()
      for (const shape of group) {
        for (const part of shape.parts) {
          if (source.geometry === 'point') {
            const cx = px(part[0])
            const cy = py(part[1])
            ctx.moveTo(cx + (style.radius ?? 3), cy)
            ctx.arc(cx, cy, style.radius ?? 3, 0, Math.PI * 2)
            continue
          }
          for (let i = 0; i < part.length; i += 2) {
            if (i === 0) ctx.moveTo(px(part[i]), py(part[i + 1]))
            else ctx.lineTo(px(part[i]), py(part[i + 1]))
          }
          if (source.geometry === 'polygon') ctx.closePath()
        }
      }
      if (style.fill) {
        ctx.fillStyle = style.fill
        ctx.fill('evenodd') // holes inside an area stay open
      }
      if (style.stroke) {
        const width = style.width ?? 1.5
        // A pale edge under dark lines keeps them readable on dark ground.
        if (style.halo) {
          ctx.setLineDash([])
          ctx.strokeStyle = 'rgba(255,255,255,0.55)'
          ctx.lineWidth = width + 2.5
          ctx.stroke()
        }
        ctx.setLineDash(style.dash ?? [])
        ctx.strokeStyle = style.stroke
        ctx.lineWidth = width
        ctx.stroke()
        ctx.setLineDash([])
      }
    }
    return Promise.resolve(canvas.transferToImageBitmap())
  }) as typeof provider.requestImage

  return new Cesium.ImageryLayer(provider)
}
