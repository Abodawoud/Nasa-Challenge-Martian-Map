// The "Place info" tool's panel: the picked place, what is known about it, saved waypoints.
// (The files keep the older name "identify". On screen the tool is called "Place info".)
//
// How it is written for the reader: every fact is one short sentence and one picture. The
// longer explanation (what the number means, how it was measured) sits behind a
// "What is this?" line, so the panel stays easy to read.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type * as Cesium from 'cesium'
import { Box, Button, Flex, HStack, IconButton, Input, SimpleGrid, Spinner, Text, VStack } from '@chakra-ui/react'
import { Bookmark, Camera, Check, Copy, MapPin, Mountain, Navigation, RotateCcw, Shapes, Trash2, TrendingUp, Waves } from 'lucide-react'
import Lightbox from 'yet-another-react-lightbox'
import Captions from 'yet-another-react-lightbox/plugins/captions'
import Counter from 'yet-another-react-lightbox/plugins/counter'
import Thumbnails from 'yet-another-react-lightbox/plugins/thumbnails'
import Zoom from 'yet-another-react-lightbox/plugins/zoom'
import 'yet-another-react-lightbox/styles.css'
import 'yet-another-react-lightbox/plugins/captions.css'
import 'yet-another-react-lightbox/plugins/counter.css'
import 'yet-another-react-lightbox/plugins/thumbnails.css'
import { IdentifyTool, PHOTO_RANGE_M, groundAt, landingSiteHeightM, rockAt, roverAt, waypointStore } from '../globe/identify'
import type { Fact, GroundFact, RockFact, RoverFact } from '../globe/identify'
import { flyToPlace, formatDistance, formatPlace } from '../globe/mapTools'
import type { LonLat } from '../globe/mapTools'
import { GroundCut, HeightScale, SlopeView, slopeBand } from './IdentifyCharts'
import { ToolCard } from './Sidebar'

