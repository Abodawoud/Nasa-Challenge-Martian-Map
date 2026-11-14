import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import * as Cesium from 'cesium'
import { IconButton, Separator, VStack } from '@chakra-ui/react'
import { Globe, Maximize, Minimize, Minus, Navigation2, Plus } from 'lucide-react'
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
    // During a 2D / 3D switch the camera has no heading for a moment. Skip those frames,
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
  // Works the same in 2D and 3D because it uses Cesium's own zoomIn / zoomOut.
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
    <VStack position="absolute" bottom="14" right="4" zIndex="10" gap="2">
      <ControlGroup>
        <ControlButton label="Zoom in" onClick={() => zoom(1)} disabled={!canZoomIn}>
          <Plus size={18} aria-hidden />
        </ControlButton>
        <Separator />
        <ControlButton label="Zoom out" onClick={() => zoom(-1)} disabled={!canZoomOut}>
          <Minus size={18} aria-hidden />
        </ControlButton>
      </ControlGroup>

      <ControlGroup>
        <ControlButton label="Reset north" onClick={resetNorth}>
          {/* The arrow keeps pointing to north while the view turns. */}
          <Navigation2
            size={18}
            aria-hidden
            color="#fc3d21"
            fill="#fc3d21"
            style={{ transform: `rotate(${-heading}deg)`, transition: 'transform 120ms' }}
          />
        </ControlButton>
      </ControlGroup>

      <ControlGroup>
        <ControlButton label="Whole planet" onClick={wholePlanet}>
          <Globe size={18} aria-hidden />
        </ControlButton>
        <Separator />
        <ControlButton label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} onClick={toggleFullscreen}>
          {fullscreen ? <Minimize size={18} aria-hidden /> : <Maximize size={18} aria-hidden />}
        </ControlButton>
      </ControlGroup>
    </VStack>
  )
}

/** A white rounded card that holds one or two control buttons. */
function ControlGroup({ children }: { children: ReactNode }) {
  return (
    <VStack gap="0" bg="white" borderWidth="1px" borderColor="gray.200" borderRadius="xl" shadow="md" overflow="hidden">
      {children}
    </VStack>
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
    <IconButton
      aria-label={label}
      title={disabled ? `${label} (limit reached)` : label}
      onClick={onClick}
      disabled={disabled}
      variant="ghost"
      colorPalette="brand"
      color="gray.700"
      size="md"
      borderRadius="0"
    >
      {children}
    </IconButton>
  )
}
