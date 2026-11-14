// Mouse controls for 3D close to the ground (below GROUND_CONTROLS_BELOW_M above the terrain).
//
// Why: Cesium's built-in 3D drag "grabs" the smooth Mars sphere. Trek's terrain sits about
// 5.6 km above that sphere (different height zero, README section 12), so near the ground the
// grabbed point was wrong and dragging moved the camera in odd directions (tested 2026-11-14:
// dragging up moved the camera south). These controls work on the real ground instead:
//
//   drag            move over the ground, the grabbed point follows the mouse
//   Ctrl + drag     orbit around the ground point at the screen centre:
//                   left / right turns, up / down tilts
//   middle drag     same as Ctrl + drag
//   wheel           zoom (Cesium's own, unchanged)
//
// Far from the ground (the whole globe) Cesium's own controls are used: they work well there.
import * as Cesium from 'cesium'

/** Below this height above the ground, these controls replace Cesium's drag and tilt. */
export const GROUND_CONTROLS_BELOW_M = 300_000
/** Orbit speed: radians per pixel of mouse movement. */
const ORBIT_RAD_PER_PX = 0.005
/** Tilt range while orbiting: from straight down to 2° below the horizon. */
const MIN_PITCH = Cesium.Math.toRadians(-89)
const MAX_PITCH = Cesium.Math.toRadians(-2)

type DragMode = 'pan' | 'orbit'

export function installGroundControls(viewer: Cesium.Viewer, heightAboveGround: () => number) {
  const { scene, camera } = viewer
  const canvas = scene.canvas
  const ssc = scene.screenSpaceCameraController
  const ellipsoid = scene.globe.ellipsoid

  let drag: { mode: DragMode; last: Cesium.Cartesian2; metresPerPixel: number; pivot?: Cesium.Cartesian3 } | null =
    null

  const active = () => scene.mode === Cesium.SceneMode.SCENE3D && heightAboveGround() < GROUND_CONTROLS_BELOW_M

  // Switch Cesium's own drag and tilt off while ours are active, back on for the far globe.
  const syncCesiumControls = () => {
    if (scene.mode !== Cesium.SceneMode.SCENE3D) return
    const ours = active()
    ssc.enableRotate = !ours
    ssc.enableTilt = !ours
    ssc.enableTranslate = !ours
  }
  scene.preRender.addEventListener(syncCesiumControls)

  const pickGround = (position: Cesium.Cartesian2) => {
    const ray = camera.getPickRay(position)
    return ray ? scene.globe.pick(ray, scene) : undefined
  }

  /** Metres on the ground per screen pixel, at the given ground point. */
  const metresPerPixelAt = (point: Cesium.Cartesian3 | undefined) => {
    const distance = point ? Cesium.Cartesian3.distance(camera.positionWC, point) : heightAboveGround()
    const frustum = camera.frustum as Cesium.PerspectiveFrustum
    const fovy = frustum.fovy ?? Cesium.Math.toRadians(60)
    return (2 * distance * Math.tan(fovy / 2)) / Math.max(1, canvas.clientHeight)
  }

  const start = (mode: DragMode) => (event: { position: Cesium.Cartesian2 }) => {
    if (!active()) return
    const grabbed = pickGround(event.position)
    const centre = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2)
    drag = {
      mode,
      last: Cesium.Cartesian2.clone(event.position),
      metresPerPixel: metresPerPixelAt(grabbed),
      pivot: mode === 'orbit' ? pickGround(centre) : undefined,
    }
    canvas.style.cursor = mode === 'pan' ? 'grabbing' : 'move'
  }

  const move = (event: { endPosition: Cesium.Cartesian2 }) => {
    if (!drag) return
    const dx = event.endPosition.x - drag.last.x
    const dy = event.endPosition.y - drag.last.y
    drag.last = Cesium.Cartesian2.clone(event.endPosition)
    if (dx === 0 && dy === 0) return

    if (drag.mode === 'pan') {
      // Directions along the ground: "forward" is where the camera looks, flattened.
      const up = ellipsoid.geodeticSurfaceNormal(camera.positionWC, new Cesium.Cartesian3())
      const flatten = (v: Cesium.Cartesian3) => {
        const along = Cesium.Cartesian3.multiplyByScalar(up, Cesium.Cartesian3.dot(v, up), new Cesium.Cartesian3())
        return Cesium.Cartesian3.subtract(v, along, new Cesium.Cartesian3())
      }
      let forward = flatten(camera.directionWC)
      if (Cesium.Cartesian3.magnitude(forward) < 1e-3) forward = flatten(camera.upWC) // looking straight down
      Cesium.Cartesian3.normalize(forward, forward)
      const right = Cesium.Cartesian3.normalize(Cesium.Cartesian3.cross(forward, up, new Cesium.Cartesian3()), new Cesium.Cartesian3())
      // The grabbed ground follows the mouse: drag right -> camera moves left, drag down -> forward.
      // Forward movement on a tilted view covers more ground per pixel, so it is scaled by the tilt.
      const tilt = Math.max(0.2, Math.abs(Math.sin(camera.pitch)))
      camera.move(right, -dx * drag.metresPerPixel)
      camera.move(forward, (dy * drag.metresPerPixel) / tilt)
    } else if (drag.pivot) {
      // Orbit around the centre point: turn with left / right, tilt with up / down.
      const pitchBefore = camera.pitch
      const tiltBy = -dy * ORBIT_RAD_PER_PX
      const allowedTilt = Math.min(Math.max(tiltBy, MIN_PITCH - pitchBefore), MAX_PITCH - pitchBefore)
      camera.lookAtTransform(Cesium.Transforms.eastNorthUpToFixedFrame(drag.pivot, ellipsoid))
      camera.rotateRight(-dx * ORBIT_RAD_PER_PX)
      camera.rotateUp(allowedTilt)
      camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
    }
    scene.requestRender()
  }

  const end = () => {
    drag = null
    canvas.style.cursor = ''
  }

  const handler = new Cesium.ScreenSpaceEventHandler(canvas)
  const CTRL = Cesium.KeyboardEventModifier.CTRL
  handler.setInputAction(start('pan'), Cesium.ScreenSpaceEventType.LEFT_DOWN)
  handler.setInputAction(start('orbit'), Cesium.ScreenSpaceEventType.LEFT_DOWN, CTRL)
  handler.setInputAction(start('orbit'), Cesium.ScreenSpaceEventType.MIDDLE_DOWN)
  handler.setInputAction(move, Cesium.ScreenSpaceEventType.MOUSE_MOVE)
  handler.setInputAction(move, Cesium.ScreenSpaceEventType.MOUSE_MOVE, CTRL)
  for (const type of [Cesium.ScreenSpaceEventType.LEFT_UP, Cesium.ScreenSpaceEventType.MIDDLE_UP]) {
    handler.setInputAction(end, type)
    handler.setInputAction(end, type, CTRL)
  }

  return () => {
    scene.preRender.removeEventListener(syncCesiumControls)
    handler.destroy()
  }
}
