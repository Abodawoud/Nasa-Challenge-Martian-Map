import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type * as Cesium from 'cesium'
import { Box, Button, Flex, Heading, HStack, Link, Status, Text } from '@chakra-ui/react'
import { Box as Box3D, Map as MapIcon, MapPin, Mouse, Rocket } from 'lucide-react'
import { MarsViewer, flyToJezero, setViewMode } from './globe/MarsViewer'
import type { CursorInfo, ViewMode } from './globe/MarsViewer'
import { MapControls } from './ui/MapControls'
import { LayersPanel } from './ui/LayersPanel'
import { MapLegend } from './ui/MapLegend'
import { PlacesPanel, SourcesPanel, ToolRail } from './ui/Sidebar'
import { MeasurePanel } from './ui/MeasurePanel'
import { IdentifyPanel } from './ui/IdentifyPanel'
import type { Tool } from './ui/Sidebar'
import { CompassStar } from './ui/CompassStar'
import { visibleTilesLoaded } from './globe/preload'

type ApiStatus = 'checking' | 'ok' | 'down'

const MODES: Array<{ mode: ViewMode; Icon: typeof MapIcon; hint: string }> = [
  { mode: '2D', Icon: MapIcon, hint: 'Flat map' },
  { mode: '3D', Icon: Box3D, hint: 'The planet with real terrain' },
]

/** Short loads (moving the map a little) do not flash the status: show "Loading" after this. */
const LOADING_DELAY_MS = 300

