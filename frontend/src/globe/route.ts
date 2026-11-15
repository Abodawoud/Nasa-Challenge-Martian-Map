// The Route tool (the "Marswalk" of PLAN.md section 8).
//
// The idea: the backend CREATES several different routes between a start and a goal (the
// shortest, the fastest, one that goes around steep ground, and so on), then CHECKS them all
// with the same yardstick, scores them, leaves out the ones that add nothing, and names the
// best one with a reason. This file asks for them (`/api/routes`), adds the cautions that
// only the frontend's data can give (loose sand from the USGS rock map, radiation during the
// walk), draws the lines on the ground and handles the clicks that set the two points.
//
// No route is ever called "safe" or "safest": the data knows slope, bumps and pits at 20 m,
// not rocks, dust storms or solar storms (PLAN.md D10).
import * as Cesium from 'cesium'
import { drawPosition, onGroundChanged, pickPlace, toolCursor, toolInput } from './mapTools'
import type { LonLat } from './mapTools'
import { ROCK_UNITS_SOURCE } from './layers.config'
import { geologyAt } from './geologyLayer'

// ------------------------------------------------------------------- the data

export interface RouteStats {
  distance_m: number
  flat_distance_m: number
  climb_m: number
  descent_m: number
  max_slope_deg: number
  mean_slope_deg: number
  steep_percent: number
  rough_percent: number
  pit_m: number
  walk_time_s: number
  rover_time_s: number
}

export type Measure = 'distance' | 'time' | 'steepness' | 'climb' | 'smooth'

export interface RouteResult {
  id: string
  name: string
  /** One plain sentence: what this route was made to do. */
  idea: string
  /** Names of other route ideas that gave the same way, and were merged into this one. */
  also: string[]
  /** [lon, lat, height in metres], from start to goal. */
  points: Array<[number, number, number]>
  /** slope_deg can be null at the very edge of the height map. */
  profile: { distance_m: number[]; elevation_m: number[]; slope_deg: Array<number | null> }
  stats: RouteStats
  /** 0 to 100, higher is better. */
  score: number
  score_parts: { time: number; steep: number; climb: number; rough: number }
  rank: number
  recommended: boolean
  best_at: Measure[]
  warnings: string[]
}

export interface RouteSettings {
  resolution_m: number
  route_a_max_slope_deg: number
  route_b_max_slope_deg: number
  slope_penalty_deg: number
  steep_deg: number
  walk_speed_m_s: number
  suit_factor: number
  load_factor: number
  rover_speed_m_per_hour: number
  rough_m?: number
  pit_depth_m?: number
  corridor_m?: number
  fastest_method?: string
}

export interface RouteAnswer {
  start: { lon: number; lat: number; elevation_m: number }
  goal: { lon: number; lat: number; elevation_m: number }
  settings: RouteSettings
  weights: { time: number; steep: number; climb: number; rough: number }
  routes: RouteResult[]
  /** Ideas that found no way at all. */
  not_found?: Array<{ id: string; name: string; reason: string }>
  /** Ideas that found a way, but one that adds nothing to the others. */
  dropped?: Array<{ id: string; name: string; reason: string }>
  recommendation: { id: string; why: string } | null
  compute_ms?: number
}

export type Fetched<T> = { state: 'ready'; answer: T } | { state: 'error'; why: string }

async function ask<T>(url: string, signal: AbortSignal): Promise<Fetched<T>> {
  try {
    const response = await fetch(url, { signal })
    if (response.status === 503) return { state: 'error', why: 'The height map is still loading on the server. Try again in a few seconds.' }
    if (response.status === 422) {
      const body = (await response.json().catch(() => null)) as { code?: string; detail?: unknown } | null
      if (body?.code === 'same_point') return { state: 'error', why: 'The start and the goal are the same place. Move one of them.' }
      if (typeof body?.detail === 'string') return { state: 'error', why: body.detail.replace('end point', 'goal') }
      return { state: 'error', why: 'One of the two points is outside our height map. Routes work inside Jezero Crater only.' }
    }
    if (response.status === 404) return { state: 'error', why: 'The server does not have this service yet. Start the backend again (docker compose up --build).' }
    if (!response.ok) return { state: 'error', why: `The server answered ${response.status}.` }
    return { state: 'ready', answer: (await response.json()) as T }
  } catch (error) {
    if (signal.aborted) throw error
    return { state: 'error', why: 'The server could not be reached.' }
  }
}

