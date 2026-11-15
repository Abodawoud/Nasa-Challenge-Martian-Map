// The Identify tool's panel: the picked place, what is known about it, and saved waypoints.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type * as Cesium from 'cesium'
import { Box, Button, Flex, HStack, IconButton, Input, Link, Spinner, Text, VStack } from '@chakra-ui/react'
import { Bookmark, Camera, Mountain, MousePointerClick, Navigation, Shapes, Trash2 } from 'lucide-react'
import { IdentifyTool, PHOTO_RANGE_M, groundAt, rockAt, roverAt, slopeWord, waypointStore } from '../globe/identify'
import type { Fact, GroundFact, RockFact, RoverFact } from '../globe/identify'
import { flyToPlace, formatDistance, formatPlace } from '../globe/mapTools'
import type { LonLat } from '../globe/mapTools'
import { ToolCard } from './Sidebar'

const LOADING = { state: 'loading' } as const
const metres = new Intl.NumberFormat('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

interface Props {
  viewer: Cesium.Viewer | null
  /** Stays in the page while closed, so the waypoints stay on the map. */
  open: boolean
  onClose: () => void
}

export function IdentifyPanel({ viewer, open, onClose }: Props) {
  const tool = useRef<IdentifyTool | null>(null)
  const [place, setPlace] = useState<LonLat | null>(null)
  const [ground, setGround] = useState<Fact<GroundFact>>(LOADING)
  const [rock, setRock] = useState<Fact<RockFact>>(LOADING)
  const [rover, setRover] = useState<Fact<RoverFact>>(LOADING)
  const [name, setName] = useState('')
  const waypoints = useSyncExternalStore(waypointStore.subscribe, waypointStore.get)

  useEffect(() => {
    if (!viewer) return
    const created = new IdentifyTool(viewer, setPlace)
    tool.current = created
    return () => {
      created.destroy()
      tool.current = null
    }
  }, [viewer])

  // Clicks on the map pick a place only while the panel is open.
  useEffect(() => {
    tool.current?.setActive(open)
  }, [open, viewer])

  // A new place: ask every source at the same time. A newer click cancels the older answers.
  useEffect(() => {
    if (!place) return
    const abort = new AbortController()
    const keep = <T,>(set: (fact: Fact<T>) => void) => (fact: Fact<T>) => {
      if (!abort.signal.aborted) set(fact)
    }
    setGround(LOADING)
    setRock(LOADING)
    setRover(LOADING)
    setName('')
    groundAt(place, abort.signal).then(keep(setGround), () => undefined)
    rockAt(place).then(keep(setRock), () => undefined)
    roverAt(place, abort.signal).then(keep(setRover), () => undefined)
    return () => abort.abort()
  }, [place])

  if (!open) return null

  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!place) return
    waypointStore.add(place, name)
    setName('')
  }

  return (
    <ToolCard id="tool-identify" title="Identify" icon={<MousePointerClick size={16} aria-hidden />} onClose={onClose}>
      {!place ? (
        <Text px="4" py="4" fontSize="sm" color="gray.700">
          <b>Click</b> any place on the map to see what is known about it: its coordinates, height, slope, rock type and the rover&rsquo;s photos.
        </Text>
      ) : (
        <Box aria-live="polite">
          <Box px="4" py="3" bg="brand.50" borderBottomWidth="1px" borderColor="gray.200">
            <Text fontSize="2xs" fontWeight="700" letterSpacing="0.06em" textTransform="uppercase" color="brand.700">
              Picked place
            </Text>
            <Text fontSize="md" fontWeight="700" color="gray.900" fontVariantNumeric="tabular-nums">
              {formatPlace(place)}
            </Text>
            <Text fontSize="2xs" color="gray.600">
              Latitude, then longitude counted east. Mars 2000 sphere.
            </Text>
          </Box>

          <Section icon={<Mountain size={15} aria-hidden />} title="Height and slope">
            <FactView fact={ground}>
              {(value) => (
                <>
                  <Row label="Height" value={`${metres.format(value.elevationM)} m`} note="Above the Mars reference level (the areoid, Mars's “sea level”). Jezero lies below it, so the number is negative." />
                  {value.slopeDeg === null ? (
                    <Row label="Slope" value="–" note="Not available at the very edge of the height map." />
                  ) : (
                    <Row label="Slope" value={`${metres.format(value.slopeDeg)}°`} note={`${slopeWord(value.slopeDeg)}. Measured over about ${value.resolutionM * 2} m of ground.`} />
                  )}
                  <Source>{value.source}</Source>
                </>
              )}
            </FactView>
          </Section>

          <Section icon={<Shapes size={15} aria-hidden />} title="Rock type">
            <FactView fact={rock}>
              {(value) => (
                <>
                  <HStack gap="2" align="flex-start">
                    <Box flexShrink={0} mt="1" boxSize="12px" borderRadius="2px" bg={value.color} borderWidth="1px" borderColor="blackAlpha.400" aria-hidden />
                    <Box>
                      <Text fontSize="sm" fontWeight="600" color="gray.900">
                        {value.label}
                      </Text>
                      <Text fontSize="xs" color="gray.700">
                        {value.hint}
                      </Text>
                    </Box>
                  </HStack>
                  <Source>USGS geologic map SIM 3464 (Sun and Stack, 2020)</Source>
                </>
              )}
            </FactView>
          </Section>

          <Section icon={<Camera size={15} aria-hidden />} title="Perseverance rover">
            <FactView fact={rover}>
              {(value) => (
                <>
                  <Text fontSize="xs" color="gray.800">
                    {value.distanceM <= PHOTO_RANGE_M ? (
                      <>
                        The rover drove <b>{formatDistance(value.distanceM)}</b> from here on <b>sol {value.sol}</b> (a sol is one Mars day).
                      </>
                    ) : (
                      <>
                        The rover did not come here. Its nearest drive was <b>{formatDistance(value.distanceM)}</b> away (sol {value.sol}).
                      </>
                    )}
                  </Text>
                  {value.photos.length > 0 && (
                    <>
                      <Flex gap="1.5" mt="2" wrap="wrap">
                        {value.photos.map((photo) => (
                          <Link key={photo.small} href={photo.large} target="_blank" rel="noreferrer" borderRadius="md" overflow="hidden" borderWidth="1px" borderColor="gray.200" title={photo.caption}>
                            <img src={photo.small} alt={photo.caption || `Photo by the rover on sol ${value.sol}`} width={138} height={104} loading="lazy" style={{ display: 'block', width: 138, height: 104, objectFit: 'cover' }} />
                          </Link>
                        ))}
                      </Flex>
                      <Text fontSize="2xs" color="gray.600" mt="1">
                        Photos the rover&rsquo;s navigation camera took on sol {value.sol}, not exactly at the picked place. Click a photo to open it.
                      </Text>
                    </>
                  )}
                  <Source>NASA/JPL-Caltech, Mars 2020 mission</Source>
                </>
              )}
            </FactView>
          </Section>

          <Box as="form" onSubmit={save} px="4" py="3" borderTopWidth="1px" borderColor="gray.200" bg="gray.50">
            <label htmlFor="waypoint-name" style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#1f2937', marginBottom: 4 }}>
              Save this place as a waypoint
            </label>
            <HStack gap="2">
              <Input id="waypoint-name" name="waypoint-name" size="sm" bg="white" autoComplete="off" maxLength={40} placeholder={`Waypoint ${waypoints.length + 1}…`} value={name} onChange={(event) => setName(event.target.value)} />
              <Button type="submit" size="sm" colorPalette="brand" flexShrink={0}>
                <Bookmark size={14} aria-hidden />
                Save
              </Button>
            </HStack>
          </Box>
        </Box>
      )}

      <Box borderTopWidth="1px" borderColor="gray.200">
        <Text as="h3" px="4" pt="3" pb="1" fontSize="2xs" fontWeight="700" letterSpacing="0.06em" textTransform="uppercase" color="brand.700">
          Waypoints ({waypoints.length})
        </Text>
        {waypoints.length === 0 ? (
          <Text px="4" pb="3" fontSize="xs" color="gray.600">
            None yet. Pick a place and save it. Waypoints stay on the map and are kept in this browser.
          </Text>
        ) : (
          <VStack as="ul" align="stretch" gap="0" listStyleType="none" pb="1">
            {waypoints.map((waypoint) => (
              <Flex as="li" key={waypoint.id} align="center" gap="1" pl="4" pr="2" py="1">
                <Box minW="0" flex="1">
                  <Text fontSize="sm" fontWeight="600" color="gray.900" truncate>
                    {waypoint.name}
                  </Text>
                  <Text fontSize="2xs" color="gray.600" fontVariantNumeric="tabular-nums">
                    {formatPlace(waypoint)}
                  </Text>
                </Box>
                <IconButton aria-label={`Fly to ${waypoint.name}`} title="Fly to it" size="xs" variant="ghost" color="brand.700" disabled={!viewer} onClick={() => viewer && flyToPlace(viewer, waypoint, 3000)}>
                  <Navigation size={14} aria-hidden />
                </IconButton>
                <IconButton aria-label={`Delete ${waypoint.name}`} title="Delete" size="xs" variant="ghost" color="gray.600" onClick={() => waypointStore.remove(waypoint.id)}>
                  <Trash2 size={14} aria-hidden />
                </IconButton>
              </Flex>
            ))}
          </VStack>
        )}
      </Box>
    </ToolCard>
  )
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Box px="4" py="3" borderBottomWidth="1px" borderColor="gray.100">
      <HStack gap="1.5" color="brand.700" mb="1.5">
        {icon}
        <Text as="h3" fontSize="xs" fontWeight="700">
          {title}
        </Text>
      </HStack>
      {children}
    </Box>
  )
}

/** Loading, "not available here" (with the reason), an error, or the fact itself. */
function FactView<T>({ fact, children }: { fact: Fact<T>; children: (value: T) => ReactNode }) {
  if (fact.state === 'loading') {
    return (
      <HStack gap="2" fontSize="xs" color="gray.600">
        <Spinner size="xs" />
        <Text>Loading…</Text>
      </HStack>
    )
  }
  if (fact.state === 'ready') return <>{children(fact.value)}</>
  return (
    <Text fontSize="xs" color={fact.state === 'error' ? 'red.700' : 'gray.600'}>
      {fact.why}
    </Text>
  )
}

function Row({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <Box mb="1.5">
      <HStack justify="space-between" align="baseline">
        <Text fontSize="xs" color="gray.700">
          {label}
        </Text>
        <Text fontSize="md" fontWeight="700" color="gray.900" fontVariantNumeric="tabular-nums">
          {value}
        </Text>
      </HStack>
      <Text fontSize="2xs" color="gray.600">
        {note}
      </Text>
    </Box>
  )
}

function Source({ children }: { children: ReactNode }) {
  return (
    <Text mt="1.5" fontSize="2xs" color="gray.500">
      Source: {children}
    </Text>
  )
}
