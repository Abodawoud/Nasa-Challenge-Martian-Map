// Mouse controls for 3D close to the ground (below GROUND_CONTROLS_BELOW_M above the terrain).
//
// Why: Cesium's built-in 3D drag "grabs" the smooth Mars sphere. Trek's terrain sits about
// 5.6 km above that sphere (different height zero, PLAN.md section 12), so near the ground the
// grabbed point was wrong and dragging moved the camera in odd directions.
//
//   drag                 move over the ground. The point you grab stays under the cursor
//                        (exact, measured in tests), with a short glide after release.
//   Ctrl + drag          turn and tilt around the ground point you grabbed
//   middle drag          same as Ctrl + drag
//   drag on the sky      look around in place
//   wheel / right drag   zoom (Cesium's own, unchanged)
//   Shift + drag         free look (Cesium's own, unchanged)
//
// Far from the ground (the whole globe) Cesium's own controls are used: they work well there.
import { toolInput } from './mapTools'
import * as Cesium from 'cesium'

/** Below this height above the ground, these controls replace Cesium's drag and tilt. */
export const GROUND_CONTROLS_BELOW_M = 300_000
/** Orbit speed: radians per pixel of mouse movement. */
const ORBIT_RAD_PER_PX = 0.005
/** Tilt range: from straight down to slightly below the horizon (orbit), or above it (look). */
const MIN_PITCH = Cesium.Math.toRadians(-89)
const MAX_PITCH_ORBIT = Cesium.Math.toRadians(-4)
const MAX_PITCH_LOOK = Cesium.Math.toRadians(15)
/** Glide after releasing a drag: how fast it fades (milliseconds). */
const GLIDE_FADE_MS = 150
/** A release counts as a "throw" only if the mouse was still moving this recently. */
const GLIDE_MAX_PAUSE_MS = 60

type Drag =
  | { mode: 'pan'; grab: Cesium.Cartesian3; radius: number; maxDistance: number }
  | { mode: 'orbit'; pivot: Cesium.Cartesian3; x: number; y: number; minHeight: number }
  | { mode: 'look'; x: number; y: number; style: 'grab' | 'steer' }

