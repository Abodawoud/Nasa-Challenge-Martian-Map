import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import * as Cesium from 'cesium'
import { getZoomState } from '../globe/MarsViewer'

/** The usual map buttons: zoom, compass (reset north), whole planet, fullscreen. */
export function MapControls({ viewer }: { viewer: Cesium.Viewer | null }) {
  const [heading, setHeading] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)
  const [canZoomIn, setCanZoomIn] = useState(true)
  const [canZoomOut, setCanZoomOut] = useState(true)

  useEffect(() => {
    if (!viewer) return
    const camera = viewer.camera
    camera.percentageChanged = 0.001
    // During a 2D / 2.5D / 3D switch the camera has no heading for a moment. Skip those frames,
    // an error here would stop Cesium rendering.
    const update = () => {
      const h = camera.heading
      if (typeof h === 'number' && Number.isFinite(h)) setHeading(Cesium.Math.toDegrees(h))
      try {
        const zoom = getZoomState(viewer)
        setCanZoomIn(zoom.canZoomIn)
        setCanZoomOut(zoom.canZoomOut)
      } catch {
        // A camera in mid-switch can't be measured; keep the last state.
      }
    }
    update()
    const removeCamera = camera.changed.addEventListener(update)
    // Also after a mode switch and when terrain under the camera finishes loading.
    const removeMorph = viewer.scene.morphComplete.addEventListener(update)
    const removeTiles = viewer.scene.globe.tileLoadProgressEvent.addEventListener((left: number) => {
      if (left === 0) update()
    })
    return () => {
      removeCamera()
      removeMorph()
      removeTiles()
    }
  }, [viewer])

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // Smooth zoom: one step is 45% of the current size, spread over ~350 ms with an ease-out
  // curve. The step is cut to the room left before the limit, so it stops exactly there.
  // Works the same in 2D, 2.5D and 3D because it uses Cesium's own zoomIn / zoomOut.
  const zoom = (direction: 1 | -1) => {
    if (!viewer) return
    const { camera, scene } = viewer
    const state = getZoomState(viewer)
    if (direction === 1 ? !state.canZoomIn : !state.canZoomOut) return
    const room = direction === 1 ? state.roomIn : state.roomOut
    const total = Math.min(state.size * 0.45, room)
    const duration = 350
    const start = performance.now()
    let done = 0
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const target = total * easeOut(t)
      const delta = target - done
      done = target
      if (delta > 0) {
        if (direction === 1) camera.zoomIn(delta)
        else camera.zoomOut(delta)
      }
      scene.requestRender()
      if (t < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
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
        <ControlButton label="Zoom in" onClick={() => zoom(1)} disabled={!canZoomIn}>
          <path d="M12 5v14M5 12h14" />
        </ControlButton>
        <div className="h-px bg-slate-200" />
        <ControlButton label="Zoom out" onClick={() => zoom(-1)} disabled={!canZoomOut}>
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

function ControlButton({
  label,
  onClick,
  disabled = false,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={disabled ? `${label} (limit reached)` : label}
      className="flex h-10 w-10 items-center justify-center text-slate-700 transition-colors hover:bg-slate-100 hover:text-nasa-blue focus-visible:outline-2 focus-visible:outline-nasa-blue active:bg-slate-200 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent disabled:hover:text-slate-300"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  )
}
