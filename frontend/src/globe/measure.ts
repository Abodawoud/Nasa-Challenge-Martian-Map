// The Measure tool: click places on the map, see the distance of every part and the total.
// Works in 2D and 3D.
//
//   move the mouse            a dashed line follows it from the last point, with the distance
//   click                     add a point (the new part draws itself in)
//   double click, or Esc      finish the line (a later click continues it)
//   drag a point              move it (the map stays still)
//   right click on a point    delete it (also possible from the panel)
//   drag the ground           move the map as always
//
// How it stays smooth: the shapes on the map are made once and read their positions from a
// small cache. Moving the mouse or dragging a point only changes the cache and asks for one
// new frame. Nothing is removed and added again while the mouse moves.
//
// The line is drawn over the ground the map shows, and always on top of it (so a hill never
// hides it). The numbers are distances over the Mars sphere, see surfaceDistanceM().
import * as Cesium from 'cesium'
import { drawPosition, formatDistance, pickPlace, pointsBetween, surfaceDistanceM, toolInput } from './mapTools'
import type { LonLat } from './mapTools'

const NAVY = Cesium.Color.fromCssColorString('#0c1a3d')
const LINE = Cesium.Color.fromCssColorString('#ffd23f') // a warm yellow: readable on Mars tan and on dark ground
/** How near (pixels) the cursor must be to a point to grab it. */
const GRAB_PX = 14
/** A press that moves less than this (pixels) is a click, not a drag of the map. */
const CLICK_PX = 5
/** Two clicks this close in time and place are a double click: it finishes the line. */
const DOUBLE_CLICK_MS = 350
/** Pieces per part of the line, so it follows the ground and the curve of the planet. */
const PIECES = 48
/** How long a new part takes to draw itself in. */
const GROW_MS = 260
const LIFT_M = 3

export interface Measurement {
  points: LonLat[]
  /** Distance of each part: segments[i] is from point i to point i + 1, in metres. */
  segments: number[]
  totalM: number
}

type Screen = { x: number; y: number }

export class MeasureTool {
  private points: LonLat[] = []
  private active = false
  /** True while the dashed line follows the cursor. Double click or Esc ends it. */
  private drawing = true
  private hover = -1
  private dragging = -1
  private press: Screen | null = null
  private lastAdd = { time: 0, x: 0, y: 0 }
  private cursor: Screen | null = null
  private cursorPlace: LonLat | null = null
  private moveFrame = 0
  private grow: { part: number; start: number } | null = null

  // The cache the shapes read from.
  private pointPositions: Cesium.Cartesian3[] = []
  private partPositions: Cesium.Cartesian3[][] = []
  private previewPositions: Cesium.Cartesian3[] = []

  private readonly lineEntity: Cesium.Entity
  private readonly previewEntity: Cesium.Entity
  private readonly totalEntity: Cesium.Entity
  private pointEntities: Cesium.Entity[] = []
  private labelEntities: Cesium.Entity[] = []
  private readonly tip: HTMLDivElement
  private readonly stops: Array<() => void> = []
  private readonly viewer: Cesium.Viewer
  private readonly onChange: (measurement: Measurement) => void

  constructor(viewer: Cesium.Viewer, onChange: (measurement: Measurement) => void) {
    this.viewer = viewer
    this.onChange = onChange
    const canvas = viewer.scene.canvas

    // Cesium's own double click flies the camera to the shape under the cursor. A double
    // click here means "finish the line", so that default is switched off.
    viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK)

