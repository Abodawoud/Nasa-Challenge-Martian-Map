// The tool bar at the left of the map, and two of its small tools.
//
// Each icon is one tool ("plugin"). A click opens its panel beside the bar, a second click
// closes it. Layers, Places and Sources share the left side, so one of them is open at a
// time. "Go to" flies to known places (the code calls it places). The Legend is its own card at the bottom right, so it can stay open next to them.
import { useState } from 'react'
import type { ReactNode } from 'react'
import type * as CesiumTypes from 'cesium'
import * as Cesium from 'cesium'
import { Box, Flex, IconButton, Link, Text, VStack } from '@chakra-ui/react'
import { BookOpen, ExternalLink, Layers, ListTree, ChevronUp, MapPin, Navigation, Palette, Route, Ruler, X } from 'lucide-react'
import { MARS_ELLIPSOID, PERSEVERANCE_LANDING } from '../globe/mars'
import { flyToJezero } from '../globe/MarsViewer'

export type Tool = 'layers' | 'toc' | 'route' | 'measure' | 'identify' | 'places' | 'sources'

interface RailProps {
  tool: Tool | null
  onTool: (tool: Tool | null) => void
  legendOpen: boolean
  onLegend: (open: boolean) => void
  /** How many layers are on, shown on the Layers icon. */
  layerCount: number
}

/** The narrow bar of tool icons. */
export function ToolRail({ tool, onTool, legendOpen, onLegend, layerCount }: RailProps) {
  const tools: Array<{ id: Tool; label: string; icon: ReactNode; badge?: number }> = [
    { id: 'layers', label: 'Layers', icon: <Layers size={19} aria-hidden />, badge: layerCount },
    { id: 'toc', label: 'TOC', icon: <ListTree size={19} aria-hidden /> },
    { id: 'route', label: 'Route', icon: <Route size={19} aria-hidden /> },
    { id: 'measure', label: 'Measure', icon: <Ruler size={19} aria-hidden /> },
    { id: 'identify', label: 'Place info', icon: <MapPin size={19} aria-hidden /> },
    { id: 'places', label: 'Go to', icon: <Navigation size={19} aria-hidden /> },
    { id: 'sources', label: 'Sources', icon: <BookOpen size={19} aria-hidden /> },
  ]
  return (
    <VStack as="nav" aria-label="Map tools" gap="1" py="2" px="1.5" w="64px" flexShrink={0} bg="brand.800" borderRightWidth="1px" borderColor="whiteAlpha.200" zIndex="1">
      {tools.map(({ id, label, icon, badge }) => (
        <RailButton key={id} label={label} active={tool === id} controls={`tool-${id}`} onClick={() => onTool(tool === id ? null : id)} badge={badge}>
          {icon}
        </RailButton>
      ))}
      <Box w="8" h="1px" bg="whiteAlpha.300" my="1" />
      <RailButton label="Legend" active={legendOpen} controls="tool-legend" onClick={() => onLegend(!legendOpen)}>
        <Palette size={19} aria-hidden />
      </RailButton>
    </VStack>
  )
}

function RailButton({ label, active, controls, onClick, badge, children }: { label: string; active: boolean; controls: string; onClick: () => void; badge?: number; children: ReactNode }) {
  return (
    <Flex
      as="button"
      direction="column"
      align="center"
      gap="0.5"
      w="full"
      py="1.5"
      position="relative"
      borderRadius="lg"
      cursor="pointer"
      color={active ? 'brand.700' : 'whiteAlpha.900'}
      bg={active ? 'white' : 'transparent'}
      aria-expanded={active}
      aria-controls={controls}
      onClick={onClick}
      _hover={{ bg: active ? 'white' : 'whiteAlpha.200' }}
      _focusVisible={{ outline: '2px solid white', outlineOffset: '2px' }}
    >
      {children}
      <Text fontSize="10px" fontWeight="600" lineHeight="1.2">
        {label}
      </Text>
      {badge !== undefined && badge > 0 && (
        <Flex position="absolute" top="0.5" right="1" minW="16px" h="16px" px="1" align="center" justify="center" borderRadius="full" bg="nasaRed" color="white" fontSize="10px" fontWeight="700" fontVariantNumeric="tabular-nums">
          <Text as="span" srOnly>
            layers on:
          </Text>
          {badge}
        </Flex>
      )}
    </Flex>
  )
}

