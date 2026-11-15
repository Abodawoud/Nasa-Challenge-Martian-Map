// The Route tool (the "Marswalk" of PLAN.md section 8): pick a start and a goal, and the
// backend works out two walking routes on the USGS height map of Jezero.
//
//   Route A  "Shortest"      the least ground distance
//   Route B  "Lower-slope"   pays a growing price for steep ground, so it goes around it
//
// Route B is NEVER called "safest": slope is only one danger (PLAN.md D10).
// All numbers come from the backend (`/api/route`). This file asks for them, draws the two
// lines on the ground, and handles the clicks that set the two points.
import * as Cesium from 'cesium'
import { drawPosition, onGroundChanged, pickPlace, toolCursor, toolInput } from './mapTools'
import type { LonLat } from './mapTools'

// ------------------------------------------------------------------- the data

export interface RouteStats {
  distance_m: number
  flat_distance_m: number
  climb_m: number
  descent_m: number
  max_slope_deg: number
  mean_slope_deg: number
  steep_percent: number
  walk_time_s: number
  rover_time_s: number
}

export interface RouteResult {
  id: 'a' | 'b'
  name: string
  found: boolean
  reason: string | null
  /** [lon, lat, height in metres], from start to goal. */
  points: Array<[number, number, number]>
  /** slope_deg can be null at the very edge of the height map. */
  profile: { distance_m: number[]; elevation_m: number[]; slope_deg: Array<number | null> }
  stats: RouteStats | null
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
}

export interface RouteAnswer {
  start: { lon: number; lat: number; elevation_m: number }
  goal: { lon: number; lat: number; elevation_m: number }
  settings: RouteSettings
  routes: RouteResult[]
  compute_ms?: number
}

export type RouteFetch = { state: 'ready'; answer: RouteAnswer } | { state: 'error'; why: string }

/** Ask the backend for the two routes. */
export async function fetchRoutes(start: LonLat, goal: LonLat, signal: AbortSignal): Promise<RouteFetch> {
  const query = `from_lon=${start.lon.toFixed(6)}&from_lat=${start.lat.toFixed(6)}&to_lon=${goal.lon.toFixed(6)}&to_lat=${goal.lat.toFixed(6)}`
  try {
    const response = await fetch(`/api/route?${query}`, { signal })
    if (response.status === 503) return { state: 'error', why: 'The height map is still loading on the server. Try again in a few seconds.' }
    if (response.status === 422) {
      const body = (await response.json().catch(() => null)) as { code?: string; detail?: unknown } | null
      if (body?.code === 'same_point') return { state: 'error', why: 'The start and the goal are the same place. Move one of them.' }
      if (typeof body?.detail === 'string') return { state: 'error', why: body.detail }
      return { state: 'error', why: 'One of the two points is outside our height map. Routes work inside Jezero Crater only.' }
    }
    if (response.status === 404) return { state: 'error', why: 'The server has no route service yet. Start the backend again (docker compose up --build).' }
    if (!response.ok) return { state: 'error', why: `The server answered ${response.status}.` }
    return { state: 'ready', answer: (await response.json()) as RouteAnswer }
  } catch (error) {
    if (signal.aborted) throw error
    return { state: 'error', why: 'The server could not be reached.' }
  }
}

/** How each route is drawn and named on screen. A is the logo red, B is white. */
export const ROUTE_LOOK: Record<'a' | 'b', { color: string; edge: string; title: string; short: string }> = {
  a: { color: '#e8231f', edge: '#ffffff', title: 'Route A · Shortest', short: 'A · Shortest' },
  b: { color: '#ffffff', edge: '#0c1a3d', title: 'Route B · Lower-slope', short: 'B · Lower-slope' },
}

/** "2 h 35 min", "48 min". */
export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours >= 48) return `${Math.round(hours / 24)} days`
  return `${hours} h ${String(minutes % 60).padStart(2, '0')} min`
}

// --------------------------------------------------------- the tool on the map

const NAVY = Cesium.Color.fromCssColorString('#0c1a3d')
const CLICK_PX = 5
/** How long the routes take to draw themselves in when they arrive. */
const REVEAL_MS = 900
const LIFT_M = 4

interface DrawnRoute {
  id: 'a' | 'b'
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
  private revealStart = 0
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
  setRoutes(routes: Array<{ id: 'a' | 'b'; points: Array<[number, number, number]> }>) {
    for (const route of this.routes) this.viewer.entities.remove(route.entity)
    this.revealStart = performance.now()
    this.routes = routes
      .filter((route) => route.points.length > 1)
      .map((route) => {
        const look = route.id === 'a' ? { color: '#e8231f', edge: '#ffffff' } : { color: '#ffffff', edge: '#0c1a3d' }
        const color = Cesium.Color.fromCssColorString(look.color)
        const edge = Cesium.Color.fromCssColorString(look.edge)
        const drawn: DrawnRoute = {
          id: route.id,
          places: route.points.map(([lon, lat]) => ({ lon, lat })),
          positions: [],
          shown: true,
          entity: undefined as unknown as Cesium.Entity,
        }
        drawn.positions = drawn.places.map((place) => drawPosition(this.viewer, place, LIFT_M))
        drawn.entity = this.viewer.entities.add({
          polyline: {
            positions: new Cesium.CallbackProperty(() => this.revealed(drawn.positions), false),
            show: new Cesium.CallbackProperty(() => this.active && drawn.shown, false),
            // Route A is drawn above route B where they share the way, and a little wider.
            width: route.id === 'a' ? 5 : 6,
            arcType: Cesium.ArcType.NONE, // the points already follow the ground
            material: new Cesium.PolylineOutlineMaterialProperty({ color, outlineColor: edge, outlineWidth: 2 }),
            // Behind a hill: faint, so it reads as hidden but is not lost.
            depthFailMaterial: new Cesium.PolylineOutlineMaterialProperty({ color: color.withAlpha(0.35), outlineColor: edge.withAlpha(0.2), outlineWidth: 2 }),
            zIndex: route.id === 'a' ? 2 : 1,
          },
        })
        return drawn
      })
    this.animate()
  }

  /** Show or hide one of the two routes. */
  setRouteShown(id: 'a' | 'b', shown: boolean) {
    const route = this.routes.find((item) => item.id === id)
    if (route) route.shown = shown
    this.viewer.scene.requestRender()
  }

  destroy() {
    for (const stop of this.stops) stop()
    if (this.active) {
      toolInput.cursor = ''
      if (!this.viewer.isDestroyed()) this.viewer.scene.canvas.style.cursor = ''
    }
    if (this.viewer.isDestroyed()) return
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