/**
 * Ask the backend to create the routes and check them.
 *
 * One more rule is applied here, so no useless route is shown: a route that does not win any
 * measure (shortest, fastest, least steep, least climb, smoothest ground: one winner each)
 * and is neither the recommended route nor the runner-up is left out. It is listed under "left out" with
 * that reason. The routes that stay are numbered again, best first.
 */
export async function fetchRoutes(start: LonLat, goal: LonLat, signal: AbortSignal): Promise<Fetched<RouteAnswer>> {
  const result = await ask<RouteAnswer>(`/api/routes?from_lon=${start.lon.toFixed(6)}&from_lat=${start.lat.toFixed(6)}&to_lon=${goal.lon.toFixed(6)}&to_lat=${goal.lat.toFixed(6)}`, signal)
  if (result.state !== 'ready') return result
  const { answer } = result
  // Each measure has ONE winner: when several routes are tied, the best-ranked one takes it.
  const ranked = [...answer.routes].sort((x, y) => x.rank - y.rank)
  const wins = new Map<string, Measure[]>()
  for (const measure of ['distance', 'time', 'steepness', 'climb', 'smooth'] as Measure[]) {
    const winner = ranked.find((route) => route.best_at.includes(measure))
    if (winner) wins.set(winner.id, [...(wins.get(winner.id) ?? []), measure])
  }
  // Kept: the recommended route, the runner-up (the reason compares with it), and every
  // route that wins a measure.
  const keep = ranked.filter((route) => route.recommended || route.rank === 2 || wins.has(route.id))
  const out = ranked.filter((route) => !keep.includes(route))
  const routes = keep.map((route, i) => ({ ...route, rank: i + 1, best_at: wins.get(route.id) ?? [] }))
  return {
    state: 'ready',
    answer: {
      ...answer,
      routes,
      dropped: [...(answer.dropped ?? []), ...out.map((route) => ({ id: route.id, name: route.name, reason: 'Not the best at anything.' }))],
      // The reason counts the routes the backend made. Say the number that is shown.
      recommendation: answer.recommendation && { ...answer.recommendation, why: answer.recommendation.why.replace(/of the \d+ routes/, `of the ${routes.length} routes`) },
    },
  }
}

export interface ReachAnswer {
  bounds: [number, number, number, number]
  max_time_s: number
  unreachable_percent: number
  /** A PNG as a data URL: the walking time from the start to every place, in colour bands. */
  image: string
  /** The last band has `up_to_s: null`: everything further than the band before it. */
  legend: Array<{ up_to_s: number | null; color: string; label: string }>
}

/** The walking-time map: how long it takes to walk from a start to every place of Jezero. */
export function fetchReach(start: LonLat, signal: AbortSignal): Promise<Fetched<ReachAnswer>> {
  return ask<ReachAnswer>(`/api/reach?lon=${start.lon.toFixed(6)}&lat=${start.lat.toFixed(6)}`, signal)
}

/** The colour of each route idea on the map. Chosen to stay apart on Mars-coloured ground. */
const ROUTE_COLORS: Record<string, string> = {
  shortest: '#e8231f',
  fastest: '#ffd23f',
  lower_slope: '#ffffff',
  flattest: '#58d5e8',
  smooth_ground: '#8be28f',
  alternative: '#d0a8ff',
}
export const routeColor = (id: string) => ROUTE_COLORS[id] ?? '#ffffff'

