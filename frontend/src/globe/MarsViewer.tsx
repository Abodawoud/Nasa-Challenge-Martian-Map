import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { MARS_ELLIPSOID, PERSEVERANCE_LANDING } from './mars'
import { createTrekTerrain } from './trekTerrain'
import { installGroundControls } from './groundControls'
import { IMAGERY_LAYERS } from './layers.config'
import { addImageryLayers } from './imagery'
import { preloadView, waitForTiles, whenIdle } from './preload'
import type { CameraView } from './preload'

/** 2D is a flat map, 3D the real planet. A 2.5D mode was dropped (PLAN.md D15). */
export type ViewMode = '2D' | '3D'

/** Tile detail (Cesium's maximumScreenSpaceError: lower is sharper and loads more tiles). */
const DETAIL_STILL = 1.3
const DETAIL_MOVING = 2

/** The camera always stays at least this high above the 3D ground (about a 8-storey building). */
const MIN_CAMERA_ABOVE_GROUND_M = 25
/** Furthest zoom out: about 7 Mars radii, the whole planet with space around it. */
const MAX_CAMERA_DISTANCE_M = 25_000_000
/** Steepest upward tilt allowed: 15° above the horizon, like looking up at a crater rim. */
const MAX_PITCH_RAD = Cesium.Math.toRadians(15)
/** Below this height above the ground the sky turns from space to Mars sky. */
const MARS_SKY_BELOW_M = 60_000
/** 2D: closest zoom, the width of the view on the ground. */
const MIN_WIDTH_2D_M = 1_000
/** Half the width and half the height of the flat (2D) Mars map, in metres. */
const HALF_WORLD_X = Math.PI * MARS_ELLIPSOID.maximumRadius
const HALF_WORLD_Y = HALF_WORLD_X / 2
/** Height of the start view: the whole planet, Jezero side. */
const START_HEIGHT_M = 9_000_000
/** Cesium's default field of view (across the wider side of the screen). */
const DEFAULT_FOV_RAD = Cesium.Math.toRadians(60)
/** 2D to 3D: tilt of the 3D view, looking north at the place that was in the 2D centre. */
const SWITCH_PITCH_RAD = Cesium.Math.toRadians(-45)
/** 2D to 3D: further than this, look straight down (a tilted view would show the planet's edge). */
const TOP_DOWN_BEYOND_M = 1_000_000
/**
 * Length of one stage of a 2D / 3D switch. Cesium runs a switch in several stages (measured:
 * with 1.0 here, 3D to 2D took 3.8 s), so this is kept short for a quick, smooth change.
 */
const MORPH_SECONDS = 0.35
/** 2D "Fly to Jezero": width of the view on the ground (the whole crater and its rim). */
const JEZERO_2D_WIDTH_M = 60_000

/** 2D: furthest zoom, so the map always fills the screen (limited by width and height). */
function maxWidth2D(scene: Cesium.Scene) {
  const aspect = scene.canvas.clientWidth / Math.max(1, scene.canvas.clientHeight)
  return Math.min(2 * HALF_WORLD_X, 2 * HALF_WORLD_Y * aspect)
}

/**
 * Ground width seen across the screen per metre of distance, for a camera that looks
 * straight at the ground (2 · tan(fovy / 2) · aspect). In 2D the camera has no field of view,
 * so Cesium's 3D default is used: that is the lens 3D gets after a switch.
 */
function widthPerMetre(viewer: Cesium.Viewer) {
  const canvas = viewer.scene.canvas
  const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight)
  const frustum = viewer.camera.frustum
  const fov = frustum instanceof Cesium.PerspectiveFrustum && frustum.fov !== undefined ? frustum.fov : DEFAULT_FOV_RAD
  // Cesium's fov is the angle across the wider side of the screen.
  const tanHalf = Math.tan(fov / 2)
  return 2 * (aspect >= 1 ? tanHalf : tanHalf * aspect)
}

/** Last ground height measured under the camera (Trek terrain scale, about 5.6 km at Jezero). */
let lastGroundHeight = 5_600
/**
 * Trek ground height at the landing site, measured once the terrain is loaded. The Jezero
 * flight and its warm-up both use it, so they plan exactly the same views and tiles.
 */
