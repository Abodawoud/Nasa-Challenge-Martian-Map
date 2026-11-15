// The Measure tool: click places on the map, see the distance of every part and the total.
// Works in 2D and 3D.
//
//   click on the map        add a point
//   drag a point            move it
//   right click on a point  delete it (also possible from the panel)
//
// The line is drawn over the ground the map shows, and always on top of it (so a hill never
// hides it). The numbers are distances over the Mars sphere, see surfaceDistanceM().
import * as Cesium from 'cesium'
import { drawPosition, formatDistance, pickPlace, pointsBetween, screenPosition, surfaceDistanceM, toolInput } from './mapTools'
import type { LonLat } from './mapTools'

const NAVY = Cesium.Color.fromCssColorString('#0c1a3d')
const LINE = Cesium.Color.fromCssColorString('#ffd23f') // a warm yellow: readable on Mars tan and on dark ground
/** How near (pixels) a click must be to a point to grab it. */
const GRAB_PX = 14
/** A press that moves less than this (pixels) is a click, not a drag. */
const CLICK_PX = 5
/** Pieces per segment, so the line follows the ground and the curve of the planet. */
const PIECES = 48

export interface Measurement {
  points: LonLat[]
  /** Distance of each part: segments[i] is from point i to point i + 1, in metres. */
  segments: number[]
  totalM: number
}

export class MeasureTool {
  private points: LonLat[] = []
  private active = false
  private entities: Cesium.Entity[] = []
  private press: { x: number; y: number; point: number } | null = null
  private dragging = -1
  private readonly viewer: Cesium.Viewer
  private readonly onChange: (measurement: Measurement) => void
  private readonly removeTerrainListener: () => void

  constructor(viewer: Cesium.Viewer, onChange: (measurement: Measurement) => void) {
    this.viewer = viewer
    this.onChange = onChange
    const canvas = viewer.scene.canvas
    // "capture": these run before the camera's own listeners, so a point can be grabbed
    // before the map starts to slide.
    canvas.addEventListener('pointerdown', this.onDown, true)
    canvas.addEventListener('pointermove', this.onMove, true)
    canvas.addEventListener('pointerup', this.onUp, true)
    canvas.addEventListener('pointercancel', this.onCancel, true)
    canvas.addEventListener('contextmenu', this.onContextMenu, true)
    // After a 2D / 3D switch the drawing heights change: draw again.
    this.removeTerrainListener = viewer.scene.morphComplete.addEventListener(() => this.draw())
  }

  /** Only while active do clicks on the map add points. The drawing stays either way. */
  setActive(active: boolean) {
    this.active = active
    if (!active) this.endDrag()
    toolInput.cursor = active ? 'crosshair' : ''
    this.viewer.scene.canvas.style.cursor = toolInput.cursor
  }

  get measurement(): Measurement {
    const segments = this.points.slice(1).map((point, i) => surfaceDistanceM(this.points[i], point))
    return { points: [...this.points], segments, totalM: segments.reduce((sum, d) => sum + d, 0) }
  }

  removePoint(index: number) {
    this.points.splice(index, 1)
    this.changed()
  }

  removeLast() {
    this.points.pop()
    this.changed()
  }

  clear() {
    this.points = []
    this.changed()
  }

  destroy() {
    const canvas = this.viewer.scene.canvas
    canvas.removeEventListener('pointerdown', this.onDown, true)
    canvas.removeEventListener('pointermove', this.onMove, true)
    canvas.removeEventListener('pointerup', this.onUp, true)
    canvas.removeEventListener('pointercancel', this.onCancel, true)
    canvas.removeEventListener('contextmenu', this.onContextMenu, true)
    this.removeTerrainListener()
    this.endDrag()
    if (!this.viewer.isDestroyed()) {
      for (const entity of this.entities) this.viewer.entities.remove(entity)
      if (this.active) {
        toolInput.cursor = ''
        canvas.style.cursor = ''
      }
    }
    this.entities = []
  }

  // ------------------------------------------------------------------ mouse

  private position(event: MouseEvent) {
    const rect = this.viewer.scene.canvas.getBoundingClientRect()
    return new Cesium.Cartesian2(event.clientX - rect.left, event.clientY - rect.top)
  }

  /** The point under the cursor, or -1. */
  private pointAt(position: Cesium.Cartesian2): number {
    let best = -1
    let bestDistance = GRAB_PX
    this.points.forEach((point, i) => {
      const screen = screenPosition(this.viewer, point)
      if (!screen) return
      const distance = Cesium.Cartesian2.distance(screen, position)
      if (distance <= bestDistance) {
        best = i
        bestDistance = distance
      }
    })
    return best
  }

