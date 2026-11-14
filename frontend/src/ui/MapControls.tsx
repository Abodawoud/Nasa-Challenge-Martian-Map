import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import * as Cesium from 'cesium'

/** The usual map buttons: zoom, compass (reset north), whole planet, fullscreen. */
export function MapControls({ viewer }: { viewer: Cesium.Viewer | null }) {
  const [heading, setHeading] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    if (!viewer) return
    const camera = viewer.camera
    camera.percentageChanged = 0.001
    // During a 2D / 2.5D / 3D switch the camera has no heading for a moment. Skip those frames,
    // an error here would stop Cesium rendering.
    const update = () => {
      const h = camera.heading
      if (typeof h === 'number' && Number.isFinite(h)) setHeading(Cesium.Math.toDegrees(h))
    }
    update()
    const remove = camera.changed.addEventListener(update)
    return () => remove()
  }, [viewer])

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const zoom = (direction: 1 | -1) => {
    if (!viewer) return
    const { camera, scene } = viewer
    const frustum = camera.frustum as Cesium.OrthographicOffCenterFrustum
    const size =
      scene.mode === Cesium.SceneMode.SCENE2D
        ? (frustum.right ?? 0) - (frustum.left ?? 0)
        : camera.positionCartographic.height
    const amount = Math.abs(size) * 0.4
    if (direction === 1) camera.zoomIn(amount)
    else camera.zoomOut(amount)
  }

  const resetNorth = () => {
    if (!viewer) return
    const { camera } = viewer
    camera.flyTo({
      destination: camera.positionWC.clone(),
      orientation: { heading: 0, pitch: camera.pitch, roll: 0 },
      duration: 0.6,
    })
  }

  const wholePlanet = () => {
    viewer?.camera.flyTo({ destination: Cesium.Rectangle.fromDegrees(-180, -80, 180, 80), duration: 2 })
  }

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen()
  }

  return (
    <div className="absolute bottom-14 right-4 z-10 flex flex-col gap-2">
      <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-md">
        <ControlButton label="Zoom in" onClick={() => zoom(1)}>
          <path d="M12 5v14M5 12h14" />
        </ControlButton>
        <div className="h-px bg-slate-200" />
        <ControlButton label="Zoom out" onClick={() => zoom(-1)}>
          <path d="M5 12h14" />
        </ControlButton>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-md">
        <ControlButton label="Reset north" onClick={resetNorth}>
          <g style={{ transform: `rotate(${-heading}deg)`, transformOrigin: '12px 12px', transition: 'transform 120ms' }}>
            <path d="M12 3l3.5 9h-7z" fill="#FC3D21" stroke="none" />
            <path d="M12 21l-3.5-9h7z" fill="#94a3b8" stroke="none" />
          </g>
        </ControlButton>
      </div>

      <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-md">
        <ControlButton label="Whole planet" onClick={wholePlanet}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M3.5 12h17M12 3.5c2.6 2.6 2.6 14.4 0 17M12 3.5c-2.6 2.6-2.6 14.4 0 17" />
        </ControlButton>
        <div className="h-px bg-slate-200" />
        <ControlButton label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} onClick={toggleFullscreen}>
          {fullscreen ? (
            <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
          ) : (
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          )}
        </ControlButton>
      </div>
    </div>
  )
}

function ControlButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-10 w-10 items-center justify-center text-slate-700 transition-colors hover:bg-slate-100 hover:text-nasa-blue focus-visible:outline-2 focus-visible:outline-nasa-blue active:bg-slate-200"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  )
}