    const solid = new Cesium.PolylineOutlineMaterialProperty({ color: LINE, outlineColor: NAVY, outlineWidth: 2 })
    this.lineEntity = viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(() => this.linePositions(), false),
        show: new Cesium.CallbackProperty(() => this.points.length > 1, false),
        width: 5,
        arcType: Cesium.ArcType.NONE, // the positions already follow the ground
        material: solid,
        depthFailMaterial: solid, // also drawn where a hill is in front
      },
    })
    const dashed = new Cesium.PolylineDashMaterialProperty({ color: LINE, gapColor: NAVY.withAlpha(0.55), dashLength: 14 })
    this.previewEntity = viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(() => this.previewPositions, false),
        show: new Cesium.CallbackProperty(() => this.previewShown(), false),
        width: 3,
        arcType: Cesium.ArcType.NONE,
        material: dashed,
        depthFailMaterial: dashed,
      },
    })
    this.totalEntity = viewer.entities.add({
      position: new Cesium.CallbackPositionProperty(() => this.pointPositions[this.pointPositions.length - 1], false),
      show: false,
      label: this.labelStyle(() => `Total ${formatDistance(this.measurement.totalM)}`, true),
    })

    // The small note that follows the cursor. Plain HTML: sharp text, and it moves without
    // drawing the map again.
    this.tip = document.createElement('div')
    Object.assign(this.tip.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      zIndex: '5',
      padding: '5px 9px',
      borderRadius: '8px',
      background: 'rgba(12, 26, 61, 0.92)',
      color: '#fff',
      font: '600 12px/1.35 Inter, system-ui, sans-serif',
      fontVariantNumeric: 'tabular-nums',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
      boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
      opacity: '0',
      transition: 'opacity 120ms ease',
      willChange: 'transform',
    })
    this.tip.setAttribute('aria-hidden', 'true')
    viewer.container.appendChild(this.tip)

    // "capture": these run before the camera's own listeners, so a point can be grabbed
    // before the map starts to slide.
    const listen = (target: HTMLElement | Window, type: string, handler: (event: never) => void) => {
      target.addEventListener(type, handler as EventListener, true)
      this.stops.push(() => target.removeEventListener(type, handler as EventListener, true))
    }
    listen(canvas, 'pointerdown', this.onDown)
    listen(canvas, 'pointermove', this.onMove)
    listen(canvas, 'pointerup', this.onUp)
    listen(canvas, 'pointercancel', this.onCancel)
    listen(canvas, 'pointerleave', this.onLeave)
    listen(canvas, 'contextmenu', this.onContextMenu)
    listen(window, 'keydown', this.onKey)
    // The drawing heights change after a 2D / 3D switch, and when sharper ground has loaded
    // after the camera moved: work the positions out again.
    this.stops.push(
      viewer.scene.morphComplete.addEventListener(() => this.recomputeAll()),
      viewer.camera.moveEnd.addEventListener(() => this.recomputeAll()),
    )
  }

  /** Only while active do clicks on the map add points. The drawing stays either way. */
  setActive(active: boolean) {
    this.active = active
    if (active) this.drawing = true
    else {
      this.endDrag()
      this.hover = -1
      this.hideTip()
    }
    this.applyCursor()
    this.viewer.scene.requestRender()
  }

  get measurement(): Measurement {
    const segments = this.points.slice(1).map((point, i) => surfaceDistanceM(this.points[i], point))
    return { points: [...this.points], segments, totalM: segments.reduce((sum, d) => sum + d, 0) }
  }

  removePoint(index: number) {
    if (index < 0 || index >= this.points.length) return
    this.points.splice(index, 1)
    this.grow = null
    this.hover = -1
    this.structureChanged()
  }

  removeLast() {
    this.removePoint(this.points.length - 1)
  }

  clear() {
    this.points = []
    this.grow = null
    this.hover = -1
    this.drawing = true
    this.structureChanged()
  }

  destroy() {
    for (const stop of this.stops) stop()
    cancelAnimationFrame(this.moveFrame)
    this.endDrag()
    this.tip.remove()
    if (this.active) {
      toolInput.cursor = ''
      if (!this.viewer.isDestroyed()) this.viewer.scene.canvas.style.cursor = ''
    }
    if (this.viewer.isDestroyed()) return
    for (const entity of [this.lineEntity, this.previewEntity, this.totalEntity, ...this.pointEntities, ...this.labelEntities]) this.viewer.entities.remove(entity)
  }

  // ------------------------------------------------------------------ mouse

  private position(event: MouseEvent): Screen {
    const rect = this.viewer.scene.canvas.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  /** The point under a screen position, or -1. */
  private pointAt(position: Screen): number {
    let best = -1
    let bestDistance = GRAB_PX
    this.pointPositions.forEach((world, i) => {
      const screen = Cesium.SceneTransforms.worldToWindowCoordinates(this.viewer.scene, world)
      if (!screen) return
      const distance = Math.hypot(screen.x - position.x, screen.y - position.y)
      if (distance <= bestDistance) {
        best = i
        bestDistance = distance
      }
    })
    return best
  }

  private pick(position: Screen) {
    return pickPlace(this.viewer, new Cesium.Cartesian2(position.x, position.y))
  }

  private onDown = (event: PointerEvent) => {
    if (!this.active || event.button !== 0 || event.ctrlKey) return
    const position = this.position(event)
    this.press = position
    const point = this.pointAt(position)
    if (point < 0) return
    // Grabbed a point: the camera must not move while it is dragged.
    this.dragging = point
    this.grow = null
    toolInput.dragging = true
    this.viewer.scene.screenSpaceCameraController.enableInputs = false
    this.viewer.scene.canvas.setPointerCapture(event.pointerId)
    this.applyCursor()
    this.showTip(position, 'Release to place the point')
    event.stopPropagation()
  }

  private onMove = (event: PointerEvent) => {
    if (!this.active) return
    this.cursor = this.position(event)
    if (this.dragging >= 0) event.stopPropagation()
    // At most one update per frame, however fast the mouse reports.
    if (!this.moveFrame) this.moveFrame = requestAnimationFrame(this.afterMove)
  }

  private afterMove = () => {
    this.moveFrame = 0
    const cursor = this.cursor
    if (!cursor || !this.active || this.viewer.isDestroyed()) return

    if (this.dragging >= 0) {
      const place = this.pick(cursor)
      if (place) {
        this.points[this.dragging] = place
        this.recomputeAround(this.dragging)
        this.onChange(this.measurement)
      }
      this.showTip(cursor, 'Release to place the point')
      this.viewer.scene.requestRender()
      return
    }

    // While a mouse button is down the map is being dragged: leave the cursor to the camera.
    const hover = this.press ? -1 : this.pointAt(cursor)
    if (hover !== this.hover) {
      this.hover = hover
      this.applyCursor()
    }
    this.cursorPlace = this.pick(cursor) ?? null
    this.updatePreview()

    if (this.press) this.hideTip()
    else if (hover >= 0) this.showTip(cursor, 'Drag to move · Right click to delete')
    else if (!this.cursorPlace) this.hideTip()
    else if (this.points.length === 0) this.showTip(cursor, 'Click to place the first point')
    else if (!this.drawing) this.showTip(cursor, 'Click to continue the line')
    else {
      const part = surfaceDistanceM(this.points[this.points.length - 1], this.cursorPlace)
      const total = this.measurement.totalM + part
      this.showTip(cursor, this.points.length > 1 ? `${formatDistance(part)}  ·  total ${formatDistance(total)}` : formatDistance(part), 'Click to add · Double click to finish')
    }
    this.viewer.scene.requestRender()
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

    const now = performance.now()
    const second = now - this.lastAdd.time < DOUBLE_CLICK_MS && Math.hypot(position.x - this.lastAdd.x, position.y - this.lastAdd.y) <= CLICK_PX + 1
    if (second) {
      // The second click of a double click: the point is already there. Finish the line.
      this.finish()
      return
    }
    const place = this.pick(position)
    if (!place) return
    this.lastAdd = { time: now, x: position.x, y: position.y }
    this.drawing = true
    this.points.push(place)
    this.structureChanged()
    // The new part draws itself in from the point before.
    if (this.points.length > 1) {
      this.grow = { part: this.points.length - 2, start: now }
      this.animate()
    }
    this.cursor = position
    this.afterMove()
  }

  private onCancel = () => {
    this.press = null
    this.endDrag()
  }

  private onLeave = () => {
    if (this.dragging >= 0) return
    this.cursorPlace = null
    this.previewPositions = []
    this.hover = -1
    this.hideTip()
    this.viewer.scene.requestRender()
  }

  private onContextMenu = (event: MouseEvent) => {
    if (!this.active) return
    const point = this.pointAt(this.position(event))
    if (point < 0) return
    event.preventDefault()
    event.stopPropagation()
    this.removePoint(point)
    this.hideTip()
  }

  private onKey = (event: KeyboardEvent) => {
    if (!this.active || event.key !== 'Escape' || !this.drawing || this.points.length === 0) return
    this.finish()
  }

  /** Stop the dashed line. The measurement stays, and a later click continues it. */
  private finish() {
    this.drawing = false
    this.hideTip()
    this.viewer.scene.requestRender()
  }

  private endDrag() {
    if (this.dragging < 0 && !toolInput.dragging) return
    this.dragging = -1
    toolInput.dragging = false
    if (!this.viewer.isDestroyed()) {
      this.viewer.scene.screenSpaceCameraController.enableInputs = true
      this.applyCursor()
      this.viewer.scene.requestRender()
    }
  }

  /** Crosshair to place points, an open hand over a point, a closed hand while dragging it. */
  private applyCursor() {
    const cursor = !this.active ? '' : this.dragging >= 0 ? 'grabbing' : this.hover >= 0 ? 'grab' : 'crosshair'
    toolInput.cursor = cursor
    if (!this.viewer.isDestroyed()) this.viewer.scene.canvas.style.cursor = cursor
  }

  private showTip(at: Screen, text: string, small?: string) {
    const html = small ? `${text}<br><span style="font-weight:400;opacity:.75">${small}</span>` : text
    if (this.tip.innerHTML !== html) this.tip.innerHTML = html
    this.tip.style.transform = `translate(${Math.round(at.x + 16)}px, ${Math.round(at.y + 18)}px)`
    this.tip.style.opacity = '1'
  }

  private hideTip() {
    this.tip.style.opacity = '0'
  }

  // ---------------------------------------------------------------- drawing

  private partFrom(a: LonLat, b: LonLat, pieces = PIECES) {
    return pointsBetween(a, b, pieces).map((place) => drawPosition(this.viewer, place, LIFT_M))
  }

  private recomputeAll() {
    if (this.viewer.isDestroyed()) return
    this.pointPositions = this.points.map((point) => drawPosition(this.viewer, point, LIFT_M))
    this.partPositions = this.points.slice(1).map((point, i) => this.partFrom(this.points[i], point))
    this.updatePreview()
    this.viewer.scene.requestRender()
  }

  /** A point moved: only it and the two parts that touch it change. */
  private recomputeAround(index: number) {
    this.pointPositions[index] = drawPosition(this.viewer, this.points[index], LIFT_M)
    if (index > 0) this.partPositions[index - 1] = this.partFrom(this.points[index - 1], this.points[index])
    if (index < this.points.length - 1) this.partPositions[index] = this.partFrom(this.points[index], this.points[index + 1])
  }

  private updatePreview() {
    const last = this.points[this.points.length - 1]
    this.previewPositions = last && this.cursorPlace ? this.partFrom(last, this.cursorPlace, 24) : []
  }

  private previewShown() {
    return this.active && this.drawing && this.dragging < 0 && this.hover < 0 && !this.press && this.previewPositions.length > 1
  }

  /** The whole line. The part that is drawing itself in is cut at its current length. */
  private linePositions(): Cesium.Cartesian3[] {
    const line: Cesium.Cartesian3[] = []
    this.partPositions.forEach((part, i) => {
      let shown = part
      if (this.grow && this.grow.part === i) {
        const t = Math.min(1, (performance.now() - this.grow.start) / GROW_MS)
        const eased = 1 - (1 - t) ** 3
        const reach = eased * (part.length - 1)
        const whole = Math.floor(reach)
        shown = part.slice(0, whole + 1)
        if (whole < part.length - 1) shown.push(Cesium.Cartesian3.lerp(part[whole], part[whole + 1], reach - whole, new Cesium.Cartesian3()))
      }
      for (let k = i === 0 ? 0 : 1; k < shown.length; k++) line.push(shown[k])
    })
    return line
  }

  /** Keep drawing frames while a new part grows. */
  private animate = () => {
    if (!this.grow || this.viewer.isDestroyed()) return
    if (performance.now() - this.grow.start >= GROW_MS) this.grow = null
    this.viewer.scene.requestRender()
    if (this.grow) requestAnimationFrame(this.animate)
  }

  private labelStyle(text: () => string, big = false): Cesium.LabelGraphics.ConstructorOptions {
    return {
      text: new Cesium.CallbackProperty(text, false),
      font: `${big ? 700 : 600} ${big ? 14 : 12}px Inter, system-ui, sans-serif`,
      fillColor: Cesium.Color.WHITE,
      style: Cesium.LabelStyle.FILL,
      showBackground: true,
      backgroundColor: NAVY.withAlpha(0.88),
      backgroundPadding: new Cesium.Cartesian2(6, 4),
      // Above the line: in 2D the line would cover a label that sits on it.
      pixelOffset: new Cesium.Cartesian2(0, big ? -26 : -16),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    }
  }

  /** Points were added or removed: bring the shapes to the right number, then redraw. */
  private structureChanged() {
    const { viewer } = this
    if (viewer.isDestroyed()) return
    while (this.pointEntities.length > this.points.length) viewer.entities.remove(this.pointEntities.pop()!)
    while (this.pointEntities.length < this.points.length) {
      const index = this.pointEntities.length
      this.pointEntities.push(
        viewer.entities.add({
          position: new Cesium.CallbackPositionProperty(() => this.pointPositions[index], false),
          point: {
            // A point grows a little under the cursor, so it is clear it can be grabbed.
            pixelSize: new Cesium.CallbackProperty(() => (this.hover === index || this.dragging === index ? 16 : 11), false),
            color: Cesium.Color.WHITE,
            outlineColor: NAVY,
            outlineWidth: 3,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }),
      )
    }
    const parts = Math.max(0, this.points.length - 1)
    while (this.labelEntities.length > parts) viewer.entities.remove(this.labelEntities.pop()!)
    while (this.labelEntities.length < parts) {
      const index = this.labelEntities.length
      this.labelEntities.push(
        viewer.entities.add({
          position: new Cesium.CallbackPositionProperty(() => this.partPositions[index]?.[PIECES / 2], false),
          label: this.labelStyle(() => (this.points[index + 1] ? formatDistance(surfaceDistanceM(this.points[index], this.points[index + 1])) : '')),
        }),
      )
    }
    // The total stands at the last point when there is more than one part.
    this.totalEntity.show = parts > 1
    this.recomputeAll()
    this.onChange(this.measurement)
  }
}
