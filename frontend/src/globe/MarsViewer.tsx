import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { MARS_ELLIPSOID, MARS_TILING, PERSEVERANCE_LANDING, TREK_TERRAIN_URL } from './mars'
import { IMAGERY_LAYERS, TREK_TILE_ROOT } from './layers.config'
import type { TrekImageryLayer } from './layers.config'
import { tintToMars } from './tint'

export type ViewMode = '2D' | '2.5D' | '3D'

export interface CursorInfo {
  lon: number
  lat: number
}

interface Props {
  onReady: (viewer: Cesium.Viewer) => void
  onCursor: (info: CursorInfo | null) => void
  onTerrainStatus: (status: 'trek' | 'flat') => void
}

/** Trek WMTS provider that recolours black-and-white tiles to Mars colours (see tint.ts). */
class TintedTrekProvider extends Cesium.WebMapTileServiceImageryProvider {
  requestImage(x: number, y: number, level: number, request?: Cesium.Request) {
    const pending = super.requestImage(x, y, level, request)
    if (!pending) return pending
    return Promise.resolve(pending).then((img) =>
      tintToMars(img as CanvasImageSource & { width: number; height: number }),
    ) as ReturnType<Cesium.WebMapTileServiceImageryProvider['requestImage']>
  }
}

function makeTrekProvider(layer: TrekImageryLayer) {
  const format = layer.ext === 'jpg' ? 'image/jpeg' : 'image/png'
  const Provider = layer.tintToMars ? TintedTrekProvider : Cesium.WebMapTileServiceImageryProvider
  return new Provider({
    // The double slash after 1.0.0 is how Trek publishes its template. It is correct.
    url: `${TREK_TILE_ROOT}/${layer.layerId}/1.0.0//{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.${layer.ext}`,
    layer: layer.layerId,
    style: 'default',
    tileMatrixSetID: 'default028mm',
    format,
    tilingScheme: MARS_TILING,
    maximumLevel: layer.maximumLevel,
    rectangle: layer.bounds ? Cesium.Rectangle.fromDegrees(...layer.bounds) : undefined,
    credit: new Cesium.Credit(layer.source),
  })
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
      // 2D map has real left and right edges, no endless horizontal scrolling.
      mapMode2D: Cesium.MapMode2D.ROTATE,
      // Transparent canvas, so the page's space gradient shows behind the map (no flat black).
      contextOptions: { webgl: { alpha: true } },
    })
    const { scene } = viewer
    scene.globe.enableLighting = false
    scene.globe.showGroundAtmosphere = false
    scene.globe.baseColor = Cesium.Color.fromCssColorString('#8a5a44')
    scene.backgroundColor = Cesium.Color.TRANSPARENT

    // Stars only in 3D. In 2D and 2.5D the flat map floats on the page gradient.
    const updateSky = () => {
      if (scene.skyBox) scene.skyBox.show = scene.mode === Cesium.SceneMode.SCENE3D
      if (scene.sun) scene.sun.show = false
      if (scene.moon) scene.moon.show = false
    }
    updateSky()
    scene.morphComplete.addEventListener(updateSky)

    // 2D: keep the map edges at the screen edges (no dragging the map off screen).
    const halfWorldX = Math.PI * MARS_ELLIPSOID.maximumRadius
    const halfWorldY = halfWorldX / 2
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

    for (const layer of IMAGERY_LAYERS) {
      const imagery = viewer.imageryLayers.addImageryProvider(makeTrekProvider(layer))
      imagery.alpha = layer.defaultOpacity
      imagery.show = layer.visible
    }

    // Trek's own terrain. If it fails, fall back to a smooth sphere (README risk list).
    Cesium.CesiumTerrainProvider.fromUrl(TREK_TERRAIN_URL, {
      ellipsoid: MARS_ELLIPSOID,
      requestVertexNormals: true,
    })
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

    onReady(viewer)
    // Development only: reach the viewer from the browser console for checks.
    if (import.meta.env.DEV) (window as unknown as { __viewer: Cesium.Viewer }).__viewer = viewer

    return () => {
      destroyed = true
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

/** Fly the camera down to Jezero, tilted so the crater walls are visible. */
export function flyToJezero(viewer: Cesium.Viewer, duration = 4) {
  const { lon, lat } = PERSEVERANCE_LANDING
  if (viewer.scene.mode === Cesium.SceneMode.SCENE2D) {
    viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(lon, lat, 60_000, MARS_ELLIPSOID), duration })
    return
  }
  // Trek terrain at Jezero sits about +5.6 km on its own height scale, so the camera
  // height is measured from there.
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lon - 0.05, lat - 0.45, 30_000, MARS_ELLIPSOID),
    orientation: { heading: Cesium.Math.toRadians(5), pitch: Cesium.Math.toRadians(-32), roll: 0 },
    duration,
  })
}
