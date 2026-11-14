import { useCallback, useEffect, useRef, useState } from 'react'
import type * as Cesium from 'cesium'
import { MarsViewer, flyToJezero, setViewMode } from './globe/MarsViewer'
import type { CursorInfo, ViewMode } from './globe/MarsViewer'
import { MapControls } from './ui/MapControls'

type ApiStatus = 'checking' | 'ok' | 'down'

const MODES: ViewMode[] = ['2D', '2.5D', '3D']

export default function App() {
  const viewerRef = useRef<Cesium.Viewer | null>(null)
  const [mode, setMode] = useState<ViewMode>('3D')
  const [cursor, setCursor] = useState<CursorInfo | null>(null)
  const [terrain, setTerrain] = useState<'loading' | 'trek' | 'flat'>('loading')
  const [api, setApi] = useState<ApiStatus>('checking')
  const [viewer, setViewer] = useState<Cesium.Viewer | null>(null)

  useEffect(() => {
    fetch('/api/health')
      .then((r) => setApi(r.ok ? 'ok' : 'down'))
      .catch(() => setApi('down'))
  }, [])

  const onReady = useCallback((v: Cesium.Viewer) => {
    viewerRef.current = v
    setViewer(v)
  }, [])

  const changeMode = (m: ViewMode) => {
    if (!viewerRef.current || m === mode) return
    setMode(m)
    setViewMode(viewerRef.current, m)
  }

  return (
    <div className="mars-space relative h-full w-full overflow-hidden">
      <MarsViewer onReady={onReady} onCursor={setCursor} onTerrainStatus={setTerrain} />

      <MapControls viewer={viewer} />

      {/* Top bar */}
      <header className="absolute inset-x-0 top-0 z-10 flex items-center gap-4 border-b border-slate-200 bg-white/95 px-5 py-3 shadow-sm backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-nasa-blue text-sm font-bold text-white">M</div>
          <div className="leading-tight">
            <h1 className="text-[15px] font-semibold text-slate-900">Martian Map</h1>
            <p className="text-xs text-slate-500">Jezero Crater Marswalk Planner</p>
          </div>
        </div>

        <nav aria-label="View mode" className="ml-auto flex rounded-lg border border-slate-200 bg-slate-50 p-1">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => changeMode(m)}
              aria-pressed={mode === m}
              className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors ${
                mode === m ? 'bg-nasa-blue text-white shadow-sm' : 'text-slate-600 hover:bg-white hover:text-slate-900'
              }`}
            >
              {m}
            </button>
          ))}
        </nav>

        <button
          type="button"
          onClick={() => viewerRef.current && flyToJezero(viewerRef.current)}
          className="rounded-lg bg-nasa-blue px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-nasa-blue-dark"
        >
          Fly to Jezero
        </button>
      </header>

      {/* Bottom status bar */}
      <footer className="absolute inset-x-0 bottom-0 z-10 flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-slate-200 bg-white/95 px-5 py-2 text-xs text-slate-600 backdrop-blur">
        <span className="tabular-nums">
          {cursor ? `Lat ${cursor.lat.toFixed(4)}° · Lon ${cursor.lon.toFixed(4)}° E` : 'Move the mouse over Mars'}
        </span>
        <StatusDot label="3D ground" state={terrain === 'trek' ? 'ok' : terrain === 'flat' ? 'warn' : 'wait'}
          text={terrain === 'trek' ? 'NASA Trek terrain' : terrain === 'flat' ? 'Smooth sphere (Trek terrain failed)' : 'Loading'} />
        <StatusDot label="Backend" state={api === 'ok' ? 'ok' : api === 'down' ? 'warn' : 'wait'}
          text={api === 'ok' ? 'Connected' : api === 'down' ? 'Not reachable' : 'Checking'} />
        <span className="ml-auto text-slate-500">Images and terrain: NASA/JPL-Caltech Mars Trek · USGS</span>
      </footer>
    </div>
  )
}

function StatusDot({ label, state, text }: { label: string; state: 'ok' | 'warn' | 'wait'; text: string }) {
  const color = state === 'ok' ? 'bg-emerald-500' : state === 'warn' ? 'bg-nasa-red' : 'bg-slate-400'
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${color}`} aria-hidden />
      <span className="font-medium text-slate-700">{label}:</span> {text}
    </span>
  )
}