/** "2 h 35 min", "48 min". */
export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours >= 48) return `${Math.round(hours / 24)} days`
  return `${hours} h ${String(minutes % 60).padStart(2, '0')} min`
}

// ---------------------------------------------------- cautions the frontend adds

/**
 * Cosmic radiation on the surface of Mars, as measured by the Curiosity rover's RAD
 * instrument in Gale Crater: about 0.64 millisievert per day (Hassler et al., Science, 2014).
 * Jezero is at a similar low height, and inside Jezero the level is nearly the same
 * everywhere, so what changes the dose of a walk is its length in time. An estimate.
 */
export const RADIATION_MSV_PER_DAY = 0.64
/** One Mars day (sol) in seconds. */
const SOL_S = 88775

/** The estimated dose of cosmic radiation during a walk, in millisievert. */
export function walkDoseMsv(walkTimeS: number): number {
  return (RADIATION_MSV_PER_DAY * walkTimeS) / SOL_S
}

/**
 * A usual spacewalk lasts up to about 8 hours: that is how long a suit's air, power and
 * cooling are planned for on Earth-orbit spacewalks. Our assumption for Mars suits.
 */
export const SPACEWALK_LIMIT_S = 8 * 3600

/** The USGS rock unit of loose, wind-shaped sand ("Eolian bedform unit"). */
const SAND_UNIT = '7'

/**
 * How many metres of a route lie on loose sand ripples, from the USGS geologic map (the same
 * data as the "Geologic units" layer). Loose sand is where rovers have got stuck on Mars.
 * Undefined when the rock map cannot be loaded. At most about 150 places are checked per
 * route, which is finer than the map's own detail.
 */
export async function sandOnRoute(route: RouteResult): Promise<number | undefined> {
  try {
    const { points, profile } = route
    const step = Math.max(1, Math.floor(points.length / 150))
    let sand = 0
    for (let i = 0; i < points.length; i += step) {
      const next = Math.min(points.length - 1, i + step)
      const unit = await geologyAt(ROCK_UNITS_SOURCE, points[i][0], points[i][1])
      if (unit === SAND_UNIT) sand += profile.distance_m[next] - profile.distance_m[i]
    }
    return sand
  } catch {
    return undefined
  }
}

// --------------------------------------------------------- the tool on the map

const NAVY = Cesium.Color.fromCssColorString('#0c1a3d')
const CLICK_PX = 5
/** How long the routes take to draw themselves in when they arrive. */
const REVEAL_MS = 900
const LIFT_M = 4

interface DrawnRoute {
  id: string
  places: LonLat[]
  positions: Cesium.Cartesian3[]
  shown: boolean
  entity: Cesium.Entity
}

export class RouteTool {
  private active = false
  private picking: 'start' | 'goal' | null = null
  private press: { x: number; y: number } | null = null
  private ends: { start: LonLat | null; goal: LonLat | null } = { start: null, goal: null }
  private endEntities: { start: Cesium.Entity | null; goal: Cesium.Entity | null } = { start: null, goal: null }
  private routes: DrawnRoute[] = []
  private selected = ''
  private revealStart = 0
  private reach: Cesium.ImageryLayer | null = null
  private reachWanted = 0
  private readonly viewer: Cesium.Viewer
  private readonly onPick: (which: 'start' | 'goal', place: LonLat) => void
  private readonly stops: Array<() => void> = []

  constructor(viewer: Cesium.Viewer, onPick: (which: 'start' | 'goal', place: LonLat) => void) {
    this.viewer = viewer
    this.onPick = onPick
    const canvas = viewer.scene.canvas
    canvas.addEventListener('pointerdown', this.onDown, true)
    canvas.addEventListener('pointerup', this.onUp, true)
    this.stops.push(
      () => canvas.removeEventListener('pointerdown', this.onDown, true),
      () => canvas.removeEventListener('pointerup', this.onUp, true),
      // Keep the lines and the two marks on the ground that is shown (see onGroundChanged).
      onGroundChanged(viewer, () => this.reground()),
    )
  }

