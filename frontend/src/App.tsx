import { useCallback, useEffect, useRef, useState } from 'react'
import type * as Cesium from 'cesium'
import { Box, Button, Circle, Flex, Group, Heading, HStack, Kbd, Status, Text } from '@chakra-ui/react'
import { Box as Box3D, Map as MapIcon, MapPin, Mouse, Rocket, Satellite } from 'lucide-react'
import { MarsViewer, flyToJezero, setViewMode } from './globe/MarsViewer'
import type { CursorInfo, ViewMode } from './globe/MarsViewer'
import { MapControls } from './ui/MapControls'
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
    // "mars-space" + data-sky (set by MarsViewer) draw the space or Mars sky behind the map.
    <Box className="mars-space" position="relative" h="full" w="full" overflow="hidden">
      <MarsViewer onReady={onReady} onCursor={setCursor} onTerrainStatus={setTerrain} />

      <MapControls viewer={viewer} />

      {/* Top bar */}
      <Flex
        as="header"
        position="absolute"
        insetX="0"
        top="0"
        zIndex="10"
        align="center"
        gap="4"
        px="5"
        py="2.5"
        bg="whiteAlpha.900"
        backdropFilter="blur(8px)"
        borderBottomWidth="1px"
        borderColor="gray.200"
        shadow="sm"
      >
        <HStack gap="3">
          <Circle size="9" bg="brand.600" color="white">
            <Satellite size={18} aria-hidden />
          </Circle>
          <Box lineHeight="short">
            <Heading as="h1" size="sm" color="gray.900">
              Martian Map
            </Heading>
            <Text fontSize="xs" color="gray.500">
              Jezero Crater Marswalk Planner
            </Text>
          </Box>
        </HStack>

        <Group attached ml="auto" role="group" aria-label="View mode">
          {MODES.map(({ mode: m, Icon: ModeIcon, hint }) => (
            <Button
              key={m}
              size="sm"
              colorPalette="brand"
              variant={mode === m ? 'solid' : 'outline'}
              bg={mode === m ? undefined : 'white'}
              aria-pressed={mode === m}
              title={hint}
              onClick={() => changeMode(m)}
            >
              <ModeIcon size={16} aria-hidden />
              {m}
            </Button>
          ))}
        </Group>

        <Button size="sm" colorPalette="brand" onClick={() => viewerRef.current && flyToJezero(viewerRef.current)}>
          <Rocket size={16} aria-hidden />
          Fly to Jezero
        </Button>
      </Flex>

      {/* Bottom status bar */}
      <Flex
        as="footer"
        position="absolute"
        insetX="0"
        bottom="0"
        zIndex="10"
        wrap="wrap"
        align="center"
        columnGap="6"
        rowGap="1"
        px="5"
        py="1.5"
        fontSize="xs"
        color="gray.600"
        bg="whiteAlpha.900"
        backdropFilter="blur(8px)"
        borderTopWidth="1px"
        borderColor="gray.200"
      >
        <HStack gap="1.5" fontVariantNumeric="tabular-nums" minW="230px">
          <MapPin size={13} aria-hidden />
          <Text>{cursor ? `Lat ${cursor.lat.toFixed(4)}° · Lon ${cursor.lon.toFixed(4)}° E` : 'Move the mouse over Mars'}</Text>
        </HStack>
        <HStack gap="1.5" color="gray.500" hideBelow="lg">
          <Mouse size={13} aria-hidden />
          <Text>
            <Kbd size="sm">Drag</Kbd> move · <Kbd size="sm">Ctrl</Kbd> + <Kbd size="sm">Drag</Kbd>{' '}
            {mode === '2D' ? 'turn' : 'turn and tilt'} · <Kbd size="sm">Wheel</Kbd> zoom
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
        <Text ml="auto" color="gray.500">
          Images and terrain: NASA/JPL-Caltech Mars Trek · USGS
        </Text>
      </Flex>
    </Box>
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
        <Text as="span" fontWeight="medium" color="gray.700">
          {label}:
        </Text>{' '}
        {text}
      </Text>
    </HStack>
  )
}