/**
 * The white card a tool opens beside the bar. The arrow in its heading folds it up to the
 * heading only, so the map is free, and unfolds it again. Folded, the tool keeps working
 * (clicks on the map still measure or pick a place) and keeps everything it holds.
 */
export function ToolCard({ id, title, icon, onClose, children, width = '340px' }: { id: string; title: string; icon: ReactNode; onClose: () => void; children: ReactNode; width?: string }) {
  const [folded, setFolded] = useState(false)
  return (
    <Box
      id={id}
      role="region"
      aria-label={title}
      position="absolute"
      top="3"
      left="3"
      zIndex="10"
      w={width}
      maxW="calc(100% - 24px)"
      maxH="calc(100% - 24px)"
      overflowY="auto"
      overscrollBehavior="contain"
      bg="white"
      borderWidth="1px"
      borderColor="gray.200"
      borderRadius="xl"
      shadow="xl"
    >
      <Flex align="center" justify="space-between" pl="4" pr="2" py="2" borderBottomWidth={folded ? 0 : '1px'} borderColor="gray.200" position="sticky" top="0" bg="white" zIndex="2">
        <Flex align="center" gap="2" color="brand.700">
          {icon}
          <Text as="h2" fontWeight="700" fontSize="sm">
            {title}
          </Text>
        </Flex>
        <Flex align="center" gap="0.5">
          <FoldButton title={title} folded={folded} onToggle={() => setFolded((now) => !now)} bodyId={`${id}-body`} />
          <IconButton aria-label={`Close ${title}`} title="Close" size="xs" variant="ghost" color="gray.600" onClick={onClose}>
            <X size={16} aria-hidden />
          </IconButton>
        </Flex>
      </Flex>
      {/* Hidden, not removed: what is inside keeps its state while folded. */}
      <Box id={`${id}-body`} hidden={folded}>
        {children}
      </Box>
    </Box>
  )
}

// ---------------------------------------------------------------------------- Go to (fly to a known place)

/**
 * A top view of a place. `acrossM` is about how much ground is seen from side to side.
 * 3D: the camera height is counted from the Trek ground near Jezero (about 5.6 km above
 * Cesium's zero, see the skill notes), which is only used to frame the view, never shown.
 */
function flyTo(viewer: CesiumTypes.Viewer, lon: number, lat: number, acrossM: number) {
  const flat = viewer.scene.mode === Cesium.SceneMode.SCENE2D
  // In 2D the height given to flyTo becomes the width of the view.
  const height = flat ? acrossM : 5640 + acrossM * 0.9
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lon, lat, height, MARS_ELLIPSOID),
    orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0 },
    duration: 2.2,
  })
}

const PLACES: Array<{ title: string; note: string; go: (viewer: CesiumTypes.Viewer) => void }> = [
  { title: 'Jezero Crater', note: 'The whole crater, then down to the ground. A crater 45 km wide that once held a lake.', go: (v) => flyToJezero(v) },
  { title: 'Landing site', note: 'Where Perseverance touched down in February 2021.', go: (v) => flyTo(v, PERSEVERANCE_LANDING.lon, PERSEVERANCE_LANDING.lat, 4000) },
  { title: 'River delta', note: 'The fan of mud and sand that a river left in the lake.', go: (v) => flyTo(v, 77.37, 18.5, 14000) },
  { title: 'West rim', note: 'The crater wall the rover climbed on its way out.', go: (v) => flyTo(v, 77.25, 18.45, 16000) },
  { title: 'Whole planet', note: 'Back to the view from space.', go: (v) => v.camera.flyTo({ destination: Cesium.Rectangle.fromDegrees(-180, -80, 180, 80), duration: 2 }) },
]

