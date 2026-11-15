// The Identify tool's panel: the picked place, what is known about it, and saved waypoints.
//
// Layout, top to bottom: the place, three numbers to read at a glance, then one card per
// kind of fact with a small chart, the rover's photos (they open in a viewer with arrows and
// thumbnails), and the waypoints.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type * as Cesium from 'cesium'
import { Box, Button, Flex, HStack, IconButton, Input, SimpleGrid, Spinner, Text, VStack } from '@chakra-ui/react'
import { Bookmark, Camera, Check, Copy, Mountain, MousePointerClick, Navigation, Shapes, Trash2, TrendingUp, Waves } from 'lucide-react'
import Lightbox from 'yet-another-react-lightbox'
import Captions from 'yet-another-react-lightbox/plugins/captions'
import Counter from 'yet-another-react-lightbox/plugins/counter'
import Thumbnails from 'yet-another-react-lightbox/plugins/thumbnails'
import Zoom from 'yet-another-react-lightbox/plugins/zoom'
import 'yet-another-react-lightbox/styles.css'
import 'yet-another-react-lightbox/plugins/captions.css'
import 'yet-another-react-lightbox/plugins/counter.css'
import 'yet-another-react-lightbox/plugins/thumbnails.css'
import { IdentifyTool, PHOTO_RANGE_M, groundAt, landingSiteHeightM, rockAt, roverAt, slopeWord, waypointStore } from '../globe/identify'
import type { Fact, GroundFact, RockFact, RoverFact } from '../globe/identify'
import { flyToPlace, formatDistance, formatPlace } from '../globe/mapTools'
import type { LonLat } from '../globe/mapTools'
import { GroundCut, HeightScale, SlopeGauge } from './IdentifyCharts'
import { ToolCard } from './Sidebar'

