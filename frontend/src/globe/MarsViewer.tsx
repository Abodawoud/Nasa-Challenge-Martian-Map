import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { MARS_ELLIPSOID, PERSEVERANCE_LANDING } from './mars'
import { createTrekTerrain } from './trekTerrain'
import { installGroundControls } from './groundControls'
import { IMAGERY_LAYERS } from './layers.config'
import { addImageryLayers } from './imagery'

export type ViewMode = '2D' | '2.5D' | '3D'

/** The camera always stays at least this high above the 3D ground (about a 8-storey building). */
const MIN_CAMERA_ABOVE_GROUND_M = 25
/** Furthest zoom out: about 7 Mars radii, the whole planet with space around it. */
const MAX_CAMERA_DISTANCE_M = 25_000_000
/** Steepest upward tilt allowed: 15° above the horizon, like looking up at a crater rim. */
const MAX_PITCH_RAD = Cesium.Math.toRadians(15)
/** Below this height above the ground the sky turns from space to Mars sky. */
const MARS_SKY_BELOW_M = 60_000
/** 2.5D: the fixed tilt (keeps the far map edge out of view). */
const PITCH_CV_RAD = Cesium.Math.toRadians(-50)
/** 2.5D: highest camera, so the flat map always fills the screen. */
const MAX_HEIGHT_CV_M = 400_000
/** 2D: closest zoom, the width of the view on the ground. */
const MIN_WIDTH_2D_M = 1_000
/** Half the width and half the height of the flat (2D / 2.5D) Mars map, in metres. */
const HALF_WORLD_X = Math.PI * MARS_ELLIPSOID.maximumRadius
const HALF_WORLD_Y = HALF_WORLD_X / 2

/** 2D: furthest zoom, so the map always fills the screen (limited by width and height). */
function maxWidth2D(scene: Cesium.Scene) {
  const aspect = scene.canvas.clientWidth / Math.max(1, scene.canvas.clientHeight)
  return Math.min(2 * HALF_WORLD_X, 2 * HALF_WORLD_Y * aspect)
}

/** Last ground height measured under the camera (Trek terrain scale, about 5.6 km at Jezero). */
let lastGroundHeight = 5_600

export interface ZoomState {
  canZoomIn: boolean
  canZoomOut: boolean
  /** How far a zoom-in step may still go, in Cesium zoom units (metres), before the limit. */
  roomIn: number
  /** How far a zoom-out step may still go before the limit. */
  roomOut: number
  /** Current "size" used to scale a zoom step: view width in 2D, distance to the ground otherwise. */
  size: number
}

/**
 * Where the camera is between its closest and furthest zoom. The zoom buttons use it to
 * disable themselves and to stop a step exactly at the limit. Same limits as keepCameraSafe.
 */
export function getZoomState(viewer: Cesium.Viewer): ZoomState {
  const { scene, camera } = viewer
  const none: ZoomState = { canZoomIn: false, canZoomOut: false, roomIn: 0, roomOut: 0, size: 0 }
  if (scene.mode === Cesium.SceneMode.MORPHING) return none

  if (scene.mode === Cesium.SceneMode.SCENE2D) {
    const f = camera.frustum as Cesium.OrthographicOffCenterFrustum
    if (f.right === undefined || f.left === undefined) return none
    const width = f.right - f.left
    // Cesium's 2D zoomIn(amount) shrinks the view width by about `amount`.
    const roomIn = Math.max(0, width - MIN_WIDTH_2D_M)
    const roomOut = Math.max(0, maxWidth2D(scene) - width)
    return { canZoomIn: roomIn > width * 0.01, canZoomOut: roomOut > width * 0.01, roomIn, roomOut, size: width }
  }

  // 3D and 2.5D: zoom moves the camera along the view, towards the point at the screen centre.
  const centre = new Cesium.Cartesian2(scene.canvas.clientWidth / 2, scene.canvas.clientHeight / 2)
  const ray = camera.getPickRay(centre)
  const hit = ray ? scene.globe.pick(ray, scene) : undefined
  const carto = camera.positionCartographic
  // getHeight can return nothing for a moment (tiles under the camera being replaced, often
  // in 2.5D close to the ground). Use the last known ground height then, never 0.
  const measured = scene.globe.getHeight(carto)
  if (measured !== undefined) lastGroundHeight = measured
  const ground = measured ?? lastGroundHeight
  const aboveGround = carto.height - ground
  // In 2.5D the picked point and the camera use different coordinate frames, so the
  // distance to the target is only measured in 3D. 2.5D uses the height alone.
  const toTarget =
    hit && scene.mode === Cesium.SceneMode.SCENE3D ? Cesium.Cartesian3.distance(camera.positionWC, hit) : Infinity
  // Room to zoom in = distance along the view until the camera reaches the height floor
  // (or the ground point it looks at, whichever comes first).
  const heightLeft = aboveGround - MIN_CAMERA_ABOVE_GROUND_M
  const down = Math.max(0.05, Math.sin(-camera.pitch) || 0.05)
  const roomIn = Math.max(0, Math.min(toTarget - MIN_CAMERA_ABOVE_GROUND_M, heightLeft / down))
  const top = scene.mode === Cesium.SceneMode.COLUMBUS_VIEW ? MAX_HEIGHT_CV_M : MAX_CAMERA_DISTANCE_M
  const height = scene.mode === Cesium.SceneMode.COLUMBUS_VIEW ? camera.position.z : carto.height
  const roomOut = Math.max(0, top - height)
  return {
    canZoomIn: heightLeft > 2 && roomIn > 2,
    canZoomOut: roomOut > top * 0.01,
    roomIn,
    roomOut,
    size: Math.max(Number.isFinite(toTarget) ? toTarget : aboveGround / down, 1),
  }
}