export function PlacesPanel({ viewer, onClose }: { viewer: CesiumTypes.Viewer | null; onClose: () => void }) {
  return (
    <ToolCard id="tool-places" title="Go to" icon={<Navigation size={16} aria-hidden />} onClose={onClose}>
      <VStack as="ul" align="stretch" gap="0" listStyleType="none">
        {PLACES.map((place) => (
          <Box as="li" key={place.title} borderBottomWidth="1px" borderColor="gray.100" _last={{ borderBottomWidth: 0 }}>
            <Box
              as="button"
              w="full"
              px="4"
              py="3"
              textAlign="left"
              cursor="pointer"
              aria-disabled={!viewer}
              onClick={() => viewer && place.go(viewer)}
              _hover={{ bg: 'gray.50' }}
              _focusVisible={{ outline: '2px solid', outlineColor: 'brand.500', outlineOffset: '-2px' }}
            >
              <Text fontSize="sm" fontWeight="600" color="gray.900">
                {place.title}
              </Text>
              <Text fontSize="xs" color="gray.600" mt="0.5">
                {place.note}
              </Text>
            </Box>
          </Box>
        ))}
      </VStack>
    </ToolCard>
  )
}

// --------------------------------------------------------------------------- Sources

const SOURCES: Array<{ what: string; who: string; url: string }> = [
  { what: 'Colour map of the planet, CTX and HiRISE photos of Jezero, 3D ground, night heat, elevation', who: 'NASA/JPL-Caltech, Mars Trek', url: 'https://trek.nasa.gov/mars/' },
  { what: 'CTX photos of the whole planet', who: 'NASA/JPL/MSSS, Caltech Murray Lab, served by Esri', url: 'https://murray-lab.caltech.edu/CTX/' },
  { what: 'Path of the Perseverance rover', who: 'NASA/JPL-Caltech, Mars 2020 mission', url: 'https://science.nasa.gov/mission/mars-2020-perseverance/location-map/' },
  { what: 'Geologic map of Jezero (map SIM 3464)', who: 'USGS: Sun and Stack, 2020', url: 'https://doi.org/10.3133/sim3464' },
  { what: 'Method of the radiation estimate (map PIA03480)', who: 'NASA/JPL/JSC, 2002', url: 'https://www.jpl.nasa.gov/images/pia03480-estimated-radiation-dosage-on-mars/' },
]

export function SourcesPanel({ onClose }: { onClose: () => void }) {
  return (
    <ToolCard id="tool-sources" title="Sources" icon={<BookOpen size={16} aria-hidden />} onClose={onClose}>
      <Text px="4" pt="3" fontSize="xs" color="gray.600">
        Everything on the map is loaded live from these public services. The photos are tinted to Mars colours for looks only. The radiation layer is our estimate, not a measurement.
      </Text>
      <VStack as="ul" align="stretch" gap="0" listStyleType="none" mt="2">
        {SOURCES.map((source) => (
          <Box as="li" key={source.url} px="4" py="2.5" borderTopWidth="1px" borderColor="gray.100">
            <Text fontSize="sm" fontWeight="600" color="gray.900">
              {source.what}
            </Text>
            <Link href={source.url} target="_blank" rel="noreferrer" fontSize="xs" color="brand.600" textDecoration="underline" mt="0.5">
              {source.who}
              <ExternalLink size={11} aria-hidden />
              <Text as="span" srOnly>
                (opens in a new tab)
              </Text>
            </Link>
          </Box>
        ))}
      </VStack>
    </ToolCard>
  )
}

/**
 * The fold arrow of a panel. A panel at the top folds upwards, so its arrow points up while
 * open. The legend sits at the bottom and folds downwards: pass `down`.
 */
export function FoldButton({ title, folded, onToggle, bodyId, down = false }: { title: string; folded: boolean; onToggle: () => void; bodyId: string; down?: boolean }) {
  // Open: the arrow points the way the panel will fold. Folded: it points the way it will open.
  const flipped = down ? !folded : folded
  return (
    <IconButton aria-label={folded ? `Unfold ${title}` : `Fold ${title}`} title={folded ? 'Unfold' : 'Fold'} aria-expanded={!folded} aria-controls={bodyId} size="xs" variant="ghost" color="gray.600" onClick={onToggle}>
      <ChevronUp size={16} aria-hidden style={{ transform: flipped ? 'rotate(180deg)' : undefined, transition: 'transform 150ms ease' }} />
    </IconButton>
  )
}