let landingGround = 5_640
/** Counts "Fly to Jezero" flights, so a paused flight knows when it has been replaced or cancelled. */
let jezeroFlight = 0

export interface ZoomState {
  canZoomIn: boolean
  canZoomOut: boolean
  /** How far a zoom-in step may still go, in Cesium zoom units (metres), before the limit. */
  roomIn: number
  /** How far a zoom-out step may still go before the limit. */
  roomOut: number
  /** Current "size" used to scale a zoom step: view width in 2D, distance to the ground in 3D. */
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

  // 3D: zoom moves the camera along the view, towards the point at the screen centre.
  const centre = new Cesium.Cartesian2(scene.canvas.clientWidth / 2, scene.canvas.clientHeight / 2)
  const ray = camera.getPickRay(centre)
  const hit = ray ? scene.globe.pick(ray, scene) : undefined
  const carto = camera.positionCartographic
  // getHeight can return nothing for a moment (tiles under the camera being replaced).
  // Use the last known ground height then, never 0.
  const measured = scene.globe.getHeight(carto)
  if (measured !== undefined) lastGroundHeight = measured
  const ground = measured ?? lastGroundHeight
  const aboveGround = carto.height - ground
  const toTarget = hit ? Cesium.Cartesian3.distance(camera.positionWC, hit) : Infinity
  // Room to zoom in = distance along the view until the camera reaches the height floor
  // (or the ground point it looks at, whichever comes first).
  const heightLeft = aboveGround - MIN_CAMERA_ABOVE_GROUND_M
  const down = Math.max(0.05, Math.sin(-camera.pitch) || 0.05)
  const roomIn = Math.max(0, Math.min(toTarget - MIN_CAMERA_ABOVE_GROUND_M, heightLeft / down))
  const roomOut = Math.max(0, MAX_CAMERA_DISTANCE_M - carto.height)
  return {
    canZoomIn: heightLeft > 2 && roomIn > 2,
    canZoomOut: roomOut > MAX_CAMERA_DISTANCE_M * 0.01,
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
    // How much the map loads. Measured on 2026-11-14 for the Jezero arrival view (warm cache):
    //   before: 1,400 tile requests, 2.4 s    now: about 500 requests, 1.0 s, same picture.
    // 1. Keep many tiles in memory, so ground you return to is there at once.
    scene.globe.tileCacheSize = 1000
    // 2. Do not preload the neighbours of every drawn tile (about 400 requests for tiles
    //    off screen). Parents are still preloaded: they are few and stop blank patches.
    scene.globe.preloadSiblings = false
    scene.globe.preloadAncestors = true
    // 3. Far ground near the horizon is drawn with coarser tiles. Fog is used only for this
    //    rule (and to drop tiles beyond sight), it is not drawn, so the picture does not change.
    scene.fog.enabled = true
    scene.fog.renderable = false
    scene.fog.screenSpaceErrorFactor = 4
    // 4. Detail: sharper than Cesium's default (2) when the camera is still, lighter while
    //    it moves (about 30% fewer requests again), so dragging keeps up with the mouse.
    //    Draw at the screen's real pixel density.
    scene.globe.maximumScreenSpaceError = DETAIL_STILL
    viewer.useBrowserRecommendedResolution = false
    viewer.camera.moveStart.addEventListener(() => {
      scene.globe.maximumScreenSpaceError = DETAIL_MOVING
    })
    viewer.camera.moveEnd.addEventListener(() => {
      scene.globe.maximumScreenSpaceError = DETAIL_STILL
      scene.requestRender()
    })
    // Only draw a new frame when something changes (saves work when the map is still).
    scene.requestRenderMode = true
    scene.maximumRenderTimeChange = Infinity
    scene.backgroundColor = Cesium.Color.TRANSPARENT

    // Stars only in 3D and only from space. In 2D the flat map fills the screen.
    const skyHostIsSpace = () => containerRef.current?.parentElement?.getAttribute('data-sky') !== 'mars'
    const updateSky = () => {
      if (scene.skyBox) scene.skyBox.show = scene.mode === Cesium.SceneMode.SCENE3D && skyHostIsSpace()
      if (scene.sun) scene.sun.show = false
      if (scene.moon) scene.moon.show = false
    }
    updateSky()
    scene.morphComplete.addEventListener(updateSky)

    // 2D: keep the map edges at the screen edges (no dragging the map off screen).
    const clamp2D = () => {
      if (scene.mode !== Cesium.SceneMode.SCENE2D) return
      const f = viewer.camera.frustum as Cesium.OrthographicOffCenterFrustum
      if (f.right === undefined || f.left === undefined || f.top === undefined || f.bottom === undefined) return
      const halfW = (f.right - f.left) / 2
      const halfH = (f.top - f.bottom) / 2
      const p = viewer.camera.position
      const limit = (value: number, half: number, world: number) =>
        half >= world ? 0 : Math.min(world - half, Math.max(-world + half, value))
      p.x = limit(p.x, halfW, HALF_WORLD_X)
      p.y = limit(p.y, halfH, HALF_WORLD_Y)
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

    // In 3D near the ground, groundControls.ts takes over drag and tilt and switches Cesium's
    // own off. It only does that in 3D, so after a switch to 2D they must be turned back on,
    // or the flat map could not be dragged.
    const restoreCesiumControls = () => {
      ssc.enableTilt = true
      ssc.enableRotate = true
      ssc.enableTranslate = true
    }
    scene.morphComplete.addEventListener(restoreCesiumControls)

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
        landingGround = ground.height
        landingPin.position = new Cesium.ConstantPositionProperty(
          Cesium.Cartesian3.fromDegrees(PERSEVERANCE_LANDING.lon, PERSEVERANCE_LANDING.lat, ground.height, MARS_ELLIPSOID),
        )
        // While the user looks at the globe, download the tiles of the "Fly to Jezero" views,
        // so the flight arrives on a sharp ground (see preload.ts).
        void whenIdle(viewer).then(() => {
          if (destroyed) return
          const { overview, descent } = jezeroViews(landingGround)
          void preloadView(viewer, overview, landingGround, 'Jezero overview')
          void preloadView(viewer, descent, landingGround, 'Jezero descent')
        })
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
      destination: Cesium.Cartesian3.fromDegrees(77.45, 18.44, START_HEIGHT_M, MARS_ELLIPSOID),
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

/** A place and how much ground is seen around it, kept across a 2D / 3D switch. */
interface SwitchTarget {
  /** Radians. */
  lon: number
  lat: number
  /** Width of ground seen across the screen, in metres. Infinity = the whole planet. */
  width: number
}

/** 3D: the ground point at the screen centre and the width of ground seen around it. */
function read3DView(viewer: Cesium.Viewer): SwitchTarget | undefined {
  const { scene, camera } = viewer
  const canvas = scene.canvas
  const centre = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2)
  const ray = camera.getPickRay(centre)
  // The 3D ground first (Trek terrain is above the sphere), then the sphere.
  const hit = (ray ? scene.globe.pick(ray, scene) : undefined) ?? camera.pickEllipsoid(centre, MARS_ELLIPSOID)
  const position = camera.positionWC
  const perMetre = widthPerMetre(viewer)

  // Whole planet on screen (its edge fits inside the narrow side of the view): 2D shows the
  // whole map. A little margin, so "almost all" also counts.
  const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight)
  const tanHalfNarrow = Math.min(perMetre / 2, perMetre / 2 / aspect)
  const fromCentre = Cesium.Cartesian3.magnitude(position)
  const wholePlanet =
    fromCentre > MARS_ELLIPSOID.maximumRadius &&
    Math.asin(MARS_ELLIPSOID.maximumRadius / fromCentre) <= Math.atan(tanHalfNarrow) * 1.1

  // Nothing at the centre (looking at the sky): use the point under the camera.
  const carto = Cesium.Cartographic.fromCartesian(hit ?? position, MARS_ELLIPSOID)
  if (!carto || !Number.isFinite(carto.longitude) || !Number.isFinite(carto.latitude)) return undefined
  const distance = hit
    ? Cesium.Cartesian3.distance(position, hit)
    : Math.max(1, carto.height - (scene.globe.getHeight(carto) ?? lastGroundHeight))
  return { lon: carto.longitude, lat: carto.latitude, width: wholePlanet ? Infinity : distance * perMetre }
}

/** 2D: the map point at the screen centre and the view width. */
function read2DView(viewer: Cesium.Viewer): SwitchTarget | undefined {
  const { scene, camera } = viewer
  const f = camera.frustum as Cesium.OrthographicOffCenterFrustum
  if (f.right === undefined || f.left === undefined) return undefined
  const centre = new Cesium.Cartesian2(scene.canvas.clientWidth / 2, scene.canvas.clientHeight / 2)
  const hit = camera.pickEllipsoid(centre, MARS_ELLIPSOID)
  const carto = hit ? Cesium.Cartographic.fromCartesian(hit, MARS_ELLIPSOID) : camera.positionCartographic
  if (!carto || !Number.isFinite(carto.longitude) || !Number.isFinite(carto.latitude)) return undefined
  const width = f.right - f.left
  return { lon: carto.longitude, lat: carto.latitude, width: width >= maxWidth2D(scene) * 0.95 ? Infinity : width }
}

/** 2D, north up, centred on the target, about the same width (inside the 2D zoom limits). */
function show2D(viewer: Cesium.Viewer, target: SwitchTarget) {
  const width = Math.min(maxWidth2D(viewer.scene), Math.max(MIN_WIDTH_2D_M, target.width))
  // In 2D, setView's height becomes the view width on the ground (Camera.js setView2D:
  // frustum right - left = height). clamp2D then keeps the map edges at the screen edges.
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromRadians(target.lon, target.lat, width, MARS_ELLIPSOID),
    orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0 },
  })
}