export function installGroundControls(
  viewer: Cesium.Viewer,
  heightAboveGround: () => number,
  /** Called when the user grabs the map, so running camera flights can be cancelled. */
  onGrab: () => void = () => {},
) {
  const { scene, camera } = viewer
  const canvas = scene.canvas
  const ssc = scene.screenSpaceCameraController
  const ellipsoid = scene.globe.ellipsoid

  let drag: Drag | null = null
  let glide: { axis: Cesium.Cartesian3; radPerMs: number } | null = null
  let lastPan: { axis: Cesium.Cartesian3; radPerMs: number; time: number } | null = null
  let lastMoveTime = 0
  let lastFrameTime = performance.now()

  const active = () => scene.mode === Cesium.SceneMode.SCENE3D && heightAboveGround() < GROUND_CONTROLS_BELOW_M

  const mousePosition = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect()
    return new Cesium.Cartesian2(event.clientX - rect.left, event.clientY - rect.top)
  }

  const pickGround = (position: Cesium.Cartesian2) => {
    const ray = camera.getPickRay(position)
    return ray ? scene.globe.pick(ray, scene) : undefined
  }

  /** Turn the whole camera (position and view) around the planet centre. */
  const rotateCameraAroundCentre = (axis: Cesium.Cartesian3, angle: number) => {
    const rotation = Cesium.Matrix3.fromQuaternion(Cesium.Quaternion.fromAxisAngle(axis, angle))
    camera.setView({
      destination: Cesium.Matrix3.multiplyByVector(rotation, camera.positionWC, new Cesium.Cartesian3()),
      orientation: {
        direction: Cesium.Matrix3.multiplyByVector(rotation, camera.directionWC, new Cesium.Cartesian3()),
        up: Cesium.Matrix3.multiplyByVector(rotation, camera.upWC, new Cesium.Cartesian3()),
      },
    })
  }

  /**
   * Pan: find where the cursor's ray meets the sphere that passes through the grabbed point,
   * then turn the camera around the planet centre so the grabbed point comes under the cursor.
   * Height and tilt stay the same.
   */
  const pan = (state: Extract<Drag, { mode: 'pan' }>, position: Cesium.Cartesian2, now: number) => {
    const ray = camera.getPickRay(position)
    if (!ray) return
    const hit = Cesium.IntersectionTests.raySphere(ray, new Cesium.BoundingSphere(Cesium.Cartesian3.ZERO, state.radius))
    if (!hit) return // the cursor is above the horizon
    const along = hit.start > 0 ? hit.start : hit.stop
    if (!(along > 0) || along > state.maxDistance) return // too close to the horizon: would jump far
    const under = Cesium.Ray.getPoint(ray, along)
    const from = Cesium.Cartesian3.normalize(under, new Cesium.Cartesian3())
    const to = Cesium.Cartesian3.normalize(state.grab, new Cesium.Cartesian3())
    const angle = Cesium.Cartesian3.angleBetween(from, to)
    if (!(angle > 1e-12)) return
    const axis = Cesium.Cartesian3.normalize(Cesium.Cartesian3.cross(from, to, new Cesium.Cartesian3()), new Cesium.Cartesian3())
    rotateCameraAroundCentre(axis, angle)
    const dt = Math.max(1, now - lastMoveTime)
    lastPan = { axis, radPerMs: angle / dt, time: now }
  }

  /**
   * Orbit: turn and tilt around a fixed ground point.
   * Tilting up swings the camera down towards the ground. It stops when the camera would go
   * below a quarter of the height it had when the drag started (at least 30 m). Without this
   * a long tilt dropped the camera onto the ground, looking at the sky.
   */
  const orbit = (state: Extract<Drag, { mode: 'orbit' }>, dx: number, dy: number) => {
    const turnAndTilt = (tilt: number) => {
      camera.lookAtTransform(Cesium.Transforms.eastNorthUpToFixedFrame(state.pivot, ellipsoid))
      camera.rotateRight(-dx * ORBIT_RAD_PER_PX)
      if (tilt !== 0) camera.rotateUp(tilt)
      camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
    }
    const pitch = camera.pitch
    const wanted = -dy * ORBIT_RAD_PER_PX
    const tilt = Math.min(Math.max(wanted, MIN_PITCH - pitch), Math.max(0, MAX_PITCH_ORBIT - pitch))
    const before = {
      destination: camera.positionWC.clone(),
      orientation: { direction: camera.directionWC.clone(), up: camera.upWC.clone() },
    }
    turnAndTilt(tilt)
    if (tilt > 0 && heightAboveGround() < state.minHeight) {
      camera.setView(before)
      turnAndTilt(0) // keep the turn, drop the tilt
    }
  }

  /**
   * Look around in place (used when there is no nearby ground point to orbit around).
   * 'grab'  : plain drag on the sky. The scene follows the mouse.
   * 'steer' : Ctrl + drag. Same directions as orbit: right turns right, up tilts up.
   */
  const look = (dx: number, dy: number, style: 'grab' | 'steer') => {
    const frustum = camera.frustum as Cesium.PerspectiveFrustum
    const grabRadPerPx = (frustum.fovy ?? Cesium.Math.toRadians(60)) / Math.max(1, canvas.clientHeight)
    const turn = style === 'steer' ? dx * ORBIT_RAD_PER_PX : -dx * grabRadPerPx
    const wanted = style === 'steer' ? -dy * ORBIT_RAD_PER_PX : dy * grabRadPerPx
    const up = ellipsoid.geodeticSurfaceNormal(camera.positionWC, new Cesium.Cartesian3())
    camera.look(up, turn)
    const pitch = camera.pitch
    camera.lookUp(Math.min(Math.max(wanted, MIN_PITCH - pitch), Math.max(0, MAX_PITCH_LOOK - pitch)))
  }

  const onPointerDown = (event: PointerEvent) => {
    // A map tool is dragging one of its points: the map stays still.
    if (toolInput.dragging) return
    if (!active() || event.shiftKey) return
    const wantsOrbit = event.button === 1 || (event.button === 0 && event.ctrlKey)
    if (event.button !== 0 && !wantsOrbit) return
    if (event.button === 1) event.preventDefault() // no browser auto-scroll

    onGrab()
    camera.cancelFlight()
    glide = null
    lastPan = null
    const position = mousePosition(event)
    const ground = pickGround(position)
    const height = Math.max(heightAboveGround(), 50)
    lastMoveTime = performance.now()

    if (wantsOrbit) {
      // Orbit around the ground point at the screen centre (predictable, like other 3D maps).
      // If the centre shows sky or a far horizon, use the point under the mouse. If that is
      // also far or sky, steer the view in place. All three use the same directions.
      const isNear = (point: Cesium.Cartesian3 | undefined): point is Cesium.Cartesian3 =>
        !!point && Cesium.Cartesian3.distance(camera.positionWC, point) < Math.max(40 * height, 20_000)
      const centre = pickGround(new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2))
      const pivot = isNear(centre) ? centre : isNear(ground) ? ground : undefined
      drag = pivot
        ? { mode: 'orbit', pivot, x: position.x, y: position.y, minHeight: Math.max(30, heightAboveGround() * 0.25) }
        : { mode: 'look', x: position.x, y: position.y, style: 'steer' }
    } else if (ground) {
      const distance = Cesium.Cartesian3.distance(camera.positionWC, ground)
      drag = { mode: 'pan', grab: ground, radius: Cesium.Cartesian3.magnitude(ground), maxDistance: Math.max(distance * 4, height * 8) }
    } else {
      drag = { mode: 'look', x: position.x, y: position.y, style: 'grab' } // grabbed the sky
    }
    canvas.setPointerCapture?.(event.pointerId)
    canvas.style.cursor = drag.mode === 'pan' ? 'grabbing' : 'move'
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!drag) return
    const position = mousePosition(event)
    const now = performance.now()
    if (drag.mode === 'pan') {
      pan(drag, position, now)
    } else {
      const dx = position.x - drag.x
      const dy = position.y - drag.y
      drag.x = position.x
      drag.y = position.y
      if (drag.mode === 'orbit') orbit(drag, dx, dy)
      else look(dx, dy, drag.style)
    }
    lastMoveTime = now
    scene.requestRender()
  }

  const endDrag = () => {
    if (!drag) return
    // A quick release while moving keeps the map gliding for a moment.
    if (drag.mode === 'pan' && lastPan && performance.now() - lastPan.time < GLIDE_MAX_PAUSE_MS) {
      glide = { axis: lastPan.axis, radPerMs: lastPan.radPerMs }
    }
    drag = null
    scene.requestRender()
  }

  const onFrame = () => {
    const now = performance.now()
    const dt = Math.min(50, now - lastFrameTime)
    lastFrameTime = now

    if (scene.mode === Cesium.SceneMode.SCENE3D) {
      // Cesium's own drag and tilt are off while ours are active, back on for the far globe.
      const ours = active()
      ssc.enableRotate = !ours
      ssc.enableTilt = !ours
      ssc.enableTranslate = !ours
      if (!drag) canvas.style.cursor = toolInput.cursor || (ours ? 'grab' : '')
    } else if (!drag) {
      canvas.style.cursor = toolInput.cursor
    }

    if (glide && !drag) {
      rotateCameraAroundCentre(glide.axis, glide.radPerMs * dt)
      glide.radPerMs *= Math.exp(-dt / GLIDE_FADE_MS)
      // Stop when the movement is below about a tenth of a metre per frame.
      if (glide.radPerMs * dt * ellipsoid.maximumRadius < 0.1) glide = null
      else scene.requestRender()
    }
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', endDrag)
  canvas.addEventListener('pointercancel', endDrag)
  window.addEventListener('blur', endDrag)
  scene.preRender.addEventListener(onFrame)

  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerup', endDrag)
    canvas.removeEventListener('pointercancel', endDrag)
    window.removeEventListener('blur', endDrag)
    scene.preRender.removeEventListener(onFrame)
    canvas.style.cursor = ''
  }
}