  private onDown = (event: PointerEvent) => {
    if (!this.active || event.button !== 0 || event.ctrlKey) return
    const position = this.position(event)
    const point = this.pointAt(position)
    this.press = { x: position.x, y: position.y, point }
    if (point >= 0) {
      // Grabbed a point: the camera must not move while it is dragged.
      this.dragging = point
      toolInput.dragging = true
      this.viewer.scene.screenSpaceCameraController.enableInputs = false
      this.viewer.scene.canvas.setPointerCapture(event.pointerId)
      event.stopPropagation()
    }
  }

  private onMove = (event: PointerEvent) => {
    if (this.dragging < 0) return
    const place = pickPlace(this.viewer, this.position(event))
    if (!place) return
    this.points[this.dragging] = place
    this.changed()
    event.stopPropagation()
  }

  private onUp = (event: PointerEvent) => {
    const press = this.press
    this.press = null
    if (this.dragging >= 0) {
      this.endDrag()
      event.stopPropagation()
      return
    }
    if (!this.active || !press || event.button !== 0) return
    const position = this.position(event)
    // The map was dragged, not clicked: no new point.
    if (Math.hypot(position.x - press.x, position.y - press.y) > CLICK_PX) return
    const place = pickPlace(this.viewer, position)
    if (!place) return
    this.points.push(place)
    this.changed()
  }

  private onCancel = () => {
    this.press = null
    this.endDrag()
  }

  private onContextMenu = (event: MouseEvent) => {
    if (!this.active) return
    const point = this.pointAt(this.position(event))
    if (point < 0) return
    event.preventDefault()
    event.stopPropagation()
    this.removePoint(point)
  }

  private endDrag() {
    if (this.dragging < 0 && !toolInput.dragging) return
    this.dragging = -1
    toolInput.dragging = false
    if (!this.viewer.isDestroyed()) this.viewer.scene.screenSpaceCameraController.enableInputs = true
  }

  // ---------------------------------------------------------------- drawing

  private changed() {
    this.draw()
    this.onChange(this.measurement)
  }

  private draw() {
    const { viewer } = this
    if (viewer.isDestroyed()) return
    for (const entity of this.entities) viewer.entities.remove(entity)
    this.entities = []
    const add = (options: Cesium.Entity.ConstructorOptions) => this.entities.push(viewer.entities.add(options))
    const { points, segments, totalM } = this.measurement
    const label = (text: string, big = false): Cesium.LabelGraphics.ConstructorOptions => ({
      text,
      font: `${big ? 700 : 600} ${big ? 14 : 12}px Inter, system-ui, sans-serif`,
      fillColor: Cesium.Color.WHITE,
      style: Cesium.LabelStyle.FILL,
      showBackground: true,
      backgroundColor: NAVY.withAlpha(0.88),
      backgroundPadding: new Cesium.Cartesian2(6, 4),
      // Above the line: in 2D the line would cover a label that sits on it.
      pixelOffset: new Cesium.Cartesian2(0, big ? -26 : -16),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    })

    // One line through all the points, following the ground.
    if (points.length > 1) {
      const positions: Cesium.Cartesian3[] = []
      points.slice(1).forEach((point, i) => {
        const pieces = pointsBetween(points[i], point, PIECES)
        if (i > 0) pieces.shift()
        for (const piece of pieces) positions.push(drawPosition(viewer, piece, 3))
      })
      const material = new Cesium.PolylineOutlineMaterialProperty({ color: LINE, outlineColor: NAVY, outlineWidth: 2 })
      add({
        polyline: {
          positions,
          width: 5,
          arcType: Cesium.ArcType.NONE, // the points already follow the ground
          material,
          depthFailMaterial: material, // also drawn where a hill is in front
        },
      })
      // The distance of each part, at its middle.
      segments.forEach((distance, i) => {
        const [middle] = pointsBetween(points[i], points[i + 1], 2).slice(1, 2)
        add({ position: drawPosition(viewer, middle, 3), label: label(formatDistance(distance)) })
      })
    }

    points.forEach((point, i) => {
      const last = i === points.length - 1
      add({
        position: drawPosition(viewer, point, 3),
        point: { pixelSize: 11, color: Cesium.Color.WHITE, outlineColor: NAVY, outlineWidth: 3, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        // The total stands at the last point when there is more than one part.
        label: last && segments.length > 1 ? label(`Total ${formatDistance(totalM)}`, true) : undefined,
      })
    })
    viewer.scene.requestRender()
  }
}
