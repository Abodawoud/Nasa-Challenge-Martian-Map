// The path the Perseverance rover has driven, as a map layer.
//
// Source: NASA/JPL-Caltech, the Mars 2020 mission map (mars.nasa.gov). One GeoJSON file with
// one line per drive, in Mars longitude / latitude degrees. It is public, allows requests
// from any page, and is updated by the mission. It is downloaded once, the first time the
// layer is switched on.
//
// How it is drawn: as an imagery layer whose tiles we paint ourselves. Cesium asks for a tile,
// we draw the part of the path that crosses it on a small canvas. This has three advantages:
//   - the line lies exactly on the ground in 3D and in 2D (Cesium drapes it like a photo),
//     so no heights are needed (Trek terrain heights use another zero, see the skill notes)
//   - only tiles on screen are painted, and tiles away from the path cost nothing
//   - switching the layer off is `show = false`: no work at all while hidden
import * as Cesium from 'cesium'
import { MARS_TILING } from './mars'

export const ROVER_PATH_URL = 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json'

/** Tile size in pixels. 512 keeps the line sharp when the camera is close to the ground. */
const TILE_SIZE = 512
/** Points closer to the simplified line than this are dropped (degrees, about 0.3 m). */
const TOLERANCE_DEG = 5e-6
/** Line widths in tile pixels: a dark edge under a white line, readable on any ground. */
const EDGE_WIDTH = 7.5
const LINE_WIDTH = 3.5
const EDGE_COLOR = 'rgba(12, 26, 61, 0.85)' // logo navy
const LINE_COLOR = '#ffffff'

/** One drive: its points as [lon, lat, lon, lat, ...] and the box around them. */
interface Drive {
  points: Float64Array
  west: number
  south: number
  east: number
  north: number
}

export interface RoverPath {
  drives: Drive[]
  /** [west, south, east, north] of the whole path, degrees. */
  bounds: [number, number, number, number]
  /** Where the rover was at the end of the last drive in the file. */
  last: { lon: number; lat: number }
  /** The last Mars day (sol) in the file. */
  lastSol: number
  /** Sum of the drive lengths given in the file, in metres. */
  lengthM: number
  driveCount: number
}

interface TraverseFile {
  features: Array<{
    properties: { sol?: number; length?: number }
    geometry: { type: string; coordinates: number[][] | number[][][] }
  }>
}

/** Douglas-Peucker: keep only the points that change the shape by more than the tolerance. */
function simplify(points: number[][], tolerance: number): number[][] {
  if (points.length <= 2) return points
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const stack: Array<[number, number]> = [[0, points.length - 1]]
  while (stack.length) {
    const [first, last] = stack.pop()!
    const [ax, ay] = points[first]
    const [bx, by] = points[last]
    const dx = bx - ax
    const dy = by - ay
    const length = Math.hypot(dx, dy)
    let worst = 0
    let index = -1
    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i]
      const distance = length === 0 ? Math.hypot(px - ax, py - ay) : Math.abs(dy * (px - ax) - dx * (py - ay)) / length
      if (distance > worst) {
        worst = distance
        index = i
      }
    }
    if (index !== -1 && worst > tolerance) {
      keep[index] = 1
      stack.push([first, index], [index, last])
    }
  }
  return points.filter((_, i) => keep[i])
}

let pending: Promise<RoverPath> | undefined