/** 3D, looking north at the target from the south with a 45° tilt, about the same width. */
function show3D(viewer: Cesium.Viewer, target: SwitchTarget) {
  const { scene, camera } = viewer
  if (!Number.isFinite(target.width)) {
    // The whole map in 2D: the whole planet in 3D, like the start view.
    camera.setView({
      destination: Cesium.Cartesian3.fromRadians(target.lon, target.lat, START_HEIGHT_M, MARS_ELLIPSOID),
      orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0 },
    })
    return
  }
  const distance = Math.min(target.width / widthPerMetre(viewer), MAX_CAMERA_DISTANCE_M)
  const topDown = distance > TOP_DOWN_BEYOND_M
  // Look at the real ground: Trek terrain is about 5.6 km above the sphere near Jezero.
  const ground = scene.globe.getHeight(new Cesium.Cartographic(target.lon, target.lat)) ?? lastGroundHeight
  const focus = Cesium.Cartesian3.fromRadians(target.lon, target.lat, topDown ? 0 : ground, MARS_ELLIPSOID)
  camera.lookAt(focus, new Cesium.HeadingPitchRange(0, topDown ? -Cesium.Math.PI_OVER_TWO : SWITCH_PITCH_RAD, distance))
  camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
  // The camera's own spot can be higher than the target (a crater rim): stay above it.
  const carto = camera.positionCartographic
  const floor = (scene.globe.getHeight(carto) ?? ground) + MIN_CAMERA_ABOVE_GROUND_M
  if (carto.height < floor) {
    camera.setView({
      destination: Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, floor, MARS_ELLIPSOID),
      orientation: { heading: camera.heading, pitch: camera.pitch, roll: 0 },
    })
  }
}

