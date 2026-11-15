// The Identify tool: click a place, get what is known about it.
//
// Where each fact comes from:
//   height and slope   our backend, from the USGS height map of Jezero (20 m per pixel)
//   rock type          the USGS geologic map (the same data as the "Geologic units" layer)
//   rover              NASA's Mars 2020 drive path, and NASA's photo feed for that Mars day
// A fact that is not available at the place says so. Nothing is filled in with a guess.
//
// Also here: waypoints (places the user saved). They are kept in the browser's own storage,
// so they are still there after a reload, on this computer only.
import * as Cesium from 'cesium'
import { ROCK_UNITS_SOURCE, ROCK_UNIT_INFO } from './layers.config'
import { geologyAt, geologyBounds } from './geologyLayer'
import { loadRoverPath, nearestDrive } from './pathLayer'
import { PERSEVERANCE_LANDING } from './mars'
import { drawPosition, onGroundChanged, pickPlace, toolCursor, toolInput } from './mapTools'
import type { LonLat } from './mapTools'

// ------------------------------------------------------------------ the facts

export type Fact<T> = { state: 'loading' } | { state: 'ready'; value: T } | { state: 'none'; why: string } | { state: 'error'; why: string }

export interface GroundFact {
  elevationM: number
  /** null at the very edge of the height map, where the slope cannot be worked out. */
  slopeDeg: number | null
  resolutionM: number
  source: string
  /** Lowest and highest height of the whole height map (Jezero), for the scale chart. */
  areaMinM: number
  areaMaxM: number
  /** A cut through the ground from west to east through the place. */
  profile: { halfWidthM: number; stepM: number; heightsM: Array<number | null> }
}

interface PointAnswer {
  inside: boolean
  elevation_m?: number | null
  slope_deg?: number | null
  resolution_m?: number
  source?: string
  area_min_m?: number
  area_max_m?: number
  profile?: { half_width_m: number; step_m: number; heights_m: Array<number | null> }
}

/** Height and slope from the backend (`/api/point`). */
export async function groundAt(place: LonLat, signal?: AbortSignal): Promise<Fact<GroundFact>> {
  try {
    const response = await fetch(`/api/point?lon=${place.lon.toFixed(6)}&lat=${place.lat.toFixed(6)}`, { signal })
    if (response.status === 503) return { state: 'error', why: 'The height map is still loading on the server. Click again in a few seconds.' }
    if (!response.ok) return { state: 'error', why: `The server answered ${response.status}.` }
    const data = (await response.json()) as PointAnswer
    if (!data.inside || data.elevation_m === undefined || data.elevation_m === null) {
      return { state: 'none', why: 'No height data here. Our height map covers Jezero Crater only.' }
    }
    return {
      state: 'ready',
      value: {
        elevationM: data.elevation_m,
        slopeDeg: data.slope_deg ?? null,
        resolutionM: data.resolution_m ?? 20,
        source: data.source ?? 'USGS',
        areaMinM: data.area_min_m ?? data.elevation_m,
        areaMaxM: data.area_max_m ?? data.elevation_m,
        profile: { halfWidthM: data.profile?.half_width_m ?? 0, stepM: data.profile?.step_m ?? 0, heightsM: data.profile?.heights_m ?? [] },
      },
    }
  } catch (error) {
    if (signal?.aborted) throw error
    return { state: 'error', why: 'The server could not be reached.' }
  }
}

let landingHeight: Promise<number | undefined> | undefined

/** The height of the Perseverance landing site from the same height map, asked once. */
export function landingSiteHeightM(): Promise<number | undefined> {
  landingHeight ??= groundAt({ lon: PERSEVERANCE_LANDING.lon, lat: PERSEVERANCE_LANDING.lat }).then((fact) => {
    if (fact.state !== 'ready') landingHeight = undefined // try again next time
    return fact.state === 'ready' ? fact.value.elevationM : undefined
  })
  return landingHeight
}

/** The slope bands of the chart. Our own bands: they describe the angle, they are not a safety rating. */
export const SLOPE_BANDS: Array<{ upTo: number; word: string; color: string }> = [
  { upTo: 5, word: 'Nearly flat', color: '#2f9e6b' },
  { upTo: 15, word: 'Gentle to moderate', color: '#d9b530' },
  { upTo: 25, word: 'Steep', color: '#e07b2a' },
  { upTo: 40, word: 'Very steep', color: '#c8321f' },
]

/** Our word for a slope, from SLOPE_BANDS. */
export function slopeWord(degrees: number): string {
  return (SLOPE_BANDS.find((band) => degrees < band.upTo) ?? SLOPE_BANDS[SLOPE_BANDS.length - 1]).word
}

export interface RockFact {
  label: string
  hint: string
  color: string
}