  /** Off: clicks do nothing and the drawing is hidden (not deleted). On: it is back. */
  setActive(active: boolean) {
    this.active = active
    this.applyCursor()
    this.applyVisibility()
  }

  /** Which point the next click on the map sets, or null for none. */
  setPicking(which: 'start' | 'goal' | null) {
    this.picking = which
    this.applyCursor()
  }

  setEnds(start: LonLat | null, goal: LonLat | null) {
    this.ends = { start, goal }
    for (const which of ['start', 'goal'] as const) {
      const place = this.ends[which]
      const old = this.endEntities[which]
      if (old) this.viewer.entities.remove(old)
      this.endEntities[which] = place
        ? this.viewer.entities.add({
            position: drawPosition(this.viewer, place, LIFT_M),
            show: this.active,
            point: {
              pixelSize: 15,
              color: which === 'start' ? Cesium.Color.WHITE : Cesium.Color.fromCssColorString('#e8231f'),
              outlineColor: which === 'start' ? NAVY : Cesium.Color.WHITE,
              outlineWidth: 3,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            label: {
              text: which === 'start' ? 'Start' : 'Goal',
              font: '700 13px Inter, system-ui, sans-serif',
              fillColor: Cesium.Color.WHITE,
              style: Cesium.LabelStyle.FILL,
              showBackground: true,
              backgroundColor: NAVY.withAlpha(0.9),
              backgroundPadding: new Cesium.Cartesian2(7, 4),
              pixelOffset: new Cesium.Cartesian2(0, -24),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          })
        : null
    }
    this.viewer.scene.requestRender()
  }

  /** Draw the routes (they draw themselves in from the start), or none. */
  setRoutes(routes: Array<{ id: string; points: Array<[number, number, number]> }>, selected = '') {
    for (const route of this.routes) this.viewer.entities.remove(route.entity)
    this.revealStart = performance.now()
    this.selected = selected
    this.routes = routes
      .filter((route) => route.points.length > 1)
      .map((route) => {
        const color = Cesium.Color.fromCssColorString(routeColor(route.id))
        const drawn: DrawnRoute = {
          id: route.id,
          places: route.points.map(([lon, lat]) => ({ lon, lat })),
          positions: [],
          shown: true,
          entity: undefined as unknown as Cesium.Entity,
        }
        drawn.positions = drawn.places.map((place) => drawPosition(this.viewer, place, LIFT_M))
        const chosen = () => drawn.id === this.selected
        drawn.entity = this.viewer.entities.add({
          polyline: {
            positions: new Cesium.CallbackProperty(() => this.revealed(drawn.positions), false),
            show: new Cesium.CallbackProperty(() => this.active && drawn.shown, false),
            // The chosen route is wide and solid. The others are thin, so they do not hide it.
            width: new Cesium.CallbackProperty(() => (chosen() ? 7 : 3.5), false),
            arcType: Cesium.ArcType.NONE, // the points already follow the ground
            material: new Cesium.PolylineOutlineMaterialProperty({
              color: new Cesium.CallbackProperty(() => (chosen() ? color : color.withAlpha(0.75)), false),
              outlineColor: NAVY,
              outlineWidth: 2,
            }),
            // Behind a hill: faint, so it reads as hidden but is not lost.
            depthFailMaterial: new Cesium.PolylineOutlineMaterialProperty({ color: color.withAlpha(0.3), outlineColor: NAVY.withAlpha(0.2), outlineWidth: 2 }),
            zIndex: new Cesium.CallbackProperty(() => (chosen() ? 5 : 1), false),
          },
        })
        return drawn
      })
    this.animate()
  }

  /** The route that is drawn wide and on top. */
  setSelected(id: string) {
    this.selected = id
    this.viewer.scene.requestRender()
  }

  /** Show or hide one route. */
  setRouteShown(id: string, shown: boolean) {
    const route = this.routes.find((item) => item.id === id)
    if (route) route.shown = shown
    this.viewer.scene.requestRender()
  }

  /** Lay the walking-time map over the ground, or take it away with `null`. */
  async setReach(reach: { image: string; bounds: [number, number, number, number] } | null) {
    const wanted = ++this.reachWanted
    if (this.reach) {
      this.viewer.imageryLayers.remove(this.reach, true)
      this.reach = null
    }
    if (reach) {
      const provider = await Cesium.SingleTileImageryProvider.fromUrl(reach.image, { rectangle: Cesium.Rectangle.fromDegrees(...reach.bounds) })
      // A newer call came in while the picture was loading: this one is out of date.
      if (wanted !== this.reachWanted || this.viewer.isDestroyed()) return
      this.reach = this.viewer.imageryLayers.addImageryProvider(provider)
      this.reach.show = this.active
    }
    this.viewer.scene.requestRender()
  }

  destroy() {
    for (const stop of this.stops) stop()
    this.reachWanted++
    if (this.active) {
      toolInput.cursor = ''
      if (!this.viewer.isDestroyed()) this.viewer.scene.canvas.style.cursor = ''
    }
    if (this.viewer.isDestroyed()) return
    if (this.reach) this.viewer.imageryLayers.remove(this.reach, true)
    for (const route of this.routes) this.viewer.entities.remove(route.entity)
    for (const entity of Object.values(this.endEntities)) if (entity) this.viewer.entities.remove(entity)
  }

  // ---------------------------------------------------------------- private

  private applyCursor() {
    const cursor = this.active && this.picking ? toolCursor('route') : ''
    toolInput.cursor = cursor
    if (!this.viewer.isDestroyed()) this.viewer.scene.canvas.style.cursor = cursor
  }

  private applyVisibility() {
    if (this.viewer.isDestroyed()) return
    for (const entity of Object.values(this.endEntities)) if (entity) entity.show = this.active
    if (this.reach) this.reach.show = this.active
    this.viewer.scene.requestRender()
  }

  /** The part of a route that is drawn so far, while it draws itself in. */
  private revealed(positions: Cesium.Cartesian3[]): Cesium.Cartesian3[] {
    const t = Math.min(1, (performance.now() - this.revealStart) / REVEAL_MS)
    if (t >= 1) return positions
    const eased = 1 - (1 - t) ** 3
    return positions.slice(0, Math.max(2, Math.ceil(eased * positions.length)))
  }

  private animate = () => {
    if (this.viewer.isDestroyed()) return
    this.viewer.scene.requestRender()
    if (performance.now() - this.revealStart < REVEAL_MS) requestAnimationFrame(this.animate)
  }

  private reground() {
    if (this.viewer.isDestroyed()) return
    for (const route of this.routes) route.positions = route.places.map((place) => drawPosition(this.viewer, place, LIFT_M))
    for (const which of ['start', 'goal'] as const) {
      const place = this.ends[which]
      const entity = this.endEntities[which]
      if (place && entity) entity.position = new Cesium.ConstantPositionProperty(drawPosition(this.viewer, place, LIFT_M))
    }
    if (this.routes.length) this.viewer.scene.requestRender()
  }

  private position(event: MouseEvent) {
    const rect = this.viewer.scene.canvas.getBoundingClientRect()
    return new Cesium.Cartesian2(event.clientX - rect.left, event.clientY - rect.top)
  }

  private onDown = (event: PointerEvent) => {
    if (!this.active || !this.picking || event.button !== 0) return
    const position = this.position(event)
    this.press = { x: position.x, y: position.y }
  }

  private onUp = (event: PointerEvent) => {
    const press = this.press
    this.press = null
    if (!this.active || !this.picking || !press || event.button !== 0) return
    const position = this.position(event)
    // The map was dragged, not clicked.
    if (Math.hypot(position.x - press.x, position.y - press.y) > CLICK_PX) return
    const place = pickPlace(this.viewer, position)
    if (place) this.onPick(this.picking, place)
  }
}
