// The Route tool's panel: choose a start and a goal. The backend creates several routes and
// checks them. The panel shows the recommended one with its reason, the others ranked beside
// it, and for the chosen route its numbers, what to take care of, and a height chart.
// No route is ever called "safe" (PLAN.md D10).
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type * as Cesium from 'cesium'
import { Box, Button, Flex, HStack, IconButton, SimpleGrid, Spinner, Text, VStack } from '@chakra-ui/react'
import { ArrowUpDown, Award, Clock, Crosshair, Eye, EyeOff, Flag, Footprints, MapPin, Mountain, Radiation, Route, RotateCcw, ShieldAlert, Timer, TrendingUp, TriangleAlert, Waves, Wind } from 'lucide-react'
import { RADIATION_MSV_PER_DAY, RouteTool, SPACEWALK_LIMIT_S, fetchReach, fetchRouteArea, fetchRoutes, formatDuration, insideArea, routeColor, sandOnRoute, walkDoseMsv } from '../globe/route'
import type { Bounds, Measure, ReachAnswer, RouteAnswer, RouteResult } from '../globe/route'
import { waypointStore } from '../globe/identify'
import { PERSEVERANCE_LANDING } from '../globe/mars'
import { flyToPlace, formatDistance, formatPlace } from '../globe/mapTools'
import type { LonLat } from '../globe/mapTools'
import { unitStore } from '../globe/units'
import { ToolCard } from './Sidebar'

