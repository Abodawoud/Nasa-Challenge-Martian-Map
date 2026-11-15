// Drawing a line on the map by hand: the ONE interaction every line tool on the map uses
// (Measure today, hand-drawn routes later). Works in 2D and 3D.
//
//   move the mouse            a dashed line follows it from the last point, with the distance
//   click                     add a point (the new part draws itself in)
//   double click              finish the line
//   click the last point      finish the line
//   Esc or Enter              finish the line
//   Backspace                 remove the last point while drawing
//   drag a point              move it (the map stays still), also after finishing
//   right click on a point    delete it
//   drag the ground           move the map as always
//   click after finishing     start a new line (the old one is replaced)
//
// How it stays smooth: the shapes on the map are made once and read their positions from a
// small cache. Moving the mouse or dragging a point only changes the cache and asks for one
// new frame. Nothing is removed and added again while the mouse moves.
//
// The line lies ON the ground the map shows, in 3D too: it takes the ground's height every
// 20 m, and takes it again whenever the ground on screen changes (see onGroundChanged in
// mapTools.ts). Where a hill stands in front of the line, the line is drawn faintly, so it
// reads as "behind the hill" and is still not lost.
// The numbers are distances over the Mars sphere, see surfaceDistanceM().
import * as Cesium from 'cesium'
import { drawPosition, formatDistance, onGroundChanged, pickPlace, pointsBetween, surfaceDistanceM, toolCursor, toolInput } from './mapTools'
import type { LonLat } from './mapTools'

const NAVY = Cesium.Color.fromCssColorString('#0c1a3d')
/** How near (pixels) the cursor must be to a point to grab it. */
const GRAB_PX = 14
/** A press that moves less than this (pixels) is a click, not a drag of the map. */
const CLICK_PX = 5
/** Two clicks this close in time and place are a double click: it finishes the line. */
const DOUBLE_CLICK_MS = 350
/**
 * The line takes the height of the ground every this many metres, so it lies on hills and in
 * dips. A part never gets more than MAX_PIECES pieces (a very long part is seen from far away,
 * where coarser steps do not show) and never fewer than MIN_PIECES.
 */
const STEP_M = 20
const MIN_PIECES = 12
const MAX_PIECES = 320
/** How long a new part takes to draw itself in. */
const GROW_MS = 260
/** The line floats this much above the ground, so it does not flicker in and out of it. */
const LIFT_M = 4

/** The line as it is now. */
export interface LineState {
  points: LonLat[]
  /** Distance of each part: segments[i] is from point i to point i + 1, in metres. */
  segments: number[]
  totalM: number
  /** True after the line was finished: the dashed line no longer follows the mouse. */
  finished: boolean
}

export interface LineDrawOptions {
  /** Line colour (a CSS colour). */
  color: string
  /** Which badge the mouse arrow carries while placing points. */
  cursor: 'measure' | 'identify'
  /** Called after every change: a point added, moved or removed, the line finished or cleared. */
  onChange: (state: LineState) => void
  /** Words for the note at the cursor. */
  words: { first: string; next: string; afterFinish: string }
}

type Screen = { x: number; y: number }

export class LineDrawer {
  private points: LonLat[] = []
  private active = false
  /** True while the dashed line follows the cursor. Finishing the line ends it. */
  private drawing = true
  private hover = -1
  private dragging = -1
  private press: Screen | null = null
  /** The point that was under the press, and whether the mouse moved since. */
  private pressedPoint = -1
  private moved = false
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
  private readonly options: LineDrawOptions
  private readonly placeCursor: string