const LOADING = { state: 'loading' } as const
/** Photos shown in the panel. The rest are in the viewer. */
const SHOWN_PHOTOS = 3
const metres = new Intl.NumberFormat('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const whole = new Intl.NumberFormat('en', { maximumFractionDigits: 0 })

interface Props {
  viewer: Cesium.Viewer | null
  /** Stays in the page while closed, so the waypoints are kept. */
  open: boolean
  onClose: () => void
}

/** "153 m above the landing site", "at the same height as the landing site". */
function againstLanding(heightM: number, landingM: number): string {
  const difference = heightM - landingM
  if (Math.abs(difference) < 0.5) return 'Same height as the landing site'
  return `${whole.format(Math.abs(difference))} m ${difference > 0 ? 'above' : 'below'} the landing site`
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

  /** Forget the picked place: the panel is as it was before the first click. Saved places are kept. */
  const reset = () => {
    tool.current?.clearPick()
    setPlace(null)
    setName('')
    setCopied(false)
    setPhoto(-1)
  }

  // Clicks on the map pick a place only while the panel is open.
  // Closing the tool resets it: the next time it opens, it starts fresh.
  useEffect(() => {
    tool.current?.setActive(open)
    if (!open) reset()
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
  const height = ground.state === 'ready' ? ground.value : undefined
  const slope = height && height.slopeDeg !== null ? height.slopeDeg : undefined

  return (
    <ToolCard id="tool-identify" title="Place info" icon={<MapPin size={16} aria-hidden />} onClose={onClose} width="392px">
      {!place ? (
        <VStack align="stretch" gap="3" px="4" py="5">
          <Box>
            <Text fontSize="md" fontWeight="700" color="gray.900">
              Click a place on the map
            </Text>
            <Text fontSize="sm" color="gray.600" mt="1">
              You will see what is known about that spot.
            </Text>
          </Box>
          <VStack as="ul" align="stretch" gap="2" listStyleType="none">
            <Promise icon={<Mountain size={16} aria-hidden />} text="How high it is, and how steep" />
            <Promise icon={<Shapes size={16} aria-hidden />} text="What the ground is made of" />
            <Promise icon={<Camera size={16} aria-hidden />} text="Real photos from the rover, if it drove nearby" />
          </VStack>
          <Text fontSize="xs" color="gray.500">
            Height and photos are available inside Jezero Crater.
          </Text>
        </VStack>
      ) : (
        <Box aria-live="polite" bg="gray.50">
          {/* The place */}
          <Flex align="center" gap="2" px="4" py="3" bg="brand.700" color="white">
            <Box flex="1" minW="0">
              <Text fontSize="2xs" fontWeight="700" letterSpacing="0.08em" textTransform="uppercase" color="whiteAlpha.700">
                You picked
              </Text>
              <Text fontSize="lg" fontWeight="700" fontVariantNumeric="tabular-nums" lineHeight="1.3">
                {formatPlace(place)}
              </Text>
            </Box>
            <Button size="xs" variant="outline" color="white" borderColor="whiteAlpha.500" _hover={{ bg: 'whiteAlpha.200' }} onClick={copy} aria-live="polite">
              {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button size="xs" variant="outline" color="white" borderColor="whiteAlpha.500" _hover={{ bg: 'whiteAlpha.200' }} onClick={reset} title="Forget this place and start again">
              <RotateCcw size={14} aria-hidden />
              Reset
            </Button>
          </Flex>

          {/* The three things most people want, in one row */}
          <SimpleGrid columns={3} bg="white" borderBottomWidth="1px" borderColor="gray.200">
            <Stat
              icon={<Mountain size={14} aria-hidden />}
              label="Height"
              loading={ground.state === 'loading'}
              value={height ? `${whole.format(height.elevationM)} m` : 'No data'}
              note={height && landingM !== undefined ? againstLanding(height.elevationM, landingM) : undefined}
            />
            <Stat
              icon={<TrendingUp size={14} aria-hidden />}
              label="Slope"
              loading={ground.state === 'loading'}
              value={slope !== undefined ? `${metres.format(slope)}°` : 'No data'}
              note={slope !== undefined ? slopeBand(slope).word : undefined}
              dot={slope !== undefined ? slopeBand(slope).color : undefined}
              divider
            />
            <Stat
              icon={<Shapes size={14} aria-hidden />}
              label="Ground"
              loading={rock.state === 'loading'}
              value={rock.state === 'ready' ? rock.value.label : 'No data'}
              dot={rock.state === 'ready' ? rock.value.color : undefined}
              square
              small
              divider
            />
          </SimpleGrid>

          <VStack align="stretch" gap="2.5" p="3">
            <Card icon={<Mountain size={16} aria-hidden />} title="How high is it?" source="USGS height map">
              <FactView fact={ground}>
                {(value) => (
                  <>
                    <Text fontSize="2xl" fontWeight="700" color="gray.900" fontVariantNumeric="tabular-nums" lineHeight="1.2">
                      {metres.format(value.elevationM)} m
                    </Text>
                    {landingM !== undefined && (
                      <Text fontSize="sm" color="gray.700">
                        {againstLanding(value.elevationM, landingM)}
                      </Text>
                    )}
                    <HeightScale valueM={value.elevationM} minM={value.areaMinM} maxM={value.areaMaxM} landingM={landingM} />
                    <More>
                      Mars has no sea, so heights are counted from an agreed zero level (the &ldquo;areoid&rdquo;). Jezero Crater lies below that level, which is why the number is negative. The bar goes from the lowest to the highest ground of our Jezero height map.
                    </More>
                  </>
                )}
              </FactView>
            </Card>

            {height && height.profile.heightsM.length > 2 && (
              <Card icon={<Waves size={16} aria-hidden />} title="What does the ground look like?" source="USGS height map">
                <GroundCut heightsM={height.profile.heightsM} halfWidthM={height.profile.halfWidthM} />
                <More>This is the ground seen from the side, as if cut along a line from west to east through the place you picked.</More>
              </Card>
            )}

            {height && (
              <Card icon={<TrendingUp size={16} aria-hidden />} title="How steep is it?" source="USGS height map">
                {slope === undefined ? (
                  <Text fontSize="sm" color="gray.600">
                    Not available at the very edge of the height map.
                  </Text>
                ) : (
                  <>
                    <HStack align="baseline" gap="2.5" mb="2">
                      <Text fontSize="2xl" fontWeight="700" color="gray.900" fontVariantNumeric="tabular-nums" lineHeight="1.2">
                        {metres.format(slope)}°
                      </Text>
                      <HStack gap="1.5">
                        <Box boxSize="10px" borderRadius="full" bg={slopeBand(slope).color} aria-hidden />
                        <Text fontSize="sm" fontWeight="600" color="gray.800">
                          {slopeBand(slope).word}
                        </Text>
                      </HStack>
                    </HStack>
                    <SlopeView degrees={slope} />
                    <More>
                      The slope is the angle of the ground, measured over about {height.resolutionM * 2} m. 0° is flat, 90° is a wall. The four groups are our own way to name the angle. They do not say if a place is safe.
                    </More>
                  </>
                )}
              </Card>
            )}

            <Card icon={<Shapes size={16} aria-hidden />} title="What is the ground made of?" source="USGS rock map">
              <FactView fact={rock}>
                {(value) => (
                  <HStack gap="3" align="flex-start">
                    <Box flexShrink={0} boxSize="36px" borderRadius="lg" bg={value.color} borderWidth="1px" borderColor="blackAlpha.300" aria-hidden />
                    <Box>
                      <Text fontSize="md" fontWeight="700" color="gray.900" lineHeight="1.3">
                        {value.label}
                      </Text>
                      <Text fontSize="sm" color="gray.700" mt="0.5">
                        {value.hint}
                      </Text>
                    </Box>
                  </HStack>
                )}
              </FactView>
            </Card>

            <Card icon={<Camera size={16} aria-hidden />} title="What does it really look like?" source="NASA">
              <FactView fact={rover}>
                {(value) =>
                  value.distanceM > PHOTO_RANGE_M ? (
                    <>
                      <Text fontSize="sm" color="gray.800">
                        No photos here: the rover did not come this way.
                      </Text>
                      <Text fontSize="xs" color="gray.600" mt="1">
                        Its path passes {formatDistance(value.distanceM)} from here. Switch on <b>Perseverance path</b> in Layers and pick a place on the line to see photos.
                      </Text>
                    </>
                  ) : value.photos.length === 0 ? (
                    <Text fontSize="sm" color="gray.700">
                      The rover drove {formatDistance(value.distanceM)} from here, but NASA has no ground photos for that day.
                    </Text>
                  ) : (
                    <>
                      <Text fontSize="sm" color="gray.800">
                        The rover drove <b>{formatDistance(value.distanceM)}</b> from here and took these photos.
                      </Text>
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
                                borderRadius="lg"
                                overflow="hidden"
                                borderWidth="1px"
                                borderColor="gray.300"
                                aria-label={more > 0 ? `Open the photo viewer: ${more} more photos` : `Open photo ${index + 1} of ${value.photos.length}`}
                                onClick={() => setPhoto(index)}
                                _hover={{ borderColor: 'brand.500' }}
                                _focusVisible={{ outline: '2px solid', outlineColor: 'brand.500', outlineOffset: '2px' }}
                              >
                                <img src={item.small} alt="" width={110} height={86} loading="lazy" style={{ display: 'block', width: '100%', height: 86, objectFit: 'cover', background: '#e5e7eb' }} />
                                {more > 0 && (
                                  <Flex position="absolute" inset="0" direction="column" align="center" justify="center" bg="rgba(12, 26, 61, 0.74)" color="white" aria-hidden>
                                    <Text fontSize="xl" fontWeight="700" lineHeight="1" fontVariantNumeric="tabular-nums">
                                      +{more}
                                    </Text>
                                    <Text fontSize="2xs" mt="0.5">
                                      more
                                    </Text>
                                  </Flex>
                                )}
                              </Box>
                            </Box>
                          )
                        })}
                      </SimpleGrid>
                      <Button size="xs" variant="outline" colorPalette="brand" mt="2" onClick={() => setPhoto(0)}>
                        <Camera size={14} aria-hidden />
                        See all {value.photos.length} photos
                      </Button>
                      <More>
                        The photos are from Mars day {value.sol} of the mission (a Mars day is called a &ldquo;sol&rdquo;), when the rover was nearest to this place. They show the area around the rover, not exactly the spot you clicked. Most raw rover photos are grey.
                      </More>
                    </>
                  )
                }
              </FactView>
            </Card>
          </VStack>

          <Box as="form" onSubmit={save} px="4" py="3" borderTopWidth="1px" borderColor="gray.200" bg="white">
            <label htmlFor="waypoint-name" style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#111827' }}>
              Save this place
            </label>
            <Text fontSize="xs" color="gray.600" mb="1.5">
              Give it a name to find it again later.
            </Text>
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
        <Text as="h3" px="4" pt="3" pb="1" fontSize="sm" fontWeight="700" color="gray.900">
          Saved places ({waypoints.length})
        </Text>
        {waypoints.length === 0 ? (
          <Text px="4" pb="3" fontSize="xs" color="gray.600">
            Nothing saved yet.
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
                <Button size="xs" variant="ghost" colorPalette="brand" disabled={!viewer} onClick={() => viewer && flyToPlace(viewer, waypoint, 3000)} aria-label={`Go to ${waypoint.name}`}>
                  <Navigation size={14} aria-hidden />
                  Go
                </Button>
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
        slides={photos.map((item) => ({ src: item.large, title: `${item.camera} · Mars day ${sol}`, description: item.caption }))}
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

/** One line of the "what you will see" list, before a place is picked. */
function Promise({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <HStack as="li" gap="2.5">
      <Flex flexShrink={0} align="center" justify="center" boxSize="8" borderRadius="full" bg="brand.50" color="brand.700">
        {icon}
      </Flex>
      <Text fontSize="sm" color="gray.800">
        {text}
      </Text>
    </HStack>
  )
}

/** One of the three things in the top row: a small label, the value, one line under it. */
function Stat({ icon, label, value, note, dot, square, small, divider, loading }: { icon: ReactNode; label: string; value: string; note?: string; dot?: string; square?: boolean; small?: boolean; divider?: boolean; loading: boolean }) {
  return (
    <Box px="3" py="2.5" minW="0" borderLeftWidth={divider ? '1px' : undefined} borderColor="gray.200">
      <HStack gap="1" color="gray.600">
        {icon}
        <Text fontSize="xs" fontWeight="600">
          {label}
        </Text>
      </HStack>
      {loading ? (
        <Spinner size="xs" mt="2" color="gray.500" />
      ) : (
        <>
          <HStack gap="1.5" mt="1" minW="0" align="center">
            {dot && small && <Box flexShrink={0} boxSize="12px" borderRadius={square ? '3px' : 'full'} bg={dot} borderWidth="1px" borderColor="blackAlpha.300" aria-hidden />}
            <Text fontSize={small ? 'sm' : 'lg'} fontWeight="700" color={value === 'No data' ? 'gray.500' : 'gray.900'} lineHeight="1.2" fontVariantNumeric="tabular-nums" lineClamp={2} whiteSpace={small ? undefined : 'nowrap'}>
              {value}
            </Text>
          </HStack>
          {note && (
            <HStack gap="1" mt="1" align="flex-start">
              {dot && !small && <Box flexShrink={0} mt="3px" boxSize="8px" borderRadius="full" bg={dot} aria-hidden />}
              <Text fontSize="2xs" color="gray.600" lineHeight="1.3">
                {note}
              </Text>
            </HStack>
          )}
        </>
      )}
    </Box>
  )
}

/** One question about the place, with its answer. Where the data comes from sits at the top right. */
function Card({ icon, title, source, children }: { icon: ReactNode; title: string; source: string; children: ReactNode }) {
  return (
    <Box bg="white" borderWidth="1px" borderColor="gray.200" borderRadius="xl" px="3.5" py="3" shadow="xs">
      <Flex align="center" gap="2" mb="2">
        <Flex flexShrink={0} align="center" justify="center" boxSize="7" borderRadius="full" bg="brand.50" color="brand.700">
          {icon}
        </Flex>
        <Text as="h3" flex="1" fontSize="sm" fontWeight="700" color="gray.900">
          {title}
        </Text>
        <Text flexShrink={0} fontSize="2xs" color="gray.500" px="1.5" py="0.5" borderRadius="full" bg="gray.100" title={`Data: ${source}`}>
          {source}
        </Text>
      </Flex>
      {children}
    </Box>
  )
}

/** The longer explanation, closed until asked for. */
function More({ children }: { children: ReactNode }) {
  return (
    <Box asChild mt="2.5" pt="2" borderTopWidth="1px" borderColor="gray.100">
      <details>
        <Box asChild cursor="pointer" fontSize="xs" fontWeight="600" color="brand.600" _hover={{ textDecoration: 'underline' }}>
          <summary>What is this?</summary>
        </Box>
        <Text fontSize="xs" color="gray.700" mt="1.5" lineHeight="1.5">
          {children}
        </Text>
      </details>
    </Box>
  )
}

/** Loading, "not available here" (with the reason), an error, or the fact itself. */
function FactView<T>({ fact, children }: { fact: Fact<T>; children: (value: T) => ReactNode }) {
  if (fact.state === 'loading') {
    return (
      <HStack gap="2" fontSize="sm" color="gray.600">
        <Spinner size="xs" />
        <Text>Loading…</Text>
      </HStack>
    )
  }
  if (fact.state === 'ready') return <>{children(fact.value)}</>
  return (
    <Text fontSize="sm" color={fact.state === 'error' ? 'red.700' : 'gray.600'}>
      {fact.why}
    </Text>
  )
}