const whole = new Intl.NumberFormat('en', { maximumFractionDigits: 0 })
const one = new Intl.NumberFormat('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const two = new Intl.NumberFormat('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Places to start from or walk to, all inside the height map of Jezero. */
const KNOWN_PLACES: Array<{ title: string; place: LonLat }> = [
  { title: 'Landing site', place: { lon: PERSEVERANCE_LANDING.lon, lat: PERSEVERANCE_LANDING.lat } },
  { title: 'Top of the river delta', place: { lon: 77.37, lat: 18.502 } },
  { title: 'West rim of the crater', place: { lon: 77.25, lat: 18.45 } },
  { title: 'Crater floor, east', place: { lon: 77.55, lat: 18.42 } },
]

const BEST_AT: Record<Measure, string> = {
  distance: 'Shortest',
  time: 'Fastest',
  steepness: 'Least steep',
  climb: 'Least climb',
  smooth: 'Smoothest ground',
}

type State = { kind: 'idle' } | { kind: 'loading' } | { kind: 'error'; why: string } | { kind: 'ready'; answer: RouteAnswer }
type Reach = { kind: 'off' } | { kind: 'loading' } | { kind: 'error'; why: string } | { kind: 'on'; answer: ReachAnswer }

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
  // The newest goal, for the map's click handler (it is made once and would see an old value).
  const goalRef = useRef<LonLat | null>(null)
  useEffect(() => {
    goalRef.current = goal
  }, [goal])
  /** Which point the next click on the map sets. */
  const [picking, setPicking] = useState<'start' | 'goal' | null>('start')
  const [state, setState] = useState<State>({ kind: 'idle' })
  /** The route whose details are shown, and which is drawn wide on the map. */
  const [selected, setSelected] = useState('')
  const [hidden, setHidden] = useState<Record<string, boolean>>({})
  /** Metres of loose sand on each route, from the USGS rock map (worked out after the routes arrive). */
  const [sand, setSand] = useState<Record<string, number | undefined>>({})
  const [reach, setReach] = useState<Reach>({ kind: 'off' })
  /** The area where routes work (the backend's height map), drawn as a dashed box on the map. */
  const [area, setArea] = useState<Bounds | undefined>()
  /** True right after a click outside that area. */
  const [outside, setOutside] = useState(false)
  const saved = useSyncExternalStore(waypointStore.subscribe, waypointStore.get)
  // Reading the units here makes the distances follow the units setting.
  useSyncExternalStore(unitStore.subscribe, unitStore.get)

  useEffect(() => {
    if (!viewer) return
    const created = new RouteTool(
      viewer,
      (which, place) => {
      setOutside(false)
      if (which === 'start') {
        setStart(place)
        // After the start, the next click sets the goal, unless there is one already.
        setPicking(goalRef.current ? null : 'goal')
      } else {
        setGoal(place)
        setPicking(null)
      }
      },
      () => setOutside(true),
    )
    tool.current = created
    // The edge of the area where routes work, asked once and drawn on the map.
    void fetchRouteArea().then((bounds) => {
      if (!bounds || tool.current !== created) return
      setArea(bounds)
      created.setArea(bounds)
    })
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

  useEffect(() => {
    tool.current?.setEnds(start, goal)
  }, [start, goal, viewer])

  // A new start: the walking-time map of the old start no longer fits.
  useEffect(() => {
    setReach({ kind: 'off' })
    void tool.current?.setReach(null)
  }, [start])

  // Both points are set: ask for the routes. A newer pair cancels the older request.
  useEffect(() => {
    tool.current?.setRoutes([])
    setSand({})
    if (!start || !goal) {
      setState({ kind: 'idle' })
      return
    }
    const abort = new AbortController()
    setState({ kind: 'loading' })
    setHidden({})
    fetchRoutes(start, goal, abort.signal).then(
      (result) => {
        if (abort.signal.aborted) return
        if (result.state === 'error') return setState({ kind: 'error', why: result.why })
        const { answer } = result
        const first = answer.recommendation?.id ?? answer.routes[0]?.id ?? ''
        setState({ kind: 'ready', answer })
        setSelected(first)
        tool.current?.setRoutes(
          answer.routes.map((route) => ({ id: route.id, points: route.points })),
          first,
        )
        // Loose sand on each route, from the rock map. It can take a moment the first time.
        for (const route of answer.routes) {
          void sandOnRoute(route).then((metres) => {
            if (!abort.signal.aborted) setSand((all) => ({ ...all, [route.id]: metres }))
          })
        }
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
  const choose = (id: string) => {
    setSelected(id)
    tool.current?.setSelected(id)
  }
  const toggle = (id: string) => {
    const next = !hidden[id]
    setHidden((all) => ({ ...all, [id]: next }))
    tool.current?.setRouteShown(id, !next)
  }
  const toggleReach = () => {
    if (!start) return
    if (reach.kind === 'on' || reach.kind === 'loading') {
      setReach({ kind: 'off' })
      void tool.current?.setReach(null)
      return
    }
    setReach({ kind: 'loading' })
    const abort = new AbortController()
    fetchReach(start, abort.signal).then(
      (result) => {
        if (result.state === 'error') return setReach({ kind: 'error', why: result.why })
        setReach({ kind: 'on', answer: result.answer })
        void tool.current?.setReach({ image: result.answer.image, bounds: result.answer.bounds })
      },
      () => undefined,
    )
  }

  const answer = state.kind === 'ready' ? state.answer : undefined
  const routes = answer?.routes ?? []
  const current = routes.find((route) => route.id === selected) ?? routes[0]
  // Saved places outside the route area cannot be a start or a goal: they are not offered.
  const places = [...KNOWN_PLACES, ...saved.map((waypoint) => ({ title: waypoint.name, place: { lon: waypoint.lon, lat: waypoint.lat } })).filter((item) => !area || insideArea(area, item.place))]
  const showArea = () => {
    if (!viewer || !area) return
    const metresPerDegree = 59274.7
    const wide = (area[2] - area[0]) * metresPerDegree * Math.cos((((area[1] + area[3]) / 2) * Math.PI) / 180)
    const tall = (area[3] - area[1]) * metresPerDegree
    // The map is wider than it is high, so the height of the box decides how far to step back.
    flyToPlace(viewer, { lon: (area[0] + area[2]) / 2, lat: (area[1] + area[3]) / 2 }, Math.max(wide, tall * 2.6) * 1.15)
  }
  const leftOut = [...(answer?.dropped ?? []), ...(answer?.not_found ?? [])]

  return (
    <ToolCard id="tool-route" title="Route" icon={<Route size={16} aria-hidden />} onClose={onClose} width="408px">
      <Box px="4" pt="3" pb="2">
        <Text fontSize="sm" color="gray.700">
          Choose where to start and where to go. The map creates several routes, checks them, and tells you which one is best.
        </Text>
        <HStack gap="2" mt="2" align="center">
          <Box flexShrink={0} w="22px" borderTopWidth="2px" borderTopStyle="dashed" borderColor="gray.600" aria-hidden />
          <Text flex="1" fontSize="xs" color="gray.600">
            Routes work inside the dashed box on the map: Jezero Crater, where we have heights.
          </Text>
          <Button size="2xs" variant="outline" colorPalette="brand" flexShrink={0} disabled={!area || !viewer} onClick={showArea}>
            Show the box
          </Button>
        </HStack>
        {outside && (
          <HStack role="alert" align="flex-start" gap="2" mt="2" p="2" borderRadius="lg" bg="orange.50" borderWidth="1px" borderColor="orange.200">
            <Box flexShrink={0} mt="0.5" color="orange.700">
              <TriangleAlert size={14} aria-hidden />
            </Box>
            <Text fontSize="xs" color="orange.900">
              That place is outside the dashed box, so no route can be made there. Click inside the box.
            </Text>
          </HStack>
        )}
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
            setPicking(goal ? null : 'goal')
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
        <HStack gap="2" wrap="wrap">
          <Button size="xs" variant="outline" colorPalette="brand" disabled={!start || !goal} onClick={swap}>
            <ArrowUpDown size={14} aria-hidden />
            Swap
          </Button>
          <Button size="xs" variant="outline" colorPalette="brand" disabled={!start && !goal} onClick={reset}>
            <RotateCcw size={14} aria-hidden />
            Start again
          </Button>
          <Button size="xs" variant={reach.kind === 'on' ? 'solid' : 'outline'} colorPalette="brand" disabled={!start} aria-pressed={reach.kind === 'on'} onClick={toggleReach} title="Colour the map by how long it takes to walk there from the start">
            {reach.kind === 'loading' ? <Spinner size="xs" /> : <Timer size={14} aria-hidden />}
            Walking-time map
          </Button>
        </HStack>

        {reach.kind === 'error' && (
          <Text fontSize="xs" color="red.700">
            {reach.why}
          </Text>
        )}
        {reach.kind === 'on' && (
          <Box bg="white" borderWidth="1px" borderColor="gray.200" borderRadius="lg" px="3" py="2.5">
            <Text fontSize="xs" fontWeight="700" color="gray.900">
              Walking time from the start
            </Text>
            <Flex as="ul" gap="1" mt="1.5" listStyleType="none">
              {reach.answer.legend.map((band) => (
                <Box as="li" key={band.label} flex="1" minW="0">
                  <Box h="8px" borderRadius="sm" bg={band.color} borderWidth="1px" borderColor="blackAlpha.300" aria-hidden />
                  <Text fontSize="2xs" color="gray.700" mt="0.5" lineHeight="1.2">
                    {band.label}
                  </Text>
                </Box>
              ))}
            </Flex>
            <Text fontSize="2xs" color="gray.600" mt="1.5">
              Each colour is how long it takes to walk there (an estimate). The farthest place takes {formatDuration(reach.answer.max_time_s)}.
              {reach.answer.unreachable_percent >= 0.05 ? ` ${one.format(reach.answer.unreachable_percent)}% of the ground cannot be reached on foot (too steep) and has no colour.` : ''}
            </Text>
          </Box>
        )}
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
            <Text>Creating routes and checking them…</Text>
          </HStack>
        )}
        {state.kind === 'error' && <Notice tone="red">{state.why}</Notice>}
        {answer && routes.length === 0 && (
          <Notice tone="red" title="No route found">
            {answer.not_found?.[0]?.reason ?? 'There is no way on foot between these two points.'}
          </Notice>
        )}

        {answer && current && (
          <VStack align="stretch" gap="2.5" p="3">
            {/* The verdict */}
            {answer.recommendation && (
              <Box bg="brand.700" color="white" borderRadius="xl" px="3.5" py="3">
                <HStack gap="2">
                  <Award size={18} aria-hidden />
                  <Text fontSize="2xs" fontWeight="700" letterSpacing="0.08em" textTransform="uppercase" color="whiteAlpha.800">
                    Best of {routes.length} {routes.length === 1 ? 'route' : 'routes'}
                  </Text>
                </HStack>
                <Text fontSize="lg" fontWeight="700" mt="1" lineHeight="1.25">
                  {routes.find((route) => route.id === answer.recommendation!.id)?.name ?? 'Recommended route'}
                </Text>
                <Text fontSize="sm" color="whiteAlpha.900" mt="1">
                  {answer.recommendation.why}
                </Text>
              </Box>
            )}

            {/* All the routes, best first. Click one to see it. */}
            <VStack as="ul" align="stretch" gap="1.5" listStyleType="none" aria-label="Routes, best first">
              {routes.map((route) => {
                const chosen = route.id === current.id
                return (
                  <Flex as="li" key={route.id} align="stretch" bg="white" borderWidth="2px" borderColor={chosen ? 'brand.500' : 'gray.200'} borderRadius="xl" overflow="hidden">
                    <Box w="6px" flexShrink={0} bg={routeColor(route.id)} borderRightWidth="1px" borderColor="blackAlpha.300" aria-hidden />
                    <Box as="button" flex="1" minW="0" px="3" py="2" textAlign="left" cursor="pointer" aria-pressed={chosen} onClick={() => choose(route.id)} _hover={{ bg: 'gray.50' }} _focusVisible={{ outline: '2px solid', outlineColor: 'brand.500', outlineOffset: '-2px' }}>
                      <HStack gap="2" wrap="wrap">
                        <Text fontSize="sm" fontWeight="700" color="gray.900">
                          {route.rank}. {route.name}
                        </Text>
                        {route.recommended && (
                          <Text fontSize="2xs" fontWeight="700" px="1.5" py="0.5" borderRadius="full" bg="green.100" color="green.800">
                            Best
                          </Text>
                        )}
                        <Text ml="auto" fontSize="xs" fontWeight="700" color="gray.700" fontVariantNumeric="tabular-nums" title="Score from 0 to 100. Higher is better.">
                          {whole.format(route.score)}
                          <Text as="span" fontWeight="400" color="gray.500">
                            {' '}
                            / 100
                          </Text>
                        </Text>
                      </HStack>
                      {/* The score as a bar */}
                      <Box mt="1" h="4px" borderRadius="full" bg="gray.200" aria-hidden>
                        <Box h="full" borderRadius="full" bg={route.recommended ? 'green.500' : 'brand.400'} w={`${Math.max(4, Math.min(100, route.score))}%`} />
                      </Box>
                      <Text fontSize="xs" color="gray.700" mt="1.5" fontVariantNumeric="tabular-nums">
                        {formatDuration(route.stats.walk_time_s)} · {formatDistance(route.stats.distance_m)} · steepest {one.format(route.stats.max_slope_deg)}°
                      </Text>
                      {(route.best_at.length > 0 || route.also.length > 0) && (
                        <Text fontSize="2xs" color="gray.600" mt="0.5">
                          {[...route.best_at.map((measure) => BEST_AT[measure]), ...route.also.map((name) => `same way as "${name}"`)].join(' · ')}
                        </Text>
                      )}
                    </Box>
                    <Flex align="center" pr="1.5">
                      <IconButton aria-label={hidden[route.id] ? `Show ${route.name} on the map` : `Hide ${route.name} on the map`} aria-pressed={!hidden[route.id]} title={hidden[route.id] ? 'Show on the map' : 'Hide on the map'} size="xs" variant="ghost" color={hidden[route.id] ? 'gray.400' : 'brand.700'} onClick={() => toggle(route.id)}>
                        {hidden[route.id] ? <EyeOff size={15} aria-hidden /> : <Eye size={15} aria-hidden />}
                      </IconButton>
                    </Flex>
                  </Flex>
                )
              })}
            </VStack>

            {leftOut.length > 0 && (
              <Text fontSize="2xs" color="gray.600" px="1">
                Also created, but left out because they add nothing: {leftOut.map((item) => item.name).join(', ')}.
              </Text>
            )}

            {/* The chosen route */}
            <Card icon={<Footprints size={16} aria-hidden />} title={`${current.name}: the numbers`} tag={current.idea}>
              <SimpleGrid columns={2} gap="2">
                <Figure icon={<Clock size={13} aria-hidden />} label="Walking time" value={formatDuration(current.stats.walk_time_s)} note="an estimate" />
                <Figure icon={<Route size={13} aria-hidden />} label="Distance" value={formatDistance(current.stats.distance_m)} note="walked on the ground" />
                <Figure icon={<TrendingUp size={13} aria-hidden />} label="Steepest part" value={`${one.format(current.stats.max_slope_deg)}°`} note={`average ${one.format(current.stats.mean_slope_deg)}°`} />
                <Figure icon={<Mountain size={13} aria-hidden />} label="Climb" value={`${whole.format(current.stats.climb_m)} m`} note={`and ${whole.format(current.stats.descent_m)} m down`} />
              </SimpleGrid>
              <Text fontSize="2xs" color="gray.600" mt="2">
                By rover at Perseverance&rsquo;s top speed: {formatDuration(current.stats.rover_time_s)}.
              </Text>
            </Card>

            <Card icon={<ShieldAlert size={16} aria-hidden />} title="Take care">
              <Cautions route={current} sandM={sand[current.id]} sandKnown={current.id in sand} steepDeg={answer.settings.steep_deg} />
            </Card>

            <Card icon={<Waves size={16} aria-hidden />} title="Up and down along the way">
              <RouteChart routes={routes} selected={current.id} />
            </Card>

            <Box asChild bg="white" borderWidth="1px" borderColor="gray.200" borderRadius="xl" px="3.5" py="2.5">
              <details>
                <Box asChild cursor="pointer" fontSize="sm" fontWeight="600" color="brand.600">
                  <summary>How are the routes made and checked?</summary>
                </Box>
                <VStack align="stretch" gap="1.5" mt="2" fontSize="xs" color="gray.700" lineHeight="1.5">
                  <Text>
                    <b>1. Create.</b> The ground of Jezero is a grid of squares, {answer.settings.resolution_m} m wide, each with a height from the USGS height map. The computer looks for the cheapest way from square to square, several times, each time with a different idea of &ldquo;cheap&rdquo;: least distance, least time, least steep ground, smoothest ground, and one clearly different way.
                  </Text>
                  <Text>
                    <b>2. Check.</b> Every route is measured the same way: time, steep ground, climb, and bumpy ground with pits. Routes that are nearly the same are joined, and a route that is not better at anything is left out.
                  </Text>
                  <Text>
                    <b>3. Score.</b> Each route gets a score from 0 to 100: time counts {whole.format(answer.weights.time * 100)}%, steep ground {whole.format(answer.weights.steep * 100)}%, climb {whole.format(answer.weights.climb * 100)}%, bumpy ground {whole.format(answer.weights.rough * 100)}%. These weights are our choice.
                  </Text>
                  <Text>
                    <b>Walking time is an estimate.</b> It uses {answer.settings.walk_speed_m_s} m/s as a comfortable walking speed in Mars gravity, times {answer.settings.suit_factor} for the space suit, slower on slopes. The suit number and the slope rule are our assumptions.
                  </Text>
                  <Text>
                    <b>No route is &ldquo;the safe route&rdquo;.</b> The height map has one value every {answer.settings.resolution_m} m. It cannot see rocks, small holes, dust storms or solar storms.
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

/** What to take care of on one route: every line is from real data, or says it is an estimate. */
function Cautions({ route, sandM, sandKnown, steepDeg }: { route: RouteResult; sandM: number | undefined; sandKnown: boolean; steepDeg: number }) {
  const { stats } = route
  const dose = walkDoseMsv(stats.walk_time_s)
  const items: Array<{ icon: ReactNode; tone: 'red' | 'orange' | 'gray'; title: string; text: string }> = []

  if (stats.steep_percent >= 0.5 || stats.max_slope_deg > steepDeg) {
    items.push({
      icon: <TrendingUp size={15} aria-hidden />,
      tone: stats.max_slope_deg >= 25 ? 'red' : 'orange',
      title: 'Steep ground',
      text: `${whole.format(stats.steep_percent)}% of the way is steeper than ${steepDeg}°. The steepest part is ${one.format(stats.max_slope_deg)}°.`,
    })
  }
  if (stats.rough_percent >= 1) {
    items.push({ icon: <Waves size={15} aria-hidden />, tone: 'orange', title: 'Bumpy ground', text: `${whole.format(stats.rough_percent)}% of the way is on bumpy ground.` })
  }
  if (stats.pit_m >= 20) {
    items.push({ icon: <TriangleAlert size={15} aria-hidden />, tone: 'orange', title: 'Pits', text: `The way crosses ${formatDistance(stats.pit_m)} of closed dips in the ground.` })
  }
  if (sandM !== undefined && sandM >= 20) {
    items.push({
      icon: <Wind size={15} aria-hidden />,
      tone: 'orange',
      title: 'Loose sand',
      text: `${formatDistance(sandM)} of the way is on wind-blown sand ripples (USGS rock map). Feet and wheels sink in loose sand.`,
    })
  }
  if (stats.walk_time_s > SPACEWALK_LIMIT_S) {
    items.push({
      icon: <Clock size={15} aria-hidden />,
      tone: 'red',
      title: 'Longer than one spacewalk',
      text: `The walk takes ${formatDuration(stats.walk_time_s)}. A space suit is planned for about 8 hours outside (our assumption, from spacewalks in Earth orbit). Plan a rest stop or a rover.`,
    })
  }
  // Always shown: the dose depends on the time outside, so it is part of comparing routes.
  items.push({
    icon: <Radiation size={15} aria-hidden />,
    tone: 'gray',
    title: 'Radiation',
    text: `About ${two.format(dose)} mSv of cosmic radiation during the walk (an estimate: ${RADIATION_MSV_PER_DAY} mSv per day, measured by the Curiosity rover on Mars). It is nearly the same everywhere in Jezero, so a shorter time outside means less.`,
  })

  return (
    <VStack as="ul" align="stretch" gap="1.5" listStyleType="none">
      {items.map((item) => (
        <HStack as="li" key={item.title} align="flex-start" gap="2" p="2" borderRadius="lg" bg={item.tone === 'gray' ? 'gray.50' : `${item.tone}.50`} borderWidth="1px" borderColor={item.tone === 'gray' ? 'gray.200' : `${item.tone}.200`}>
          <Box flexShrink={0} mt="0.5" color={item.tone === 'gray' ? 'gray.700' : `${item.tone}.700`}>
            {item.icon}
          </Box>
          <Box>
            <Text fontSize="xs" fontWeight="700" color="gray.900">
              {item.title}
            </Text>
            <Text fontSize="xs" color="gray.800">
              {item.text}
            </Text>
          </Box>
        </HStack>
      ))}
      {!sandKnown && (
        <HStack as="li" gap="2" fontSize="xs" color="gray.600">
          <Spinner size="xs" />
          <Text>Checking the rock map for loose sand…</Text>
        </HStack>
      )}
      <Text as="li" fontSize="2xs" color="gray.500">
        Not in our data: rocks and holes smaller than 20 m, dust storms, wind, and solar storms. Check the Briefing for today&rsquo;s conditions.
      </Text>
    </VStack>
  )
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

function Card({ icon, title, tag, children }: { icon: ReactNode; title: string; tag?: string; children: ReactNode }) {
  return (
    <Box bg="white" borderWidth="1px" borderColor="gray.200" borderRadius="xl" px="3.5" py="3">
      <HStack gap="2" mb={tag ? '0.5' : '2'}>
        <Flex flexShrink={0} align="center" justify="center" boxSize="7" borderRadius="full" bg="brand.50" color="brand.700">
          {icon}
        </Flex>
        <Text as="h3" fontSize="sm" fontWeight="700" color="gray.900">
          {title}
        </Text>
      </HStack>
      {tag && (
        <Text fontSize="xs" color="gray.600" mb="2" pl="9">
          {tag}
        </Text>
      )}
      {children}
    </Box>
  )
}

function Figure({ icon, label, value, note }: { icon: ReactNode; label: string; value: string; note: string }) {
  return (
    <Box borderWidth="1px" borderColor="gray.200" borderRadius="lg" px="2.5" py="2">
      <HStack gap="1" color="gray.600">
        {icon}
        <Text fontSize="xs" fontWeight="600">
          {label}
        </Text>
      </HStack>
      <Text fontSize="lg" fontWeight="700" color="gray.900" lineHeight="1.25" fontVariantNumeric="tabular-nums">
        {value}
      </Text>
      <Text fontSize="2xs" color="gray.500">
        {note}
      </Text>
    </Box>
  )
}

function Notice({ tone, title, children }: { tone: 'red' | 'orange'; title?: string; children: ReactNode }) {
  return (
    <HStack align="flex-start" gap="2" m="3" p="3" borderRadius="lg" bg={`${tone}.50`} borderWidth="1px" borderColor={`${tone}.200`}>
      <Box flexShrink={0} mt="0.5" color={`${tone}.700`}>
        <TriangleAlert size={16} aria-hidden />
      </Box>
      <Box>
        {title && (
          <Text fontSize="sm" fontWeight="700" color={`${tone}.900`}>
            {title}
          </Text>
        )}
        <Text fontSize="sm" color={`${tone}.900`}>
          {children}
        </Text>
      </Box>
    </HStack>
  )
}

/** The height along every route, from start to goal. The chosen route is drawn thick. */
function RouteChart({ routes, selected }: { routes: RouteResult[]; selected: string }) {
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
  // The chosen route last, so it is drawn on top.
  const ordered = [...routes].sort((a, b) => Number(a.id === selected) - Number(b.id === selected))

  return (
    <Box>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Height along the routes, from ${whole.format(low)} to ${whole.format(high)} metres.`} style={{ display: 'block', borderRadius: 8, background: '#3a2a22' }}>
        {ordered.map((route) => (
          <path key={route.id} d={path(route)} fill="none" stroke={routeColor(route.id)} strokeWidth={route.id === selected ? 3 : 1.5} opacity={route.id === selected ? 1 : 0.6} strokeLinejoin="round" strokeLinecap="round" />
        ))}
      </svg>
      <Flex justify="space-between" fontSize="xs" color="gray.600" mt="1">
        <Text>Start</Text>
        <Text fontVariantNumeric="tabular-nums">
          {whole.format(low)} m to {whole.format(high)} m high
        </Text>
        <Text>{formatDistance(longest)}</Text>
      </Flex>
      <Flex as="ul" gap="3" rowGap="1" wrap="wrap" mt="1.5" fontSize="xs" color="gray.700" listStyleType="none">
        {routes.map((route) => (
          <HStack as="li" key={route.id} gap="1.5">
            <Flex align="center" justify="center" w="22px" h="12px" borderRadius="3px" bg="#3a2a22" aria-hidden>
              <Box w="16px" borderTopWidth={route.id === selected ? '3px' : '2px'} borderColor={routeColor(route.id)} />
            </Flex>
            <Text fontWeight={route.id === selected ? '700' : '400'}>{route.name}</Text>
          </HStack>
        ))}
      </Flex>
      <Text fontSize="2xs" color="gray.500" mt="1">
        Heights are drawn {whole.format(stretch)}× taller than real, so the hills are easy to see.
      </Text>
    </Box>
  )
}