/** The rock unit at a place, from the USGS geologic map. */
export async function rockAt(place: LonLat): Promise<Fact<RockFact>> {
  try {
    const [west, south, east, north] = await geologyBounds(ROCK_UNITS_SOURCE)
    if (place.lon < west || place.lon > east || place.lat < south || place.lat > north) {
      return { state: 'none', why: 'Outside the USGS geologic map (it covers Jezero and the land west of it).' }
    }
    const unit = await geologyAt(ROCK_UNITS_SOURCE, place.lon, place.lat)
    const info = unit === undefined ? undefined : ROCK_UNIT_INFO[unit]
    if (!info) return { state: 'none', why: 'The USGS map has no rock unit at this place.' }
    return { state: 'ready', value: info }
  } catch {
    return { state: 'error', why: 'The USGS geologic map could not be loaded.' }
  }
}

export interface RoverPhoto {
  small: string
  large: string
  caption: string
  /** "Mastcam-Z mast camera" or "Navigation camera". */
  camera: string
}

export interface RoverFact {
  sol: number
  distanceM: number
  /** Photos the rover took on that sol. Empty when the place is far from the path. */
  photos: RoverPhoto[]
}

/** Photos are shown only when the rover drove this near to the place (metres). */
export const PHOTO_RANGE_M = 300

interface FeedImage {
  image_files?: { small?: string; large?: string }
  caption?: string
  sample_type?: string
  extended?: { mastEl?: string }
}

/**
 * Photos of one camera on one sol, from NASA's public feed of raw rover photos
 * (the data behind https://mars.nasa.gov/mars2020/multimedia/raw-images/).
 */
async function cameraPhotos(sol: number, instrument: string, camera: string, keep: number, signal: AbortSignal): Promise<RoverPhoto[]> {
  const url = `https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&sol=${sol}&num=50&page=0&order=sol+desc&search=%7C${instrument}`
  try {
    const response = await fetch(url, { signal })
    const feed = (await response.json()) as { images?: FeedImage[] }
    const usable = (feed.images ?? []).filter(
      // Full pictures only (no small thumbnails), and only where the camera looked level or
      // down: the feed also holds photos of the sky and the sun (mast elevation above 5 degrees).
      (image) => image.image_files?.small && image.image_files.large && image.sample_type === 'Full' && Number(image.extended?.mastEl ?? 0) <= 5,
    )
    // Spread the choice over the sol, so the photos are not four frames of the same view.
    const step = Math.max(1, Math.floor(usable.length / keep))
    return usable
      .filter((_, i) => i % step === 0)
      .slice(0, keep)
      .map((image) => ({ small: image.image_files!.small!, large: image.image_files!.large!, caption: (image.caption ?? '').replace(/\s+/g, ' ').trim(), camera }))
  } catch (error) {
    if (signal.aborted) throw error
    return [] // no photos from this camera: the other facts are still true
  }
}

/** The nearest drive of the rover, and photos from that Mars day when it is near. */
export async function roverAt(place: LonLat, signal: AbortSignal): Promise<Fact<RoverFact>> {
  try {
    const path = await loadRoverPath()
    const [west, south, east, north] = path.bounds
    // Far from Jezero there is nothing useful to say about the rover.
    if (place.lon < west - 1 || place.lon > east + 1 || place.lat < south - 1 || place.lat > north + 1) {
      return { state: 'none', why: 'The rover is in Jezero Crater, far from this place.' }
    }
    const { sol, distanceM } = nearestDrive(path, place.lon, place.lat)
    let photos: RoverPhoto[] = []
    if (distanceM <= PHOTO_RANGE_M) {
      // Mastcam-Z first (the rover's main mast camera: raw frames, some grey, some colour), then the grey
      // navigation camera, which looks at the ground around the rover.
      const [colour, navigation] = await Promise.all([
        cameraPhotos(sol, 'MCZ_LEFT', 'Mastcam-Z mast camera', 6, signal),
        cameraPhotos(sol, 'NAVCAM_LEFT', 'Navigation camera', 4, signal),
      ])
      photos = [...colour, ...navigation]
    }
    return { state: 'ready', value: { sol, distanceM, photos } }
  } catch (error) {
    if (signal.aborted) throw error
    return { state: 'error', why: 'The rover path could not be loaded from NASA.' }
  }
}

// ------------------------------------------------------------------ waypoints

export interface Waypoint extends LonLat {
  id: string
  name: string
}

const STORAGE_KEY = 'martian-map-waypoints'

function readWaypoints(): Waypoint[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as Waypoint[]
    return Array.isArray(saved) ? saved.filter((w) => typeof w.lon === 'number' && typeof w.lat === 'number' && typeof w.name === 'string') : []
  } catch {
    return []
  }
}

let waypoints = readWaypoints()
const listeners = new Set<() => void>()

function setWaypoints(next: Waypoint[]) {
  waypoints = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage full or blocked: the waypoints still work until the page is closed.
  }
  for (const listener of listeners) listener()
}