  constructor(viewer: Cesium.Viewer, options: LineDrawOptions) {
    this.viewer = viewer
    this.options = options
    this.placeCursor = toolCursor(options.cursor)
    const LINE = Cesium.Color.fromCssColorString(options.color)
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
        // Behind a hill: faint, so it reads as hidden but is not lost.
        depthFailMaterial: new Cesium.PolylineOutlineMaterialProperty({ color: LINE.withAlpha(0.35), outlineColor: NAVY.withAlpha(0.25), outlineWidth: 2 }),
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
        depthFailMaterial: new Cesium.PolylineDashMaterialProperty({ color: LINE.withAlpha(0.35), gapColor: Cesium.Color.TRANSPARENT, dashLength: 14 }),
      },
    })
    this.totalEntity = viewer.entities.add({
      position: new Cesium.CallbackPositionProperty(() => this.pointPositions[this.pointPositions.length - 1], false),
      show: false,
      label: this.labelStyle(() => `Total ${formatDistance(this.state.totalM)}`, true),
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
    // Put the line on the ground again whenever the ground on screen has changed: sharper
    // tiles arrived, the camera moved, or the view switched between 2D and 3D.
    this.stops.push(
      onGroundChanged(viewer, () => {
        if (this.points.length === 0 || this.dragging >= 0) return
        this.recomputeAll()
      }),
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

  get state(): LineState {
    const segments = this.points.slice(1).map((point, i) => surfaceDistanceM(this.points[i], point))
    return { points: [...this.points], segments, totalM: segments.reduce((sum, d) => sum + d, 0), finished: !this.drawing && this.points.length > 0 }
  }

  /** Finish the line: the dashed line stops. The points can still be moved and deleted. */
  finish() {
    if (!this.drawing || this.points.length === 0) return
    this.drawing = false
    this.lastAdd.time = 0
    this.hideTip()
    this.options.onChange(this.state)
    this.viewer.scene.requestRender()
  }

  removePoint(index: number) {
    if (index < 0 || index >= this.points.length) return
    this.points.splice(index, 1)
    this.grow = null
    this.hover = -1
    if (this.points.length === 0) this.drawing = true
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
    this.moved = false
    const point = this.pointAt(position)
    this.pressedPoint = point
    if (point < 0) return
    // Pressed on a point: the camera must not move. Whether this becomes a drag (move the
    // point) or stays a click (finish the line on its last point) is decided by the mouse.
    this.dragging = point
    this.grow = null
    toolInput.dragging = true
    this.viewer.scene.screenSpaceCameraController.enableInputs = false
    this.viewer.scene.canvas.setPointerCapture(event.pointerId)
    this.applyCursor()
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
      // A small shake of the hand during a click must not move the point.
      if (!this.moved && this.press && Math.hypot(cursor.x - this.press.x, cursor.y - this.press.y) <= CLICK_PX) return
      this.moved = true
      const place = this.pick(cursor)
      if (place) {
        this.points[this.dragging] = place
        this.recomputeAround(this.dragging)
        this.options.onChange(this.state)
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
    else if (hover >= 0) this.showTip(cursor, this.drawing && hover === this.points.length - 1 && this.points.length > 1 ? 'Click to finish · Drag to move' : 'Drag to move · Right click to delete')
    else if (!this.cursorPlace) this.hideTip()
    else if (this.points.length === 0) this.showTip(cursor, this.options.words.first)
    else if (!this.drawing) this.showTip(cursor, this.options.words.afterFinish)
    else {
      const part = surfaceDistanceM(this.points[this.points.length - 1], this.cursorPlace)
      const total = this.state.totalM + part
      this.showTip(cursor, this.points.length > 1 ? `${formatDistance(part)}  ·  total ${formatDistance(total)}` : formatDistance(part), this.options.words.next)
    }
    this.viewer.scene.requestRender()
  }

  private onUp = (event: PointerEvent) => {
    const press = this.press
    const pressedPoint = this.pressedPoint
    this.press = null
    this.pressedPoint = -1

    if (this.dragging >= 0) {
      const wasMoved = this.moved
      this.endDrag()
      event.stopPropagation()
      // A click on a point (no move). On the last point it finishes the line: this is also
      // what the second click of a double click does, because it lands on the new point.
      if (!wasMoved && this.drawing && pressedPoint === this.points.length - 1) this.finish()
      this.cursor = this.position(event)
      this.afterMove()
      return
    }
    if (!this.active || !press || event.button !== 0) return
    const position = this.position(event)
    // The map was dragged, not clicked: no new point.
    if (Math.hypot(position.x - press.x, position.y - press.y) > CLICK_PX) return

    const now = performance.now()
    // A very fast second click beside the last point (not on it): still a double click.
    if (this.drawing && this.points.length > 0 && now - this.lastAdd.time < DOUBLE_CLICK_MS && Math.hypot(position.x - this.lastAdd.x, position.y - this.lastAdd.y) <= GRAB_PX * 2) {
      this.finish()
      return
    }
    const place = this.pick(position)
    if (!place) return
    // A click after the line was finished starts a new line.
    if (!this.drawing) {
      this.points = []
      this.drawing = true
    }
    this.lastAdd = { time: now, x: position.x, y: position.y }
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
    this.pressedPoint = -1
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
    if (!this.active || !this.drawing || this.points.length === 0) return
    // Keys typed into a text field belong to that field.
    const target = event.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
    if (event.key === 'Escape' || event.key === 'Enter') {
      // Enter on a focused button must still press that button.
      if (event.key === 'Enter' && target && target.tagName === 'BUTTON') return
      this.finish()
    } else if (event.key === 'Backspace') {
      this.removeLast()
      if (this.cursor) this.afterMove()
    }
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

  /** The ruler arrow to place points, an open hand over a point, a closed hand while dragging it. */
  private applyCursor() {
    const cursor = !this.active ? '' : this.dragging >= 0 ? 'grabbing' : this.hover >= 0 ? 'grab' : this.placeCursor
    toolInput.cursor = cursor
    if (!this.viewer.isDestroyed()) this.viewer.scene.canvas.style.cursor = cursor
  }

  private showTip(at: Screen, text: string, small?: string) {
    const html = small ? `${text}<br><span style="font-weight:400;opacity:.75">${small}</span>` : text
    if (this.tip.innerHTML !== html) this.tip.innerHTML = html
    this.tip.style.transform = `translate(${Math.round(at.x + 34)}px, ${Math.round(at.y + 22)}px)`
    this.tip.style.opacity = '1'
  }

  private hideTip() {
    this.tip.style.opacity = '0'
  }

  // ---------------------------------------------------------------- drawing

  /** The positions of one part: on the ground, one about every STEP_M metres. */
  private partFrom(a: LonLat, b: LonLat, maxPieces = MAX_PIECES) {
    const pieces = Math.min(maxPieces, Math.max(MIN_PIECES, Math.ceil(surfaceDistanceM(a, b) / STEP_M)))
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
    // The dashed line follows the mouse, so it is rebuilt on every move: fewer pieces.
    this.previewPositions = last && this.cursorPlace ? this.partFrom(last, this.cursorPlace, 96) : []
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
          position: new Cesium.CallbackPositionProperty(() => {
            const part = this.partPositions[index]
            return part?.[Math.floor(part.length / 2)]
          }, false),
          label: this.labelStyle(() => (this.points[index + 1] ? formatDistance(surfaceDistanceM(this.points[index], this.points[index + 1])) : '')),
        }),
      )
    }
    // The total stands at the last point when there is more than one part.
    this.totalEntity.show = parts > 1
    this.recomputeAll()
    this.options.onChange(this.state)
  }
}