/**
 * Switch between 2D and 3D, staying at the same place and about the same zoom.
 * The view is read BEFORE the switch (camera values are not valid during the animation) and
 * applied when Cesium reports the switch complete. Returns false if a switch is still running.
 */
export function setViewMode(viewer: Cesium.Viewer, mode: ViewMode): boolean {
  const { scene } = viewer
  if (scene.mode === Cesium.SceneMode.MORPHING) return false
  const to2D = mode === '2D'
  if (scene.mode === (to2D ? Cesium.SceneMode.SCENE2D : Cesium.SceneMode.SCENE3D)) return true

  viewer.camera.cancelFlight()
  jezeroFlight++ // a paused "Fly to Jezero" must not continue in the new mode

  let target: SwitchTarget | undefined
  try {
    target = to2D ? read3DView(viewer) : read2DView(viewer)
  } catch (err) {
    console.warn('[MarsViewer] could not read the view before the switch', err)
  }
  // The map normally draws a frame only when something changes (requestRenderMode). A mode
  // switch is an animation that needs every frame: without this it took 3 to 4 seconds
  // (measured), because it only advanced when a tile happened to load.
  scene.requestRenderMode = false
  const done = () => {
    scene.morphComplete.removeEventListener(done)
    scene.requestRenderMode = true
    if (!target) return // keep Cesium's own end view
    // Runs inside a Cesium event: an error here must not stop the map from drawing.
    try {
      if (to2D) show2D(viewer, target)
      else show3D(viewer, target)
      scene.requestRender()
    } catch (err) {
      console.warn('[MarsViewer] could not keep the place after the switch', err)
    }
  }
  scene.morphComplete.addEventListener(done)
  if (to2D) scene.morphTo2D(MORPH_SECONDS)
  else scene.morphTo3D(MORPH_SECONDS)
  return true
}