export default function App() {
  const viewerRef = useRef<Cesium.Viewer | null>(null)
  const [mode, setMode] = useState<ViewMode>('3D')
  const [cursor, setCursor] = useState<CursorInfo | null>(null)
  const [terrain, setTerrain] = useState<'loading' | 'trek' | 'flat'>('loading')
  const [api, setApi] = useState<ApiStatus>('checking')
  const [viewer, setViewer] = useState<Cesium.Viewer | null>(null)
  const [tilesLoading, setTilesLoading] = useState(true)
  const [activeLayers, setActiveLayers] = useState<string[]>([])
  // The tool bar: which left panel is open, and whether the legend card shows.
  const [tool, setTool] = useState<Tool | null>(null)
  const [legendOpen, setLegendOpen] = useState(true)
  const closeTool = useCallback(() => setTool(null), [])

  useEffect(() => {
    fetch('/api/health')
      .then((r) => setApi(r.ok ? 'ok' : 'down'))
      .catch(() => setApi('down'))
  }, [])

  // Map status: "Loading" while tiles the camera can see are still waiting. Tiles that Cesium
  // preloads around the view do not count (see visibleTilesLoaded).
  useEffect(() => {
    if (!viewer) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const remove = viewer.scene.globe.tileLoadProgressEvent.addEventListener(() => {
      if (visibleTilesLoaded(viewer)) {
        clearTimeout(timer)
        timer = undefined
        setTilesLoading(false)
      } else if (timer === undefined) {
        timer = setTimeout(() => setTilesLoading(true), LOADING_DELAY_MS)
      }
    })
    return () => {
      clearTimeout(timer)
      remove()
    }
  }, [viewer])

  const onReady = useCallback((v: Cesium.Viewer) => {
    viewerRef.current = v
    setViewer(v)
  }, [])

  const changeMode = (m: ViewMode) => {
    if (!viewerRef.current || m === mode) return
    // Ignored while a switch is still running.
    if (setViewMode(viewerRef.current, m)) setMode(m)
  }

  return (
    // Three rows: top bar, map (with the tool bar at its left), status bar. The map has its
    // own area in the middle, so the bars never cover any part of it. Both bars are the navy of the logo, like the start page.
    <Flex direction="column" h="100vh" w="full" overflow="hidden" bg="brand.900">
      {/* Top bar */}
      <Flex
        as="header"
        position="relative"
        align="center"
        gap={{ base: '2', md: '4' }}
        px={{ base: '3', md: '5' }}
        py="2.5"
        color="white"
        bgGradient="to-r"
        gradientFrom="brand.800"
        gradientTo="brand.700"
        zIndex="1"
        flexShrink={0}
      >
        <Link href="#/" aria-label="Back to the Red Compass start page" color="white" borderRadius="lg" _hover={{ textDecoration: 'none', opacity: 0.85 }}>
          <HStack gap="3">
            <CompassStar size={38} />
            <Box lineHeight="1.2">
              <Heading as="h1" fontSize="md" fontWeight="700" letterSpacing="-0.01em" color="white">
                Martian Map
              </Heading>
              <Text fontSize="xs" color="whiteAlpha.700">
                Red Compass
              </Text>
            </Box>
          </HStack>
        </Link>

        {/* Where the map is about. */}
        <HStack gap="1.5" px="3" py="1" borderRadius="full" borderWidth="1px" borderColor="whiteAlpha.300" bg="whiteAlpha.100" fontSize="xs" color="whiteAlpha.900" hideBelow="md">
          <MapPin size={13} aria-hidden color="#e8231f" />
          <Text>Jezero Crater · Mars</Text>
        </HStack>

        {/* 2D / 3D switch: a pill, the chosen side is white. */}
        <HStack ml="auto" gap="0.5" p="1" borderRadius="full" borderWidth="1px" borderColor="whiteAlpha.300" bg="whiteAlpha.100" role="group" aria-label="View mode">
          {MODES.map(({ mode: m, Icon: ModeIcon, hint }) => (
            <Button
              key={m}
              size="xs"
              h="7"
              px="3.5"
              borderRadius="full"
              fontWeight="600"
              bg={mode === m ? 'white' : 'transparent'}
              color={mode === m ? 'brand.700' : 'whiteAlpha.900'}
              _hover={{ bg: mode === m ? 'white' : 'whiteAlpha.200' }}
              _focusVisible={{ outline: '2px solid white', outlineOffset: '2px' }}
              aria-pressed={mode === m}
              title={hint}
              onClick={() => changeMode(m)}
            >
              <ModeIcon size={14} aria-hidden />
              {m}
            </Button>
          ))}
        </HStack>

        <Button
          size="sm"
          borderRadius="full"
          px="4"
          bg="white"
          color="brand.700"
          fontWeight="600"
          _hover={{ bg: 'brand.50' }}
          _focusVisible={{ outline: '2px solid white', outlineOffset: '2px' }}
          onClick={() => viewerRef.current && flyToJezero(viewerRef.current)}
        >
          <Rocket size={15} aria-hidden />
          <Text as="span" hideBelow="sm">
            Fly to Jezero
          </Text>
        </Button>

        {/* A thin red line under the bar, from the logo. */}
        <Box aria-hidden position="absolute" insetX="0" bottom="0" h="2px" bgGradient="to-r" gradientFrom="nasaRed" gradientVia="nasaRed" gradientTo="transparent" />
      </Flex>

      {/* Middle row: the tool bar, then the map. */}
      <Flex flex="1" minH="0">
        <ToolRail tool={tool} onTool={setTool} legendOpen={legendOpen} onLegend={setLegendOpen} layerCount={activeLayers.length} />
        {/* The map. "mars-space" + data-sky (set by MarsViewer) draw the space or Mars sky behind it. */}
        <Box className="mars-space" position="relative" flex="1" minW="0" minH="0" overflow="hidden">
          <MarsViewer onReady={onReady} onCursor={setCursor} onTerrainStatus={setTerrain} />
          <LayersPanel viewer={viewer} onActiveChange={setActiveLayers} open={tool === 'layers'} onClose={closeTool} />
          <MeasurePanel viewer={viewer} open={tool === 'measure'} onClose={closeTool} />
          <IdentifyPanel viewer={viewer} open={tool === 'identify'} onClose={closeTool} />
          {tool === 'places' && <PlacesPanel viewer={viewer} onClose={closeTool} />}
          {tool === 'sources' && <SourcesPanel onClose={closeTool} />}
          <MapLegend activeLayers={activeLayers} open={legendOpen} onClose={() => setLegendOpen(false)} />
          <MapControls viewer={viewer} />
        </Box>
      </Flex>

      {/* Bottom status bar */}
      <Flex
        as="footer"
        wrap="wrap"
        align="center"
        columnGap="5"
        rowGap="1"
        px={{ base: '3', md: '5' }}
        py="1.5"
        fontSize="xs"
        color="whiteAlpha.800"
        bg="brand.800"
        borderTopWidth="1px"
        borderColor="whiteAlpha.200"
        flexShrink={0}
      >
        <HStack gap="1.5" fontVariantNumeric="tabular-nums" minW="230px" color="white">
          <MapPin size={13} aria-hidden />
          <Text>{cursor ? `Lat ${cursor.lat.toFixed(4)}° · Lon ${cursor.lon.toFixed(4)}° E` : 'Move the mouse over Mars'}</Text>
        </HStack>
        <HStack gap="1.5" color="whiteAlpha.700" hideBelow="lg">
          <Mouse size={13} aria-hidden />
          <Text>
            <Key>Drag</Key> move ·{' '}
            {mode === '3D' && (
              <>
                <Key>Ctrl</Key> + <Key>Drag</Key> turn and tilt ·{' '}
              </>
            )}
            <Key>Wheel</Key> zoom
          </Text>
        </HStack>
        <StatusItem label="Map" state={tilesLoading ? 'wait' : 'ok'} text={tilesLoading ? 'Loading' : 'Ready'} />
        <StatusItem
          label="3D ground"
          state={terrain === 'trek' ? 'ok' : terrain === 'flat' ? 'warn' : 'wait'}
          text={terrain === 'trek' ? 'NASA Trek terrain' : terrain === 'flat' ? 'Smooth sphere (Trek terrain failed)' : 'Loading'}
        />
        <StatusItem
          label="Backend"
          state={api === 'ok' ? 'ok' : api === 'down' ? 'warn' : 'wait'}
          text={api === 'ok' ? 'Connected' : api === 'down' ? 'Not reachable' : 'Checking'}
        />
        <Text ml="auto" color="whiteAlpha.600">
          Images and terrain: NASA/JPL-Caltech Mars Trek · USGS
        </Text>
      </Flex>
    </Flex>
  )
}

/** A key or mouse action, drawn as a small key cap. */
function Key({ children }: { children: ReactNode }) {
  return (
    <Text as="kbd" px="1.5" py="0.5" borderRadius="sm" borderWidth="1px" borderColor="whiteAlpha.300" bg="whiteAlpha.200" color="white" fontFamily="inherit" fontSize="2xs" fontWeight="600">
      {children}
    </Text>
  )
}

/** A coloured dot with a label: green = fine, red = problem, grey = waiting. */
function StatusItem({ label, state, text }: { label: string; state: 'ok' | 'warn' | 'wait'; text: string }) {
  const palette = state === 'ok' ? 'green' : state === 'warn' ? 'red' : 'gray'
  return (
    <HStack gap="1.5">
      <Status.Root size="sm" colorPalette={palette}>
        <Status.Indicator />
      </Status.Root>
      <Text>
        <Text as="span" color="whiteAlpha.600">
          {label}
        </Text>{' '}
        <Text as="span" fontWeight="medium" color="white">
          {text}
        </Text>
      </Text>
    </HStack>
  )
}
