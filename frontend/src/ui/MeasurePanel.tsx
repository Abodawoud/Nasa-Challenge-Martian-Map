// The Measure tool's panel: how to use it, the points, the distance of every part, the total.
import { useEffect, useRef, useState } from 'react'
import type * as Cesium from 'cesium'
import { Box, Button, Flex, HStack, IconButton, Text, VStack } from '@chakra-ui/react'
import { Check, Ruler, Trash2, Undo2 } from 'lucide-react'
import { MeasureTool } from '../globe/measure'
import type { Measurement } from '../globe/measure'
import { formatDistance, formatPlace } from '../globe/mapTools'
import { ToolCard } from './Sidebar'

const EMPTY: Measurement = { points: [], segments: [], totalM: 0, finished: false }

interface Props {
  viewer: Cesium.Viewer | null
  /** Stays in the page while closed, so the measurement is kept and stays on the map. */
  open: boolean
  onClose: () => void
}

export function MeasurePanel({ viewer, open, onClose }: Props) {
  const tool = useRef<MeasureTool | null>(null)
  const [measurement, setMeasurement] = useState<Measurement>(EMPTY)

  useEffect(() => {
    if (!viewer) return
    const created = new MeasureTool(viewer, setMeasurement)
    tool.current = created
    return () => {
      created.destroy()
      tool.current = null
    }
  }, [viewer])

  // Clicks on the map add points only while the panel is open.
  useEffect(() => {
    tool.current?.setActive(open)
  }, [open, viewer])

  if (!open) return null
  const { points, segments, totalM, finished } = measurement

  return (
    <ToolCard id="tool-measure" title="Measure" icon={<Ruler size={16} aria-hidden />} onClose={onClose}>
      <Box px="4" py="3" borderBottomWidth="1px" borderColor="gray.100">
        <Text fontSize="xs" color="gray.700">
          <b>Click</b> to add points. <b>Double click</b> (or Esc, Enter, or a click on the last point) to finish. <b>Drag</b> a point to move it, <b>right click</b> it to delete it. <b>Backspace</b> removes the last point.
        </Text>
      </Box>

      {points.length === 0 ? (
        <Text px="4" py="4" fontSize="sm" color="gray.600">
          No points yet. Click two places on the map to measure the distance between them.
        </Text>
      ) : (
        <VStack as="ol" align="stretch" gap="0" listStyleType="none" aria-label="Measurement points">
          {points.map((point, i) => (
            <Box as="li" key={i}>
              {i > 0 && (
                <Flex align="center" gap="2" pl="6" pr="4" py="1" bg="gray.50" fontSize="xs" color="gray.700">
                  <Box w="2px" h="14px" bg="brand.300" aria-hidden />
                  <Text>
                    Point {i} to {i + 1}
                  </Text>
                  <Text ml="auto" fontWeight="700" color="gray.900" fontVariantNumeric="tabular-nums">
                    {formatDistance(segments[i - 1])}
                  </Text>
                </Flex>
              )}
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
        </VStack>
      )}

      <Box px="4" py="3" borderTopWidth="1px" borderColor="gray.200" bg="brand.50" aria-live="polite">
        <HStack justify="space-between">
          <HStack gap="2">
            <Text fontSize="sm" fontWeight="600" color="brand.700">
              Total distance
            </Text>
            {points.length > 1 && (
              <Text fontSize="2xs" fontWeight="700" px="1.5" py="0.5" borderRadius="full" bg={finished ? 'green.100' : 'orange.100'} color={finished ? 'green.800' : 'orange.800'}>
                {finished ? 'Finished' : 'Drawing…'}
              </Text>
            )}
          </HStack>
          <Text fontSize="lg" fontWeight="700" color="brand.700" fontVariantNumeric="tabular-nums">
            {points.length > 1 ? formatDistance(totalM) : '–'}
          </Text>
        </HStack>
        <Text fontSize="2xs" color="gray.600" mt="1">
          Measured over the Mars sphere (radius 3,396.19 km). The ups and downs of the ground are not counted, so a real walk is a little longer.
        </Text>
      </Box>

      <HStack px="4" py="3" gap="2" wrap="wrap" borderTopWidth="1px" borderColor="gray.100">
        {!finished && points.length > 1 && (
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