/** Shortest and longest wait above the crater before the descent (see flyToJezero). */
const OVERVIEW_MIN_PAUSE_MS = 600
const OVERVIEW_MAX_PAUSE_MS = 4_000

/**
 * The two stages of the 3D Jezero flight, like arriving from orbit:
 *   1. Overview: straight above Jezero, looking down, the whole crater in view.
 *   2. Descent: near the ground, looking north over the landing site and the delta.
 * Trek terrain at Jezero sits about +5.6 km on its own height scale (PLAN.md section 12),
 * so heights are measured from the real ground.
 */
function jezeroViews(ground: number): { overview: CameraView; descent: CameraView } {
  const { lon, lat } = PERSEVERANCE_LANDING
  return {
    overview: {
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, ground + 120_000, MARS_ELLIPSOID),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
    },
    descent: {
      destination: Cesium.Cartesian3.fromDegrees(lon, lat - 0.045, ground + 1_500, MARS_ELLIPSOID),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-14), roll: 0 },
    },
  }
}

/**
 * Fly the camera down to Jezero: overview from above first, then descend to near the ground.
 * The tiles of both views are downloaded from the start of the flight (most are already in
 * the browser cache from the warm-up after start, see preload.ts). Above the crater the camera
 * waits until the overview is drawn and the descent's tiles are in, so it arrives sharp.
 */
export function flyToJezero(viewer: Cesium.Viewer, duration = 4) {
  const { lon, lat } = PERSEVERANCE_LANDING
  const { scene, camera } = viewer
  const flight = ++jezeroFlight
  const ground = landingGround

  if (scene.mode === Cesium.SceneMode.SCENE2D) {
    // The 2D view needs the same tiles as a 3D camera looking straight down at the same width.
    const above: CameraView = {
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, ground + JEZERO_2D_WIDTH_M / widthPerMetre(viewer), MARS_ELLIPSOID),
      orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0 },
    }
    void preloadView(viewer, above, ground, 'Jezero 2D')
    // In 2D the height given to flyTo becomes the view width on the ground.
    camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(lon, lat, JEZERO_2D_WIDTH_M, MARS_ELLIPSOID), duration })
    return
  }

  const { overview, descent } = jezeroViews(ground)
  void preloadView(viewer, overview, ground, 'Jezero overview')
  const descentReady = preloadView(viewer, descent, ground, 'Jezero descent')
  camera.flyTo({
    ...overview,
    duration: duration * 0.55,
    easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT,
    // Pause above the crater until the overview is sharp and the descent's tiles are in
    // (at least a short moment, so the area is understood, at most a few seconds).
    complete: () => {
      void waitForTiles(viewer, { minMs: OVERVIEW_MIN_PAUSE_MS, maxMs: OVERVIEW_MAX_PAUSE_MS, also: descentReady }).then(() => {
        // Skip the descent if the user grabbed the map during the pause, or a newer flight started.
        if (viewer.isDestroyed() || flight !== jezeroFlight) return
        camera.flyTo({
          ...descent,
          duration: duration * 0.8,
          easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
        })
      })
    },
  })
}
