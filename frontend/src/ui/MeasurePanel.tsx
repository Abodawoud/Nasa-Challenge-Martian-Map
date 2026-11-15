// The Measure tool's panel: what to measure (distance or area), the units setting, the
// points, the distance of every part, and the result.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type * as Cesium from 'cesium'
import { Box, Button, Flex, HStack, IconButton, Text, VStack } from '@chakra-ui/react'
import { Check, Ruler, Settings, Spline, Square, Trash2, Undo2 } from 'lucide-react'
import { MEASURE_KINDS, MeasureTool } from '../globe/measure'
import type { MeasureKind, Measurement } from '../globe/measure'
import { formatArea, formatDistance, formatPlace } from '../globe/mapTools'
import { UNIT_SYSTEMS, unitStore } from '../globe/units'
import { ToolCard } from './Sidebar'

const EMPTY: Measurement = { points: [], segments: [], totalM: 0, finished: false, closed: false, areaM2: 0 }
const KIND_ICON = { distance: Spline, area: Square } as const

interface Props {
  viewer: Cesium.Viewer | null
  /**
   * Stays in the page while closed, so the measurement is kept. While closed, the drawing is
   * hidden on the map. It is back when the tool is opened again.
   */
  open: boolean
  onClose: () => void
}

export function MeasurePanel({ viewer, open, onClose }: Props) {
  const tool = useRef<MeasureTool | null>(null)
  const [measurement, setMeasurement] = useState<Measurement>(EMPTY)
  const [kind, setKind] = useState<MeasureKind>('distance')
  const [settings, setSettings] = useState(false)
  // Reading the units here makes the panel show its numbers again when the setting changes.
  const units = useSyncExternalStore(unitStore.subscribe, unitStore.get)

  useEffect(() => {
    if (!viewer) return
    const created = new MeasureTool(viewer, setMeasurement)
    tool.current = created
    return () => {
      created.destroy()
      tool.current = null
    }
  }, [viewer])

  // Open: clicks add points and the drawing shows. Closed: the drawing is hidden, not deleted.
  useEffect(() => {
    tool.current?.setActive(open)
  }, [open, viewer])

  useEffect(() => {
    tool.current?.setKind(kind)
  }, [kind, viewer])

  // The numbers on the map follow the units setting too.
  useEffect(() => {
    tool.current?.refreshLabels()
  }, [units])

  if (!open) return null
  const { points, segments, totalM, finished, areaM2 } = measurement
  const area = kind === 'area'
  /** Points needed before there is a result. */
  const enough = points.length >= (area ? 3 : 2)

  return (
    <ToolCard id="tool-measure" title="Measure" icon={<Ruler size={16} aria-hidden />} onClose={onClose}>
      {/* What to measure, and the settings button */}
      <Flex align="center" gap="2" px="4" py="2.5" borderBottomWidth="1px" borderColor="gray.100">
        <HStack role="radiogroup" aria-label="What to measure" gap="1" p="1" borderRadius="lg" bg="gray.100" flex="1">
          {MEASURE_KINDS.map((item) => {
            const Icon = KIND_ICON[item.id]
            const chosen = kind === item.id
            return (
              <Button
                key={item.id}
                role="radio"
                aria-checked={chosen}
                title={item.note}
                onClick={() => setKind(item.id)}
                size="xs"
                flex="1"
                h="7"
                borderRadius="md"
                fontWeight="600"
                bg={chosen ? 'white' : 'transparent'}
                color={chosen ? 'brand.700' : 'gray.700'}
                shadow={chosen ? 'sm' : undefined}
                _hover={{ bg: chosen ? 'white' : 'gray.200' }}
              >
                <Icon size={14} aria-hidden />
                {item.title}
              </Button>
            )
          })}
        </HStack>
        <IconButton aria-label="Measurement settings" aria-expanded={settings} aria-controls="measure-settings" title="Settings" size="xs" variant={settings ? 'solid' : 'outline'} colorPalette="brand" onClick={() => setSettings((shown) => !shown)}>
          <Settings size={15} aria-hidden />
        </IconButton>
      </Flex>

      {settings && (
        <Box id="measure-settings" px="4" py="3" bg="gray.50" borderBottomWidth="1px" borderColor="gray.200">
          <Text as="h3" fontSize="2xs" fontWeight="700" letterSpacing="0.06em" textTransform="uppercase" color="brand.700" mb="1.5">
            Units
          </Text>
          <VStack role="radiogroup" aria-label="Units" align="stretch" gap="1.5">
            {UNIT_SYSTEMS.map((system) => {
              const chosen = units === system.id
              return (
                <Flex
                  as="button"
                  key={system.id}
                  role="radio"
                  aria-checked={chosen}
                  onClick={() => unitStore.set(system.id)}
                  align="center"
                  gap="2.5"
                  px="2.5"
                  py="1.5"
                  textAlign="left"
                  cursor="pointer"
                  borderRadius="md"
                  borderWidth="1px"
                  borderColor={chosen ? 'brand.500' : 'gray.200'}
                  bg="white"
                  _hover={{ borderColor: 'brand.400' }}
                  _focusVisible={{ outline: '2px solid', outlineColor: 'brand.500', outlineOffset: '2px' }}
                >
                  <Flex flexShrink={0} align="center" justify="center" boxSize="4" borderRadius="full" borderWidth="2px" borderColor={chosen ? 'brand.700' : 'gray.400'}>
                    {chosen && <Box boxSize="2" borderRadius="full" bg="brand.700" />}
                  </Flex>
                  <Box>
                    <Text fontSize="sm" fontWeight="600" color="gray.900">
                      {system.title}
                    </Text>
                    <Text fontSize="2xs" color="gray.600">
                      {system.note}
                    </Text>
                  </Box>
                </Flex>
              )
            })}
          </VStack>
          <Text fontSize="2xs" color="gray.600" mt="2">
            The setting is kept in this browser. Heights in Identify stay in metres.
          </Text>
        </Box>
      )}

      <Box px="4" py="2.5" borderBottomWidth="1px" borderColor="gray.100">
        <Text fontSize="xs" color="gray.700">
          <b>Click</b> to add {area ? 'corners' : 'points'}. <b>Double click</b> to finish{area ? ' (or click the first corner)' : ''}. <b>Drag</b> a point to move it, <b>right click</b> it to delete it.
        </Text>
      </Box>

      {points.length === 0 ? (
        <Text px="4" py="4" fontSize="sm" color="gray.600">
          {area ? 'No corners yet. Click three or more places on the map to measure the area inside them.' : 'No points yet. Click two places on the map to measure the distance between them.'}
        </Text>
      ) : (
        <VStack as="ol" align="stretch" gap="0" listStyleType="none" aria-label="Measurement points">
          {points.map((point, i) => (
            <Box as="li" key={i}>
              {i > 0 && <Part from={i} to={i + 1} metres={segments[i - 1]} />}
              <Flex align="center" gap="2.5" px="4" py="1.5">
                <Flex flexShrink={0} align="center" justify="center" boxSize="5" borderRadius="full" bg="brand.700" color="white" fontSize="2xs" fontWeight="700">
                  {i + 1}
                </Flex>
                <Text fontSize="xs" color="gray.800" fontVariantNumeric="tabular-nums">
                  {formatPlace(point)}
                </Text>
                <IconButton ml="auto" aria-label={`Delete point ${i + 1}`} size="2xs" variant="ghost" color="gray.600" onClick={() => tool.current?.removePoint(i)}>
                  <Trash2 size={14} aria-hidden />
                </IconButton>
              </Flex>
            </Box>
          ))}
          {/* A shape: the side that closes it, from the last corner back to the first. */}
          {area && points.length > 2 && (
            <Box as="li">
              <Part from={points.length} to={1} metres={segments[segments.length - 1]} />
            </Box>
          )}
        </VStack>
      )}

      <Box px="4" py="3" borderTopWidth="1px" borderColor="gray.200" bg="brand.50" aria-live="polite">
        <HStack justify="space-between">
          <HStack gap="2">
            <Text fontSize="sm" fontWeight="600" color="brand.700">
              {area ? 'Area' : 'Total distance'}
            </Text>
            {enough && (
              <Text fontSize="2xs" fontWeight="700" px="1.5" py="0.5" borderRadius="full" bg={finished ? 'green.100' : 'orange.100'} color={finished ? 'green.800' : 'orange.800'}>
                {finished ? 'Finished' : 'Drawing…'}
              </Text>
            )}
          </HStack>
          <Text fontSize="lg" fontWeight="700" color="brand.700" fontVariantNumeric="tabular-nums">
            {!enough ? '–' : area ? formatArea(areaM2) : formatDistance(totalM)}
          </Text>
        </HStack>
        {area && enough && (
          <HStack justify="space-between" mt="1">
            <Text fontSize="xs" color="gray.700">
              Distance around
            </Text>
            <Text fontSize="sm" fontWeight="700" color="gray.900" fontVariantNumeric="tabular-nums">
              {formatDistance(totalM)}
            </Text>
          </HStack>
        )}
        <Text fontSize="2xs" color="gray.600" mt="1">
          Measured over the Mars sphere (radius 3,396.19 km). The ups and downs of the ground are not counted, so {area ? 'the real surface is a little larger' : 'a real walk is a little longer'}.
        </Text>
      </Box>

      <HStack px="4" py="3" gap="2" wrap="wrap" borderTopWidth="1px" borderColor="gray.100">
        {!finished && enough && (
          <Button size="xs" colorPalette="brand" onClick={() => tool.current?.finish()}>
            <Check size={14} aria-hidden />
            Finish
          </Button>
        )}
        <Button size="xs" variant="outline" colorPalette="brand" disabled={points.length === 0} onClick={() => tool.current?.removeLast()}>
          <Undo2 size={14} aria-hidden />
          Undo point
        </Button>
        <Button size="xs" variant="outline" colorPalette="red" disabled={points.length === 0} onClick={() => tool.current?.clear()}>
          <Trash2 size={14} aria-hidden />
          Clear
        </Button>
      </HStack>
    </ToolCard>
  )
}

/** The distance of one part, between two rows of points. */
function Part({ from, to, metres }: { from: number; to: number; metres: number }) {
  return (
    <Flex align="center" gap="2" pl="6" pr="4" py="1" bg="gray.50" fontSize="xs" color="gray.700">
      <Box w="2px" h="14px" bg="brand.300" aria-hidden />
      <Text>
        Point {from} to {to}
      </Text>
      <Text ml="auto" fontWeight="700" color="gray.900" fontVariantNumeric="tabular-nums">
        {formatDistance(metres)}
      </Text>
    </Flex>
  )
}