/** Download and prepare the path. Asked for many times, downloaded once. */
export function loadRoverPath(): Promise<RoverPath> {
  pending ??= fetch(ROVER_PATH_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`Rover path: HTTP ${response.status}`)
      return response.json() as Promise<TraverseFile>
    })
    .then((file) => {
      const drives: Drive[] = []
      const bounds: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity]
      let lastSol = 0
      let lengthM = 0
      let last = { lon: 0, lat: 0 }
      for (const feature of file.features) {
        const { type, coordinates } = feature.geometry
        const lines = type === 'LineString' ? [coordinates as number[][]] : type === 'MultiLineString' ? (coordinates as number[][][]) : []
        lengthM += feature.properties.length ?? 0
        for (const line of lines) {
          const simple = simplify(line, TOLERANCE_DEG)
          if (simple.length < 2) continue
          const points = new Float64Array(simple.length * 2)
          const drive: Drive = { points, west: Infinity, south: Infinity, east: -Infinity, north: -Infinity }
          simple.forEach(([lon, lat], i) => {
            points[i * 2] = lon
            points[i * 2 + 1] = lat
            drive.west = Math.min(drive.west, lon)
            drive.east = Math.max(drive.east, lon)
            drive.south = Math.min(drive.south, lat)
            drive.north = Math.max(drive.north, lat)
          })
          drives.push(drive)
          bounds[0] = Math.min(bounds[0], drive.west)
          bounds[1] = Math.min(bounds[1], drive.south)
          bounds[2] = Math.max(bounds[2], drive.east)
          bounds[3] = Math.max(bounds[3], drive.north)
          // The file is in time order: the newest sol holds the rover's latest position.
          if ((feature.properties.sol ?? 0) >= lastSol) {
            lastSol = feature.properties.sol ?? lastSol
            last = { lon: simple[simple.length - 1][0], lat: simple[simple.length - 1][1] }
          }
        }
      }
      if (!drives.length) throw new Error('Rover path: the file has no lines')
      return { drives, bounds, last, lastSol, lengthM, driveCount: file.features.length }
    })
    .catch((error) => {
      pending = undefined // a later try downloads again
      throw error
    })
  return pending
}

/** An imagery layer that paints the path. Add it on top of the photo layers. */
export function createRoverPathLayer(path: RoverPath): Cesium.ImageryLayer {
  // A little room around the path, so the line's width is not cut at the edge.
  const PAD = 0.002
  const [west, south, east, north] = path.bounds
  // A standard provider gives Cesium everything it expects. Only the tile source is ours.
  const provider = new Cesium.UrlTemplateImageryProvider({
    url: 'rover-path/{z}/{x}/{y}',
    tilingScheme: MARS_TILING,
    tileWidth: TILE_SIZE,
    tileHeight: TILE_SIZE,
    maximumLevel: 18,
    rectangle: Cesium.Rectangle.fromDegrees(west - PAD, south - PAD, east + PAD, north + PAD),
    credit: new Cesium.Credit('Rover path: NASA/JPL-Caltech'),
  })

  provider.requestImage = ((x: number, y: number, level: number) => {
    const tile = MARS_TILING.tileXYToRectangle(x, y, level)
    const tileWest = Cesium.Math.toDegrees(tile.west)
    const tileSouth = Cesium.Math.toDegrees(tile.south)
    const perLon = TILE_SIZE / (Cesium.Math.toDegrees(tile.east) - tileWest)
    const perLat = TILE_SIZE / (Cesium.Math.toDegrees(tile.north) - tileSouth)
    // How far outside the tile a line can still reach into it with its width.
    const reachLon = EDGE_WIDTH / perLon
    const reachLat = EDGE_WIDTH / perLat
    const tileEast = Cesium.Math.toDegrees(tile.east)
    const tileNorth = Cesium.Math.toDegrees(tile.north)
    const inside = path.drives.filter(
      (d) => d.east >= tileWest - reachLon && d.west <= tileEast + reachLon && d.north >= tileSouth - reachLat && d.south <= tileNorth + reachLat,
    )
    // Nothing here: an empty image (never throw, never return a canvas: see imagery.ts).
    if (!inside.length) return createImageBitmap(new ImageData(1, 1))

    const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE)
    const ctx = canvas.getContext('2d')!
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.beginPath()
    for (const drive of inside) {
      const { points } = drive
      for (let i = 0; i < points.length; i += 2) {
        const px = (points[i] - tileWest) * perLon
        // Cesium wants its tile images upside down (south at the top), like the photo tiles
        // it loads itself. See tint.ts.
        const py = (points[i + 1] - tileSouth) * perLat
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
    }
    ctx.strokeStyle = EDGE_COLOR
    ctx.lineWidth = EDGE_WIDTH
    ctx.stroke()
    ctx.strokeStyle = LINE_COLOR
    ctx.lineWidth = LINE_WIDTH
    ctx.stroke()
    return Promise.resolve(canvas.transferToImageBitmap())
  }) as typeof provider.requestImage

  return new Cesium.ImageryLayer(provider)
}