const LOADING = { state: 'loading' } as const
/** Photos shown in the panel. The rest are in the viewer. */
const SHOWN_PHOTOS = 3
const metres = new Intl.NumberFormat('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const whole = new Intl.NumberFormat('en', { maximumFractionDigits: 0 })

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
  const [landingM, setLandingM] = useState<number | undefined>()
  const [name, setName] = useState('')
  const [copied, setCopied] = useState(false)
  /** Which photo the viewer shows, or -1 when it is closed. */
  const [photo, setPhoto] = useState(-1)
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
    setCopied(false)
    setPhoto(-1)
    groundAt(place, abort.signal).then(keep(setGround), () => undefined)
    rockAt(place).then(keep(setRock), () => undefined)
    roverAt(place, abort.signal).then(keep(setRover), () => undefined)
    // The landing site's height, to compare with (asked once, then remembered).
    void landingSiteHeightM().then((height) => {
      if (!abort.signal.aborted) setLandingM(height)
    })
    return () => abort.abort()
  }, [place])

  if (!open) return null

  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!place) return
    waypointStore.add(place, name)
    setName('')
  }

  const copy = () => {
    if (!place) return
    void navigator.clipboard?.writeText(`${place.lat.toFixed(5)}, ${place.lon.toFixed(5)}`).then(() => setCopied(true))
  }

  const photos = rover.state === 'ready' ? rover.value.photos : []
  const sol = rover.state === 'ready' ? rover.value.sol : 0

  return (
    <ToolCard id="tool-identify" title="Identify" icon={<MousePointerClick size={16} aria-hidden />} onClose={onClose} width="392px">
      {!place ? (
        <Box px="4" py="5">
          <Text fontSize="sm" fontWeight="600" color="gray.900">
            Click any place on the map
          </Text>
          <Text fontSize="xs" color="gray.600" mt="1">
            You will see its coordinates, height, slope and rock type, and photos the rover took nearby. Height and photos exist inside Jezero Crater.
          </Text>
        </Box>
      ) : (
        <Box aria-live="polite" bg="gray.50">
          {/* The place */}
          <Flex align="center" gap="2" px="4" py="3" bg="brand.700" color="white">
            <Box flex="1" minW="0">
              <Text fontSize="2xs" fontWeight="700" letterSpacing="0.08em" textTransform="uppercase" color="whiteAlpha.700">
                Picked place
              </Text>
              <Text fontSize="md" fontWeight="700" fontVariantNumeric="tabular-nums">
                {formatPlace(place)}
              </Text>
              <Text fontSize="2xs" color="whiteAlpha.700">
                Latitude, then longitude counted to the east
              </Text>
            </Box>
            <IconButton aria-label={copied ? 'Coordinates copied' : 'Copy the coordinates'} title={copied ? 'Copied' : 'Copy the coordinates'} size="xs" variant="ghost" color="white" _hover={{ bg: 'whiteAlpha.200' }} onClick={copy}>
              {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
            </IconButton>
          </Flex>

          {/* Three numbers to read at a glance */}
          <SimpleGrid columns={3} gap="2" px="3" pt="3">
            <Tile label="Height" loading={ground.state === 'loading'} value={ground.state === 'ready' ? `${whole.format(ground.value.elevationM)} m` : '–'} />
            <Tile
              label="Slope"
              loading={ground.state === 'loading'}
              value={ground.state === 'ready' && ground.value.slopeDeg !== null ? `${metres.format(ground.value.slopeDeg)}°` : '–'}
              note={ground.state === 'ready' && ground.value.slopeDeg !== null ? slopeWord(ground.value.slopeDeg) : undefined}
            />
            <Tile label="Rock type" loading={rock.state === 'loading'} value={rock.state === 'ready' ? rock.value.label : '–'} swatch={rock.state === 'ready' ? rock.value.color : undefined} small />
          </SimpleGrid>

          <VStack align="stretch" gap="2" p="3">
            <Card icon={<Mountain size={15} aria-hidden />} title="Height" source={ground.state === 'ready' ? ground.value.source : undefined}>
              <FactView fact={ground}>
                {(value) => (
                  <>
                    <HStack align="baseline" gap="2">
                      <Text fontSize="xl" fontWeight="700" color="gray.900" fontVariantNumeric="tabular-nums" whiteSpace="nowrap" flexShrink={0}>
                        {metres.format(value.elevationM)} m
                      </Text>
                      {landingM !== undefined && (
                        <Text fontSize="xs" color="gray.700">
                          {Math.abs(value.elevationM - landingM) < 0.5 ? (
                            'the same as the landing site'
                          ) : (
                            <>
                              <b>{whole.format(Math.abs(value.elevationM - landingM))} m</b> {value.elevationM > landingM ? 'higher' : 'lower'} than the landing site
                            </>
                          )}
                        </Text>
                      )}
                    </HStack>
                    <HeightScale valueM={value.elevationM} minM={value.areaMinM} maxM={value.areaMaxM} landingM={landingM} />
                    <Text fontSize="2xs" color="gray.600" mt="1.5">
                      Counted from the Mars reference level (the areoid, Mars&rsquo;s &ldquo;sea level&rdquo;). All of Jezero lies below it, so the numbers are negative.
                    </Text>
                  </>
                )}
              </FactView>
            </Card>

            {ground.state === 'ready' && ground.value.profile.heightsM.length > 2 && (
              <Card icon={<Waves size={15} aria-hidden />} title="Shape of the ground" source={ground.value.source}>
                <GroundCut heightsM={ground.value.profile.heightsM} halfWidthM={ground.value.profile.halfWidthM} />
              </Card>
            )}

            {ground.state === 'ready' && (
              <Card icon={<TrendingUp size={15} aria-hidden />} title="Slope" source={ground.value.source}>
                {ground.value.slopeDeg === null ? (
                  <Text fontSize="xs" color="gray.600">
                    Not available at the very edge of the height map.
                  </Text>
                ) : (
                  <>
                    <HStack align="baseline" gap="2">
                      <Text fontSize="xl" fontWeight="700" color="gray.900" fontVariantNumeric="tabular-nums">
                        {metres.format(ground.value.slopeDeg)}°
                      </Text>
                      <Text fontSize="xs" color="gray.700">
                        {slopeWord(ground.value.slopeDeg)}
                      </Text>
                    </HStack>
                    <SlopeGauge degrees={ground.value.slopeDeg} />
                    <Text fontSize="2xs" color="gray.600" mt="1.5">
                      Measured over about {ground.value.resolutionM * 2} m of ground. The bands only describe the angle. They are not a safety rating.
                    </Text>
                  </>
                )}
              </Card>
            )}

            <Card icon={<Shapes size={15} aria-hidden />} title="Rock type" source={rock.state === 'ready' ? 'USGS geologic map SIM 3464 (Sun and Stack, 2020)' : undefined}>
              <FactView fact={rock}>
                {(value) => (
                  <HStack gap="2.5" align="flex-start">
                    <Box flexShrink={0} mt="0.5" boxSize="22px" borderRadius="md" bg={value.color} borderWidth="1px" borderColor="blackAlpha.400" aria-hidden />
                    <Box>
                      <Text fontSize="sm" fontWeight="700" color="gray.900">
                        {value.label}
                      </Text>
                      <Text fontSize="xs" color="gray.700">
                        {value.hint}
                      </Text>
                    </Box>
                  </HStack>
                )}
              </FactView>
            </Card>

            <Card icon={<Camera size={15} aria-hidden />} title="Real look: rover photos" source={rover.state === 'ready' ? 'NASA/JPL-Caltech, Mars 2020 raw images' : undefined}>
              <FactView fact={rover}>
                {(value) => (
                  <>
                    <Text fontSize="xs" color="gray.800">
                      {value.distanceM <= PHOTO_RANGE_M ? (
                        <>
                          Perseverance drove <b>{formatDistance(value.distanceM)}</b> from here on <b>sol {value.sol}</b> (a sol is one Mars day).
                        </>
                      ) : (
                        <>
                          The rover did not come here, so there are no photos. Its nearest drive was <b>{formatDistance(value.distanceM)}</b> away (sol {value.sol}). Pick a place on the rover&rsquo;s path to see photos.
                        </>
                      )}
                    </Text>
                    {value.distanceM <= PHOTO_RANGE_M && value.photos.length === 0 && (
                      <Text fontSize="xs" color="gray.600" mt="1">
                        NASA&rsquo;s feed has no ground photos for that sol.
                      </Text>
                    )}
                    {value.photos.length > 0 && (
                      <>
                        {/* Three photos. The third one carries "+N" for the rest: all of them are in the viewer. */}
                        <SimpleGrid as="ul" columns={3} gap="1.5" mt="2" listStyleType="none">
                          {value.photos.slice(0, SHOWN_PHOTOS).map((item, index) => {
                            const more = index === SHOWN_PHOTOS - 1 ? value.photos.length - SHOWN_PHOTOS : 0
                            return (
                              <Box as="li" key={item.small}>
                                <Box
                                  as="button"
                                  position="relative"
                                  display="block"
                                  w="full"
                                  p="0"
                                  cursor="zoom-in"
                                  borderRadius="md"
                                  overflow="hidden"
                                  borderWidth="1px"
                                  borderColor="gray.300"
                                  aria-label={more > 0 ? `Open the photo viewer: ${more} more photos` : `Open photo ${index + 1} of ${value.photos.length}: ${item.camera}, sol ${value.sol}`}
                                  onClick={() => setPhoto(index)}
                                  _hover={{ borderColor: 'brand.500' }}
                                  _focusVisible={{ outline: '2px solid', outlineColor: 'brand.500', outlineOffset: '2px' }}
                                >
                                  <img src={item.small} alt="" width={110} height={82} loading="lazy" style={{ display: 'block', width: '100%', height: 82, objectFit: 'cover', background: '#e5e7eb' }} />
                                  {more > 0 && (
                                    <Flex position="absolute" inset="0" align="center" justify="center" bg="rgba(12, 26, 61, 0.72)" color="white" fontSize="lg" fontWeight="700" fontVariantNumeric="tabular-nums" aria-hidden>
                                      +{more}
                                    </Flex>
                                  )}
                                </Box>
                              </Box>
                            )
                          })}
                        </SimpleGrid>
                        <Text fontSize="2xs" color="gray.600" mt="1.5">
                          {value.photos.length} photos taken by the rover on sol {value.sol}, near this place but not exactly on it. Click a photo to look through all of them.
                        </Text>
                      </>
                    )}
                  </>
                )}
              </FactView>
            </Card>
          </VStack>

          <Box as="form" onSubmit={save} px="4" py="3" borderTopWidth="1px" borderColor="gray.200" bg="white">
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

      {/* The photo viewer: arrows and keys to move between photos, thumbnails, zoom. */}
      <Lightbox
        open={photo >= 0}
        index={Math.max(0, photo)}
        close={() => setPhoto(-1)}
        slides={photos.map((item) => ({ src: item.large, title: `${item.camera} · sol ${sol}`, description: item.caption }))}
        plugins={[Captions, Counter, Thumbnails, Zoom]}
        captions={{ descriptionTextAlign: 'center', descriptionMaxLines: 3 }}
        thumbnails={{ width: 96, height: 64, border: 1, borderRadius: 6, padding: 0, gap: 8 }}
        zoom={{ maxZoomPixelRatio: 3 }}
        carousel={{ finite: photos.length < 2 }}
        styles={{ container: { backgroundColor: 'rgba(5, 11, 28, 0.94)' } }}
      />
    </ToolCard>
  )
}

/** One number to read at a glance. */
function Tile({ label, value, note, swatch, small, loading }: { label: string; value: string; note?: string; swatch?: string; small?: boolean; loading: boolean }) {
  return (
    <Box bg="white" borderWidth="1px" borderColor="gray.200" borderRadius="lg" px="2.5" py="2" minW="0">
      <Text fontSize="2xs" fontWeight="600" color="gray.600" textTransform="uppercase" letterSpacing="0.05em">
        {label}
      </Text>
      {loading ? (
        <Spinner size="xs" mt="1.5" color="gray.500" />
      ) : (
        <>
          <HStack gap="1.5" mt="0.5" minW="0">
            {swatch && <Box flexShrink={0} boxSize="10px" borderRadius="2px" bg={swatch} borderWidth="1px" borderColor="blackAlpha.400" aria-hidden />}
            <Text fontSize={small ? 'xs' : 'sm'} fontWeight="700" color="gray.900" lineHeight="1.25" fontVariantNumeric="tabular-nums" lineClamp={2} whiteSpace={small ? undefined : 'nowrap'}>
              {value}
            </Text>
          </HStack>
          {note && (
            <Text fontSize="2xs" color="gray.600" lineHeight="1.2" mt="0.5">
              {note}
            </Text>
          )}
        </>
      )}
    </Box>
  )
}

/** One kind of fact: a title, its content, and where the data comes from. */
function Card({ icon, title, source, children }: { icon: ReactNode; title: string; source?: string; children: ReactNode }) {
  return (
    <Box bg="white" borderWidth="1px" borderColor="gray.200" borderRadius="lg" px="3" py="2.5">
      <HStack gap="1.5" color="brand.700" mb="1.5">
        {icon}
        <Text as="h3" fontSize="xs" fontWeight="700" letterSpacing="0.02em">
          {title}
        </Text>
      </HStack>
      {children}
      {source && (
        <Text mt="2" pt="1.5" borderTopWidth="1px" borderColor="gray.100" fontSize="2xs" color="gray.500">
          Source: {source}
        </Text>
      )}
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
