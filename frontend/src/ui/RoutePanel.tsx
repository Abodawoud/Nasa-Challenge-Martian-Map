// The Route tool's panel: choose a start and a goal, then compare two walking routes.
// Route A is the shortest. Route B is the lower-slope one (never "safest", PLAN.md D10).
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type * as Cesium from 'cesium'
import { Box, Button, Flex, HStack, IconButton, Spinner, Text, VStack } from '@chakra-ui/react'
import { ArrowUpDown, Crosshair, Eye, EyeOff, Flag, Footprints, MapPin, Route, RotateCcw, TriangleAlert } from 'lucide-react'
import { ROUTE_LOOK, RouteTool, fetchRoutes, formatDuration } from '../globe/route'
import type { RouteAnswer, RouteResult } from '../globe/route'
import { waypointStore } from '../globe/identify'
import { PERSEVERANCE_LANDING } from '../globe/mars'
import { formatDistance, formatPlace } from '../globe/mapTools'
import type { LonLat } from '../globe/mapTools'
import { unitStore } from '../globe/units'
import { ToolCard } from './Sidebar'

const whole = new Intl.NumberFormat('en', { maximumFractionDigits: 0 })
const one = new Intl.NumberFormat('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** Places to start from or walk to, all inside the height map of Jezero. */
const KNOWN_PLACES: Array<{ title: string; place: LonLat }> = [
  { title: 'Landing site', place: { lon: PERSEVERANCE_LANDING.lon, lat: PERSEVERANCE_LANDING.lat } },
  { title: 'Top of the river delta', place: { lon: 77.37, lat: 18.502 } },
  { title: 'West rim of the crater', place: { lon: 77.25, lat: 18.45 } },
  { title: 'Crater floor, east', place: { lon: 77.55, lat: 18.42 } },
]

type State = { kind: 'idle' } | { kind: 'loading' } | { kind: 'error'; why: string } | { kind: 'ready'; answer: RouteAnswer }

interface Props {
  viewer: Cesium.Viewer | null
  /** Stays in the page while closed, so the routes are kept. They are hidden on the map meanwhile. */
  open: boolean
  onClose: () => void
}

export function RoutePanel({ viewer, open, onClose }: Props) {
  const tool = useRef<RouteTool | null>(null)
  const [start, setStart] = useState<LonLat | null>(null)
  const [goal, setGoal] = useState<LonLat | null>(null)
  /** Which point the next click on the map sets. */
  const [picking, setPicking] = useState<'start' | 'goal' | null>('start')
  const [state, setState] = useState<State>({ kind: 'idle' })
  const [shown, setShown] = useState({ a: true, b: true })
  const saved = useSyncExternalStore(waypointStore.subscribe, waypointStore.get)
  // Reading the units here makes the distances follow the units setting.
  useSyncExternalStore(unitStore.subscribe, unitStore.get)

  useEffect(() => {
    if (!viewer) return
    const created = new RouteTool(viewer, (which, place) => {
      if (which === 'start') {
        setStart(place)
        // After the start, the next click sets the goal, unless there is one already.
        setPicking((now) => (now === 'start' ? 'goal' : now))
      } else {
        setGoal(place)
        setPicking(null)
      }
    })
    tool.current = created
    return () => {
      created.destroy()
      tool.current = null
    }
  }, [viewer])

  useEffect(() => {
    tool.current?.setActive(open)
  }, [open, viewer])

  useEffect(() => {
    tool.current?.setPicking(open ? picking : null)
  }, [picking, open, viewer])

  // After the start is set, do not ask for a goal again when there is one.
  useEffect(() => {
    if (picking === 'goal' && goal && start) setPicking(null)
  }, [picking, goal, start])

  useEffect(() => {
    tool.current?.setEnds(start, goal)
  }, [start, goal, viewer])

  // Both points are set: ask for the two routes. A newer pair cancels the older request.
  useEffect(() => {
    tool.current?.setRoutes([])
    if (!start || !goal) {
      setState({ kind: 'idle' })
      return
    }
    const abort = new AbortController()
    setState({ kind: 'loading' })
    setShown({ a: true, b: true })
    fetchRoutes(start, goal, abort.signal).then(
      (result) => {
        if (abort.signal.aborted) return
        if (result.state === 'error') return setState({ kind: 'error', why: result.why })
        setState({ kind: 'ready', answer: result.answer })
        tool.current?.setRoutes(result.answer.routes.filter((route) => route.found).map((route) => ({ id: route.id, points: route.points })))
      },
      () => undefined,
    )
    return () => abort.abort()
  }, [start, goal])

  if (!open) return null

  const reset = () => {
    setStart(null)
    setGoal(null)
    setPicking('start')
  }
  const swap = () => {
    setStart(goal)
    setGoal(start)
  }
  const toggle = (id: 'a' | 'b') => {
    const next = !shown[id]
    setShown((all) => ({ ...all, [id]: next }))
    tool.current?.setRouteShown(id, next)
  }

  const routes = state.kind === 'ready' ? state.answer.routes : []
  const a = routes.find((route) => route.id === 'a')
  const b = routes.find((route) => route.id === 'b')
  const places = [...KNOWN_PLACES, ...saved.map((waypoint) => ({ title: waypoint.name, place: { lon: waypoint.lon, lat: waypoint.lat } }))]

  return (
    <ToolCard id="tool-route" title="Route" icon={<Route size={16} aria-hidden />} onClose={onClose} width="400px">
      <Box px="4" pt="3" pb="2">
        <Text fontSize="sm" color="gray.700">
          Choose where to start and where to go. You get two walking routes to compare.
        </Text>
      </Box>

      <VStack align="stretch" gap="2" px="3" pb="3">
        <EndPicker
          which="start"
          label="Start"
          icon={<MapPin size={15} aria-hidden />}
          place={start}
          picking={picking === 'start'}
          onPick={() => setPicking(picking === 'start' ? null : 'start')}
          places={places}
          onChoose={(place) => {
            setStart(place)
            if (!goal) setPicking('goal')
            else setPicking(null)
          }}
        />
        <EndPicker
          which="goal"
          label="Goal"
          icon={<Flag size={15} aria-hidden />}
          place={goal}
          picking={picking === 'goal'}
          onPick={() => setPicking(picking === 'goal' ? null : 'goal')}
          places={places}
          onChoose={(place) => {
            setGoal(place)
            setPicking(start ? null : 'start')
          }}
        />
        <HStack gap="2">
          <Button size="xs" variant="outline" colorPalette="brand" disabled={!start || !goal} onClick={swap}>
            <ArrowUpDown size={14} aria-hidden />
            Swap start and goal
          </Button>
          <Button size="xs" variant="outline" colorPalette="brand" disabled={!start && !goal} onClick={reset}>
            <RotateCcw size={14} aria-hidden />
            Start again
          </Button>
        </HStack>
      </VStack>

      <Box aria-live="polite" borderTopWidth="1px" borderColor="gray.200" bg="gray.50">
        {state.kind === 'idle' && (
          <Text px="4" py="4" fontSize="sm" color="gray.600">
            {!start ? 'Click the map to set the start.' : 'Now click the map to set the goal.'}
          </Text>
        )}
        {state.kind === 'loading' && (
          <HStack gap="2.5" px="4" py="4" fontSize="sm" color="gray.700">
            <Spinner size="sm" />
            <Text>Working out the two routes…</Text>
          </HStack>
        )}
        {state.kind === 'error' && (
          <HStack align="flex-start" gap="2" m="3" p="3" borderRadius="lg" bg="red.50" borderWidth="1px" borderColor="red.200">
            <Box flexShrink={0} mt="0.5" color="red.700">
              <TriangleAlert size={16} aria-hidden />
            </Box>
            <Text fontSize="sm" color="red.900">
              {state.why}
            </Text>
          </HStack>
        )}

        {state.kind === 'ready' && a && b && (
          <VStack align="stretch" gap="2.5" p="3">
            {/* The two routes side by side */}
            <Box bg="white" borderWidth="1px" borderColor="gray.200" borderRadius="xl" overflow="hidden">
              <Flex borderBottomWidth="1px" borderColor="gray.200">
                <Box flex="1.15" />
                <RouteHead route={a} shown={shown.a} onToggle={() => toggle('a')} />
                <RouteHead route={b} shown={shown.b} onToggle={() => toggle('b')} />
              </Flex>
              {a.found || b.found ? (
                <>
                  <Line label="Distance" hint="walked on the ground" a={a.stats && formatDistance(a.stats.distance_m)} b={b.stats && formatDistance(b.stats.distance_m)} better={lower(a.stats?.distance_m, b.stats?.distance_m)} />
                  <Line label="Walking time" hint="an estimate" a={a.stats && formatDuration(a.stats.walk_time_s)} b={b.stats && formatDuration(b.stats.walk_time_s)} better={lower(a.stats?.walk_time_s, b.stats?.walk_time_s)} />
                  <Line label="Steepest part" a={a.stats && `${one.format(a.stats.max_slope_deg)}°`} b={b.stats && `${one.format(b.stats.max_slope_deg)}°`} better={lower(a.stats?.max_slope_deg, b.stats?.max_slope_deg)} />
                  <Line
                    label="Steep ground"
                    hint={`steeper than ${state.answer.settings.steep_deg}°`}
                    a={a.stats && `${whole.format(a.stats.steep_percent)}%`}
                    b={b.stats && `${whole.format(b.stats.steep_percent)}%`}
                    better={lower(a.stats?.steep_percent, b.stats?.steep_percent)}
                  />
                  <Line label="Climb" hint="total way up" a={a.stats && `${whole.format(a.stats.climb_m)} m`} b={b.stats && `${whole.format(b.stats.climb_m)} m`} better={lower(a.stats?.climb_m, b.stats?.climb_m)} />
                  <Line label="Way down" a={a.stats && `${whole.format(a.stats.descent_m)} m`} b={b.stats && `${whole.format(b.stats.descent_m)} m`} />
                  <Line label="Average slope" a={a.stats && `${one.format(a.stats.mean_slope_deg)}°`} b={b.stats && `${one.format(b.stats.mean_slope_deg)}°`} />
                  <Line label="By rover" hint="Perseverance's top speed" a={a.stats && formatDuration(a.stats.rover_time_s)} b={b.stats && formatDuration(b.stats.rover_time_s)} last />
                </>
              ) : null}
            </Box>

            {[a, b].map((route) =>
              !route.found ? (
                <Notice key={route.id} tone="red" title={`${ROUTE_LOOK[route.id].title}: no route found`}>
                  {route.reason ?? 'There is no way between these two points within the slope limit of this route.'}
                </Notice>
              ) : route.warnings.length > 0 ? (
                <Notice key={route.id} tone="orange" title={ROUTE_LOOK[route.id].title}>
                  {route.warnings.join(' ')}
                </Notice>
              ) : null,
            )}

            {(a.found || b.found) && (
              <Box bg="white" borderWidth="1px" borderColor="gray.200" borderRadius="xl" px="3.5" py="3">
                <HStack gap="2" mb="2">
                  <Flex flexShrink={0} align="center" justify="center" boxSize="7" borderRadius="full" bg="brand.50" color="brand.700">
                    <Footprints size={16} aria-hidden />
                  </Flex>
                  <Text as="h3" fontSize="sm" fontWeight="700" color="gray.900">
                    Up and down along the way
                  </Text>
                </HStack>
                <RouteChart routes={[a, b].filter((route) => route.found)} />
              </Box>
            )}

            <Box asChild bg="white" borderWidth="1px" borderColor="gray.200" borderRadius="xl" px="3.5" py="2.5">
              <details>
                <Box asChild cursor="pointer" fontSize="sm" fontWeight="600" color="brand.600">
                  <summary>How are the routes made?</summary>
                </Box>
                <VStack align="stretch" gap="1.5" mt="2" fontSize="xs" color="gray.700" lineHeight="1.5">
                  <Text>
                    The ground of Jezero is a grid of squares, {state.answer.settings.resolution_m} m wide, each with a height from the USGS height map. The computer finds the cheapest way from square to square.
                  </Text>
                  <Text>
                    <b>Route A</b> counts only the distance walked on the ground. It does not cross ground steeper than {state.answer.settings.route_a_max_slope_deg}°.
                  </Text>
                  <Text>
                    <b>Route B</b> also pays a price for steepness that grows fast (a slope of {state.answer.settings.slope_penalty_deg}° doubles the cost of a step). It does not cross ground steeper than {state.answer.settings.route_b_max_slope_deg}°.
                  </Text>
                  <Text>
                    <b>Walking time is an estimate.</b> It uses {state.answer.settings.walk_speed_m_s} m/s as a comfortable walking speed in Mars gravity, times {state.answer.settings.suit_factor} for the space suit, slower on slopes. The suit number and the slope rule are our assumptions.
                  </Text>
                  <Text>
                    <b>Route B is not &ldquo;the safe route&rdquo;.</b> Only slope is counted. Rocks, sand, dust and light are not.
                  </Text>
                </VStack>
              </details>
            </Box>
          </VStack>
        )}
      </Box>
    </ToolCard>
  )
}

/** 'a' or 'b' when one number is clearly lower, else nothing. */
function lower(a: number | undefined, b: number | undefined): 'a' | 'b' | undefined {
  if (a === undefined || b === undefined) return undefined
  if (Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * 0.005) return undefined
  return a < b ? 'a' : 'b'
}

/** The start or the goal: where it is, a button to pick it on the map, and known places. */
function EndPicker({ which, label, icon, place, picking, onPick, places, onChoose }: { which: 'start' | 'goal'; label: string; icon: ReactNode; place: LonLat | null; picking: boolean; onPick: () => void; places: Array<{ title: string; place: LonLat }>; onChoose: (place: LonLat) => void }) {
  return (
    <Box bg="white" borderWidth="2px" borderColor={picking ? 'brand.500' : 'gray.200'} borderRadius="xl" px="3" py="2.5">
      <Flex align="center" gap="2">
        <Flex flexShrink={0} align="center" justify="center" boxSize="7" borderRadius="full" bg={which === 'start' ? 'white' : 'nasaRed'} color={which === 'start' ? 'brand.700' : 'white'} borderWidth="2px" borderColor={which === 'start' ? 'brand.700' : 'white'} outline={which === 'goal' ? '1px solid' : undefined} outlineColor="gray.300">
          {icon}
        </Flex>
        <Box flex="1" minW="0">
          <Text fontSize="xs" fontWeight="700" color="gray.600">
            {label}
          </Text>
          <Text fontSize="sm" fontWeight="600" color={place ? 'gray.900' : 'gray.500'} fontVariantNumeric="tabular-nums" truncate>
            {place ? formatPlace(place) : picking ? 'Click a place on the map…' : 'Not set'}
          </Text>
        </Box>
        <Button size="xs" variant={picking ? 'solid' : 'outline'} colorPalette="brand" flexShrink={0} aria-pressed={picking} onClick={onPick}>
          <Crosshair size={14} aria-hidden />
          {picking ? 'Picking…' : place ? 'Change' : 'Pick on map'}
        </Button>
      </Flex>
      <Flex as="ul" gap="1" wrap="wrap" mt="2" listStyleType="none" aria-label={`Known places for the ${label.toLowerCase()}`}>
        {places.map((item) => (
          <Box as="li" key={`${item.title}-${item.place.lon}-${item.place.lat}`}>
            <Button size="2xs" variant="subtle" colorPalette="gray" borderRadius="full" onClick={() => onChoose(item.place)}>
              {item.title}
            </Button>
          </Box>
        ))}
      </Flex>
    </Box>
  )
}

/** The heading of one route's column: its colour, its name, and the eye that hides its line. */
function RouteHead({ route, shown, onToggle }: { route: RouteResult; shown: boolean; onToggle: () => void }) {
  const look = ROUTE_LOOK[route.id]
  return (
    <Flex flex="1" direction="column" gap="1" px="2" py="2" borderLeftWidth="1px" borderColor="gray.200" minW="0">
      <HStack gap="1.5">
        <Box flexShrink={0} w="18px" h="6px" borderRadius="full" bg={look.color} borderWidth="1.5px" borderColor={route.id === 'a' ? look.color : look.edge} aria-hidden />
        <Text fontSize="xs" fontWeight="700" color="gray.900">
          Route {route.id.toUpperCase()}
        </Text>
        <IconButton ml="auto" aria-label={shown ? `Hide ${look.title} on the map` : `Show ${look.title} on the map`} aria-pressed={shown} title={shown ? 'Hide on the map' : 'Show on the map'} size="2xs" variant="ghost" color={shown ? 'brand.700' : 'gray.400'} disabled={!route.found} onClick={onToggle}>
          {shown ? <Eye size={13} aria-hidden /> : <EyeOff size={13} aria-hidden />}
        </IconButton>
      </HStack>
      <Text fontSize="xs" color="gray.700" lineHeight="1.2">
        {route.id === 'a' ? 'Shortest' : 'Lower-slope'}
      </Text>
    </Flex>
  )
}

/** One row of the comparison: a name, and the value of each route. The lower value gets a mark. */
function Line({ label, hint, a, b, better, last }: { label: string; hint?: string; a: string | null; b: string | null; better?: 'a' | 'b'; last?: boolean }) {
  const cell = (value: string | null, mine: 'a' | 'b') => (
    <Flex flex="1" align="center" px="2" py="1.5" borderLeftWidth="1px" borderColor="gray.200" bg={better === mine ? 'green.50' : undefined} minW="0">
      <Text fontSize="sm" fontWeight="700" color={value ? 'gray.900' : 'gray.400'} fontVariantNumeric="tabular-nums">
        {value ?? '–'}
        {better === mine && (
          <Text as="span" srOnly>
            {' '}
            (lower)
          </Text>
        )}
      </Text>
    </Flex>
  )
  return (
    <Flex borderBottomWidth={last ? 0 : '1px'} borderColor="gray.100">
      <Box flex="1.15" px="3" py="1.5" minW="0">
        <Text fontSize="xs" fontWeight="600" color="gray.800" lineHeight="1.25">
          {label}
        </Text>
        {hint && (
          <Text fontSize="2xs" color="gray.500" lineHeight="1.2">
            {hint}
          </Text>
        )}
      </Box>
      {cell(a, 'a')}
      {cell(b, 'b')}
    </Flex>
  )
}

function Notice({ tone, title, children }: { tone: 'red' | 'orange'; title: string; children: ReactNode }) {
  return (
    <HStack align="flex-start" gap="2" p="2.5" borderRadius="lg" bg={`${tone}.50`} borderWidth="1px" borderColor={`${tone}.200`}>
      <Box flexShrink={0} mt="0.5" color={`${tone}.700`}>
        <TriangleAlert size={15} aria-hidden />
      </Box>
      <Box>
        <Text fontSize="xs" fontWeight="700" color={`${tone}.900`}>
          {title}
        </Text>
        <Text fontSize="xs" color={`${tone}.900`}>
          {children}
        </Text>
      </Box>
    </HStack>
  )
}

/** The height along each route, from start to goal. Both routes share the two scales. */
function RouteChart({ routes }: { routes: RouteResult[] }) {
  const W = 340
  const H = 130
  const PAD = { left: 6, right: 6, top: 8, bottom: 8 }
  const heights = routes.flatMap((route) => route.profile.elevation_m)
  const longest = Math.max(...routes.map((route) => route.profile.distance_m[route.profile.distance_m.length - 1] ?? 0), 1)
  const low = Math.min(...heights)
  const high = Math.max(...heights)
  // Never zoom in on less than 20 m of height: flat ground must look flat.
  const span = Math.max(20, high - low)
  const middle = (low + high) / 2
  const x = (d: number) => PAD.left + (d / longest) * (W - PAD.left - PAD.right)
  const y = (h: number) => PAD.top + (H - PAD.top - PAD.bottom) * (1 - (h - (middle - span / 2)) / span)
  const path = (route: RouteResult) => {
    // At most about 300 points per line: more cannot be seen at this size.
    const step = Math.max(1, Math.floor(route.profile.distance_m.length / 300))
    const parts: string[] = []
    for (let i = 0; i < route.profile.distance_m.length; i += step) parts.push(`${x(route.profile.distance_m[i]).toFixed(1)} ${y(route.profile.elevation_m[i]).toFixed(1)}`)
    const end = route.profile.distance_m.length - 1
    parts.push(`${x(route.profile.distance_m[end]).toFixed(1)} ${y(route.profile.elevation_m[end]).toFixed(1)}`)
    return `M${parts.join(' L')}`
  }
  const stretch = Math.max(1, longest / (W - PAD.left - PAD.right) / (span / (H - PAD.top - PAD.bottom)))

  return (
    <Box>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Height along the routes, from ${whole.format(low)} to ${whole.format(high)} metres.`} style={{ display: 'block', borderRadius: 8, background: '#3a2a22' }}>
        {/* Route B first, so route A is drawn on top where they share the way. */}
        {[...routes].reverse().map((route) => (
          <path key={route.id} d={path(route)} fill="none" stroke={ROUTE_LOOK[route.id].color} strokeWidth={route.id === 'a' ? 2.2 : 2.6} strokeLinejoin="round" strokeLinecap="round" />
        ))}
      </svg>
      <Flex justify="space-between" fontSize="xs" color="gray.600" mt="1">
        <Text>Start</Text>
        <Text fontVariantNumeric="tabular-nums">
          {whole.format(low)} m to {whole.format(high)} m high
        </Text>
        <Text>{formatDistance(longest)}</Text>
      </Flex>
      <HStack gap="4" mt="1.5" fontSize="xs" color="gray.700">
        {routes.map((route) => (
          <HStack key={route.id} gap="1.5">
            <Flex align="center" justify="center" w="22px" h="12px" borderRadius="3px" bg="#3a2a22" aria-hidden>
              <Box w="16px" borderTopWidth="2.5px" borderColor={ROUTE_LOOK[route.id].color} />
            </Flex>
            <Text>{ROUTE_LOOK[route.id].short}</Text>
          </HStack>
        ))}
      </HStack>
      <Text fontSize="2xs" color="gray.500" mt="1">
        Heights are drawn {whole.format(stretch)}× taller than real, so the hills are easy to see.
      </Text>
    </Box>
  )
}