export const waypointStore = {
  get: () => waypoints,
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  add(place: LonLat, name: string) {
    setWaypoints([...waypoints, { id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`, name: name.trim() || `Waypoint ${waypoints.length + 1}`, lon: place.lon, lat: place.lat }])
  },
  remove(id: string) {
    setWaypoints(waypoints.filter((w) => w.id !== id))
  },
}

// ------------------------------------------------------- the tool on the map

const NAVY = Cesium.Color.fromCssColorString('#0c1a3d')
const CLICK_PX = 5

/**
 * Listens for clicks on the map while active, and draws the picked place and the waypoints.
 * A press that moves is a drag of the map, not a pick.
 */
export class IdentifyTool {
  private active = false
  private press: { x: number; y: number } | null = null
  private picked: LonLat | null = null
  private pickedEntity: Cesium.Entity | null = null
  private waypointEntities: Cesium.Entity[] = []
  private readonly viewer: Cesium.Viewer
  private readonly onPick: (place: LonLat) => void
  private readonly stops: Array<() => void> = []

  constructor(viewer: Cesium.Viewer, onPick: (place: LonLat) => void) {
    this.viewer = viewer
    this.onPick = onPick
    const canvas = viewer.scene.canvas
    canvas.addEventListener('pointerdown', this.onDown, true)
    canvas.addEventListener('pointerup', this.onUp, true)
    this.stops.push(
      () => canvas.removeEventListener('pointerdown', this.onDown, true),
      () => canvas.removeEventListener('pointerup', this.onUp, true),
      waypointStore.subscribe(() => this.drawWaypoints()),
      // Keep the marks on the ground that is shown (it changes with zoom, see onGroundChanged).
      onGroundChanged(viewer, () => this.reground()),
    )
    this.drawWaypoints()
  }

  setActive(active: boolean) {
    this.active = active
    toolInput.cursor = active ? toolCursor('identify') : ''
    this.viewer.scene.canvas.style.cursor = toolInput.cursor
    // Switched off: the picked mark and the waypoints are hidden, not deleted.
    if (this.pickedEntity) this.pickedEntity.show = active
    for (const entity of this.waypointEntities) entity.show = active
    this.viewer.scene.requestRender()
  }

  /** Remove the mark of the picked place. */
  clearPick() {
    this.picked = null
    this.drawPicked()
  }

  destroy() {
    for (const stop of this.stops) stop()
    if (this.active) {
      toolInput.cursor = ''
      this.viewer.scene.canvas.style.cursor = ''
    }
    if (this.viewer.isDestroyed()) return
    if (this.pickedEntity) this.viewer.entities.remove(this.pickedEntity)
    for (const entity of this.waypointEntities) this.viewer.entities.remove(entity)
  }

  private position(event: MouseEvent) {
    const rect = this.viewer.scene.canvas.getBoundingClientRect()
    return new Cesium.Cartesian2(event.clientX - rect.left, event.clientY - rect.top)
  }

  private onDown = (event: PointerEvent) => {
    if (!this.active || event.button !== 0) return
    const position = this.position(event)
    this.press = { x: position.x, y: position.y }
  }

  private onUp = (event: PointerEvent) => {
    const press = this.press
    this.press = null
    if (!this.active || !press || event.button !== 0) return
    const position = this.position(event)
    if (Math.hypot(position.x - press.x, position.y - press.y) > CLICK_PX) return
    const place = pickPlace(this.viewer, position)
    if (!place) return
    this.picked = place
    this.drawPicked()
    this.onPick(place)
  }

  /** Move the existing marks to the current ground height. Nothing is removed or added. */
  private reground() {
    const { viewer } = this
    if (viewer.isDestroyed()) return
    if (this.picked && this.pickedEntity) this.pickedEntity.position = new Cesium.ConstantPositionProperty(drawPosition(viewer, this.picked, 3))
    const waypoints = waypointStore.get()
    this.waypointEntities.forEach((entity, i) => {
      if (waypoints[i]) entity.position = new Cesium.ConstantPositionProperty(drawPosition(viewer, waypoints[i], 3))
    })
  }

  private drawPicked() {
    const { viewer } = this
    if (viewer.isDestroyed()) return
    if (this.pickedEntity) viewer.entities.remove(this.pickedEntity)
    this.pickedEntity = null
    if (this.picked) {
      this.pickedEntity = viewer.entities.add({
        position: drawPosition(viewer, this.picked, 3),
        point: { pixelSize: 14, color: Cesium.Color.fromCssColorString('#ffd23f'), outlineColor: NAVY, outlineWidth: 3, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        show: this.active,
      })
    }
    viewer.scene.requestRender()
  }

  private drawWaypoints() {
    const { viewer } = this
    if (viewer.isDestroyed()) return
    for (const entity of this.waypointEntities) viewer.entities.remove(entity)
    this.waypointEntities = waypointStore.get().map((waypoint) =>
      viewer.entities.add({
        position: drawPosition(viewer, waypoint, 3),
        show: this.active,
        point: { pixelSize: 11, color: Cesium.Color.WHITE, outlineColor: NAVY, outlineWidth: 3, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: {
          text: waypoint.name,
          font: '600 12px Inter, system-ui, sans-serif',
          fillColor: Cesium.Color.WHITE,
          style: Cesium.LabelStyle.FILL,
          showBackground: true,
          backgroundColor: NAVY.withAlpha(0.88),
          backgroundPadding: new Cesium.Cartesian2(6, 4),
          pixelOffset: new Cesium.Cartesian2(0, -20),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3_000_000),
        },
      }),
    )
    viewer.scene.requestRender()
  }
}