export interface CursorInfo {
  lon: number
  lat: number
}

interface Props {
  onReady: (viewer: Cesium.Viewer) => void
  onCursor: (info: CursorInfo | null) => void
  onTerrainStatus: (status: 'trek' | 'flat') => void
}

export function MarsViewer({ onReady, onCursor, onTerrainStatus }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return
    let destroyed = false

    const viewer = new Cesium.Viewer(containerRef.current, {
      globe: new Cesium.Globe(MARS_ELLIPSOID),
      mapProjection: new Cesium.GeographicProjection(MARS_ELLIPSOID),
      skyAtmosphere: false,
      baseLayer: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      timeline: false,
      animation: false,
      infoBox: false,
      selectionIndicator: false,
      fullscreenButton: false,
      showRenderLoopErrors: false,
      // 2D map has real left and right edges, no endless horizontal scrolling.
      mapMode2D: Cesium.MapMode2D.ROTATE,
      // Transparent canvas, so the page's space gradient shows behind the map (no flat black).
      contextOptions: { webgl: { alpha: true } },
    })
    const { scene } = viewer
    scene.globe.enableLighting = false
    scene.globe.showGroundAtmosphere = false
    scene.globe.baseColor = Cesium.Color.fromCssColorString('#8a5a44')
    // Smoother moving: keep more tiles in memory and load neighbours early, so dragging
    // does not keep reloading and redrawing the same ground.
    scene.globe.tileCacheSize = 1000
    // Sharper ground: load one step more detail than Cesium's default (2), and draw at the
    // screen's real pixel density instead of a reduced one.
    scene.globe.maximumScreenSpaceError = 1.3
    viewer.useBrowserRecommendedResolution = false
    scene.globe.preloadSiblings = true
    scene.globe.preloadAncestors = true
    // Only draw a new frame when something changes (saves work when the map is still).
    scene.requestRenderMode = true
    scene.maximumRenderTimeChange = Infinity
    scene.backgroundColor = Cesium.Color.TRANSPARENT

    // Stars only in 3D and only from space. In 2D and 2.5D the flat map floats on the page gradient.
    const skyHostIsSpace = () => containerRef.current?.parentElement?.getAttribute('data-sky') !== 'mars'
    const updateSky = () => {
      if (scene.skyBox) scene.skyBox.show = scene.mode === Cesium.SceneMode.SCENE3D && skyHostIsSpace()
      if (scene.sun) scene.sun.show = false
      if (scene.moon) scene.moon.show = false
    }
    updateSky()
    scene.morphComplete.addEventListener(updateSky)

    // 2D: keep the map edges at the screen edges (no dragging the map off screen).
    const halfWorldX = HALF_WORLD_X
    const halfWorldY = HALF_WORLD_Y
    const clamp2D = () => {
      if (scene.mode !== Cesium.SceneMode.SCENE2D) return
      const f = viewer.camera.frustum as Cesium.OrthographicOffCenterFrustum
      if (f.right === undefined || f.left === undefined || f.top === undefined || f.bottom === undefined) return
      const halfW = (f.right - f.left) / 2
      const halfH = (f.top - f.bottom) / 2
      const p = viewer.camera.position
      const limit = (value: number, half: number, world: number) =>
        half >= world ? 0 : Math.min(world - half, Math.max(-world + half, value))
      p.x = limit(p.x, halfW, halfWorldX)
      p.y = limit(p.y, halfH, halfWorldY)
    }
    scene.preRender.addEventListener(clamp2D)

    // Zoom and tilt limits, so the camera never goes into or under the ground.
    const ssc = scene.screenSpaceCameraController
    ssc.enableCollisionDetection = true
    ssc.minimumZoomDistance = MIN_CAMERA_ABOVE_GROUND_M
    ssc.maximumZoomDistance = MAX_CAMERA_DISTANCE_M

    const keepCameraSafe = () => {
      if (scene.mode === Cesium.SceneMode.MORPHING) return
      const camera = viewer.camera

      if (scene.mode === Cesium.SceneMode.SCENE2D) {
        // 2D: don't zoom out further than the whole map, or in closer than ~1 km across.
        const f = camera.frustum as Cesium.OrthographicOffCenterFrustum
        if (f.right === undefined || f.left === undefined || f.top === undefined || f.bottom === undefined) return
        const width = f.right - f.left
        // The whole view must stay inside the map: limited by the map's width AND its height
        // (a tall screen would otherwise show space above and below).
        const maxWidth = maxWidth2D(scene)
        const target = width > maxWidth ? maxWidth : width < MIN_WIDTH_2D_M ? MIN_WIDTH_2D_M : width
        if (target !== width) {
          const k = target / width
          f.right *= k
          f.left *= k
          f.top *= k
          f.bottom *= k
        }
        return
      }

      // 2.5D: the flat map must fill the screen. The tilt is fixed in this mode (see
      // applyModeLimits), so here we only keep the height and position inside the map.
      // With a 60° view and a -50° tilt, the ground is visible up to about 6 heights ahead.
      if (scene.mode === Cesium.SceneMode.COLUMBUS_VIEW) {
        const p = camera.position
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return
        if (p.z > MAX_HEIGHT_CV_M) p.z = MAX_HEIGHT_CV_M
        // Ground floor. Cesium's own collision check does not work with this terrain in 2.5D,
        // so without this the camera could zoom through the ground (empty screen).
        // In 2.5D, position.z is the height on the same scale as the terrain.
        const measured = scene.globe.getHeight(camera.positionCartographic)
        if (measured !== undefined) lastGroundHeight = measured
        const floor = (measured ?? lastGroundHeight) + MIN_CAMERA_ABOVE_GROUND_M
        if (p.z < floor) p.z = floor
        const margin = p.z * 6.5
        const limit = (value: number, world: number) =>
          margin >= world ? 0 : Math.min(world - margin, Math.max(-world + margin, value))
        p.x = limit(p.x, halfWorldX)
        p.y = limit(p.y, halfWorldY)
        return
      }

      // 3D: never look up past the horizon.
      const { heading, pitch } = camera
      if (!Number.isFinite(heading) || !Number.isFinite(pitch)) return
      if (pitch > MAX_PITCH_RAD) {
        camera.setView({ orientation: { heading, pitch: MAX_PITCH_RAD, roll: 0 } })
      }

      // 3D: stay above the ground (Trek terrain heights, see PLAN.md section 12).
      const carto = camera.positionCartographic
      if (!carto || !Number.isFinite(carto.height)) return
      const ground = scene.globe.getHeight(carto)
      if (ground !== undefined && carto.height < ground + MIN_CAMERA_ABOVE_GROUND_M) {
        camera.setView({
          destination: Cesium.Cartesian3.fromRadians(
            carto.longitude,
            carto.latitude,
            ground + MIN_CAMERA_ABOVE_GROUND_M,
            MARS_ELLIPSOID,
          ),
          orientation: { heading, pitch: camera.pitch, roll: 0 },
        })
      }
    }
    // A camera rule must never stop the map from drawing.
    scene.preRender.addEventListener(() => {
      try {
        keepCameraSafe()
      } catch (err) {
        console.warn('[MarsViewer] camera limit skipped this frame', err)
      }
    })

    // Per-mode limits: 2.5D has a fixed tilt and a lower zoom-out limit.
    // In 3D near the ground, groundControls.ts takes over drag and tilt (and switches
    // Cesium's own off). In 2D and 2.5D Cesium's own drag is used.
    const applyModeLimits = () => {
      const cv = scene.mode === Cesium.SceneMode.COLUMBUS_VIEW
      ssc.enableTilt = !cv
      ssc.enableRotate = true
      ssc.enableTranslate = true
      ssc.maximumZoomDistance = cv ? MAX_HEIGHT_CV_M : MAX_CAMERA_DISTANCE_M
    }
    applyModeLimits()
    scene.morphComplete.addEventListener(applyModeLimits)

    // Safety net: if any rendering error still happens, log it and keep drawing,
    // instead of freezing the map behind Cesium's red error box.
    scene.renderError.addEventListener((_scene, error) => {
      console.error('[MarsViewer] render error, restarting the render loop', error)
      setTimeout(() => {
        if (!viewer.isDestroyed()) viewer.useDefaultRenderLoop = true
      }, 0)
    })

    addImageryLayers(viewer, IMAGERY_LAYERS)

    // Trek's own terrain. If it fails, fall back to a smooth sphere (PLAN.md risk list).
    createTrekTerrain()
      .then(async (terrain) => {
        if (destroyed) return
        viewer.terrainProvider = terrain
        onTerrainStatus('trek')
        // Put the landing-site pin on the real ground (Jezero floor is ~2.5 km below the datum).
        const [ground] = await Cesium.sampleTerrainMostDetailed(terrain, [
          Cesium.Cartographic.fromDegrees(PERSEVERANCE_LANDING.lon, PERSEVERANCE_LANDING.lat),
        ])
        if (destroyed || ground.height === undefined) return
        console.info('[MarsViewer] Trek terrain height at landing site (m):', ground.height.toFixed(1))
        landingPin.position = new Cesium.ConstantPositionProperty(
          Cesium.Cartesian3.fromDegrees(PERSEVERANCE_LANDING.lon, PERSEVERANCE_LANDING.lat, ground.height, MARS_ELLIPSOID),
        )
      })
      .catch((err) => {
        console.warn('[MarsViewer] Trek terrain failed, using a smooth sphere', err)
        onTerrainStatus('flat')
      })

    // M0 alignment check: a pin at the Perseverance landing site.
    const landingPin = viewer.entities.add({
      name: PERSEVERANCE_LANDING.name,
      position: Cesium.Cartesian3.fromDegrees(PERSEVERANCE_LANDING.lon, PERSEVERANCE_LANDING.lat, 0, MARS_ELLIPSOID),
      point: {
        pixelSize: 10,
        color: Cesium.Color.fromCssColorString('#FC3D21'),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: 'Perseverance landing site',
        font: '600 13px Inter, system-ui, sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -18),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2_000_000),
      },
    })

    // Start looking at the whole planet, Jezero side.
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(77.45, 18.44, 9_000_000, MARS_ELLIPSOID),
    })

    // Longitude and latitude under the mouse.
    // Sky: near the ground the page behind the transparent canvas shows a Mars sky, in space
    // it shows space. Set as a data attribute, the colours live in index.css.
    const skyHost = containerRef.current.parentElement
    const updateSkyTone = () => {
      if (!skyHost || scene.mode !== Cesium.SceneMode.SCENE3D) {
        skyHost?.setAttribute('data-sky', 'space')
        return
      }
      const carto = viewer.camera.positionCartographic
      const ground = scene.globe.getHeight(carto) ?? 5_600
      skyHost.setAttribute('data-sky', carto.height - ground < MARS_SKY_BELOW_M ? 'mars' : 'space')
    }
    viewer.camera.changed.addEventListener(() => {
      updateSkyTone()
      updateSky()
    })
    scene.morphComplete.addEventListener(updateSkyTone)
    updateSkyTone()

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
    handler.setInputAction((move: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      // Pick the 3D ground first. The smooth sphere is wrong when the view is tilted,
      // because Trek terrain sits above it.
      const ray = viewer.camera.getPickRay(move.endPosition)
      const cartesian =
        (ray && viewer.scene.mode !== Cesium.SceneMode.SCENE2D ? viewer.scene.globe.pick(ray, viewer.scene) : undefined) ??
        viewer.camera.pickEllipsoid(move.endPosition, MARS_ELLIPSOID)
      if (!cartesian) return onCursor(null)
      const carto = Cesium.Cartographic.fromCartesian(cartesian, MARS_ELLIPSOID)
      onCursor({ lon: Cesium.Math.toDegrees(carto.longitude), lat: Cesium.Math.toDegrees(carto.latitude) })
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

    const removeGroundControls = installGroundControls(viewer, () => {
      const carto = viewer.camera.positionCartographic
      const measured = scene.globe.getHeight(carto)
      if (measured !== undefined) lastGroundHeight = measured
      return carto.height - (measured ?? lastGroundHeight)
    }, () => {
      jezeroFlight++ // the user took control: no automatic descent afterwards
    })

    onReady(viewer)
    // Development only: reach the viewer from the browser console for checks.
    if (import.meta.env.DEV) (window as unknown as { __viewer: Cesium.Viewer }).__viewer = viewer

    return () => {
      destroyed = true
      removeGroundControls()
      handler.destroy()
      viewer.destroy()
    }
    // The viewer is created once. Callbacks are stable refs from the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={containerRef} className="absolute inset-0" />
}

/**
 * Switch between 2D, 2.5D (Columbus view) and 3D.
 * After the switch the camera goes to Jezero, so the map fills the screen
 * (a far, low view in 2.5D shows the end of the flat map).
 */
export function setViewMode(viewer: Cesium.Viewer, mode: ViewMode) {
  const { scene } = viewer
  const done = () => {
    scene.morphComplete.removeEventListener(done)
    flyToJezero(viewer, 1.5)
  }
  scene.morphComplete.addEventListener(done)
  const duration = 1.0
  if (mode === '2D') scene.morphTo2D(duration)
  else if (mode === '2.5D') scene.morphToColumbusView(duration)
  else scene.morphTo3D(duration)
}

/** Counts "Fly to Jezero" flights, so a paused flight knows when it has been replaced or cancelled. */
let jezeroFlight = 0

/** How long the camera rests above Jezero before descending. */
const OVERVIEW_PAUSE_MS = 800

/** Fly the camera down to Jezero: overview from above first, then descend to near the ground. */
export function flyToJezero(viewer: Cesium.Viewer, duration = 4) {
  const { lon, lat } = PERSEVERANCE_LANDING
  if (viewer.scene.mode === Cesium.SceneMode.SCENE2D) {
    viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(lon, lat, 60_000, MARS_ELLIPSOID), duration })
    return
  }
  if (viewer.scene.mode === Cesium.SceneMode.COLUMBUS_VIEW) {
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat - 0.35, 30_000, MARS_ELLIPSOID),
      orientation: { heading: 0, pitch: PITCH_CV_RAD, roll: 0 },
      duration,
    })
    return
  }
  // 3D, two stages, like arriving from orbit:
  //   1. Overview: straight above Jezero, looking down, the whole crater in view.
  //   2. Descent: glide down and tilt towards the horizon until it feels like standing
  //      near the ground, looking north over the landing site and the delta.
  // Trek terrain at Jezero sits about +5.6 km on its own height scale (PLAN.md section 12),
  // so the final height is measured from the real ground under the camera.
  const camera = viewer.camera
  const flight = ++jezeroFlight
  const ground = viewer.scene.globe.getHeight(Cesium.Cartographic.fromDegrees(lon, lat)) ?? 5_640
  const overview = {
    destination: Cesium.Cartesian3.fromDegrees(lon, lat, ground + 120_000, MARS_ELLIPSOID),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
  }
  const descent = {
    destination: Cesium.Cartesian3.fromDegrees(lon, lat - 0.045, ground + 1_500, MARS_ELLIPSOID),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-14), roll: 0 },
  }
  camera.flyTo({
    ...overview,
    duration: duration * 0.55,
    easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT,
    // A short pause above the crater, so the area is understood before the descent.
    complete: () =>
      setTimeout(() => {
        // Skip the descent if the user grabbed the map during the pause, or a newer flight started.
        if (viewer.isDestroyed() || flight !== jezeroFlight) return
        camera.flyTo({
          ...descent,
          duration: duration * 0.8,
          easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
        })
      }, OVERVIEW_PAUSE_MS),
  })
}
