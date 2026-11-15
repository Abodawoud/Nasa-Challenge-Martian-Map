// Small charts for the Identify panel. Plain SVG and boxes, no chart library.
// Every chart also says its meaning in words, so it never depends on colour alone.
import { Box, Flex, HStack, Text } from '@chakra-ui/react'
import { SLOPE_BANDS } from '../globe/identify'

const whole = new Intl.NumberFormat('en', { maximumFractionDigits: 0 })
const NAVY = '#0c1a3d'
const RED = '#e8231f'

/**
 * Where a height lies between the lowest and the highest ground of the height map.
 * The landing site is marked too, as a place people know.
 */
export function HeightScale({ valueM, minM, maxM, landingM }: { valueM: number; minM: number; maxM: number; landingM?: number }) {
  const at = (height: number) => `${Math.min(100, Math.max(0, ((height - minM) / (maxM - minM || 1)) * 100))}%`
  return (
    <Box role="img" aria-label={`This place is at ${whole.format(valueM)} metres. The height map goes from ${whole.format(minM)} to ${whole.format(maxM)} metres.`}>
      <Box position="relative" h="34px" mt="1">
        {/* The bar: low ground dark, high ground light, like a height map. */}
        <Box position="absolute" insetX="0" top="14px" h="8px" borderRadius="full" bgGradient="to-r" gradientFrom="#3b2a6b" gradientVia="#b0623c" gradientTo="#f3d9a4" />
        {landingM !== undefined && (
          <Box position="absolute" top="10px" left={at(landingM)} transform="translateX(-50%)" w="2px" h="16px" bg={RED} title="Landing site" />
        )}
        {/* This place: a pin above the bar. */}
        <Box position="absolute" top="0" left={at(valueM)} transform="translateX(-50%)">
          <svg width="16" height="24" viewBox="0 0 16 24" aria-hidden>
            <path d="M8 23 L2.5 12 A6.5 6.5 0 1 1 13.5 12 Z" fill={NAVY} stroke="#fff" strokeWidth="1.5" />
            <circle cx="8" cy="8" r="2.2" fill="#fff" />
          </svg>
        </Box>
      </Box>
      <Flex justify="space-between" fontSize="2xs" color="gray.600" fontVariantNumeric="tabular-nums">
        <Text>Lowest {whole.format(minM)} m</Text>
        <Text>Highest {whole.format(maxM)} m</Text>
      </Flex>
      <HStack gap="3" mt="1" fontSize="2xs" color="gray.700">
        <HStack gap="1">
          <Box boxSize="8px" borderRadius="full" bg={NAVY} aria-hidden />
          <Text>This place</Text>
        </HStack>
        {landingM !== undefined && (
          <HStack gap="1">
            <Box w="2px" h="10px" bg={RED} aria-hidden />
            <Text>Landing site</Text>
          </HStack>
        )}
        <Text color="gray.500">Range: the whole Jezero height map</Text>
      </HStack>
    </Box>
  )
}

/**
 * A cut through the ground from west to east through the picked place.
 * The height is stretched so small changes can be seen, and the chart says by how much.
 */
export function GroundCut({ heightsM, halfWidthM }: { heightsM: Array<number | null>; halfWidthM: number }) {
  const known = heightsM.filter((h): h is number => h !== null)
  if (known.length < 3) return null
  const W = 292
  const H = 84
  const PAD = 6
  const low = Math.min(...known)
  const high = Math.max(...known)
  // Never zoom in on less than 10 m of height: flat ground must look flat.
  const span = Math.max(10, high - low)
  const middle = (low + high) / 2
  const x = (i: number) => (i / (heightsM.length - 1)) * W
  const y = (h: number) => PAD + (H - 2 * PAD) * (1 - (h - (middle - span / 2)) / span)

  // One shape per run of known heights (the cut can leave the height map at an edge).
  const runs: Array<Array<[number, number]>> = []
  let run: Array<[number, number]> = []
  heightsM.forEach((h, i) => {
    if (h === null) {
      if (run.length) runs.push(run)
      run = []
    } else run.push([x(i), y(h)])
  })
  if (run.length) runs.push(run)

  const centre = Math.floor(heightsM.length / 2)
  const here = heightsM[centre]
  // How many times taller the chart draws the ground than it really is.
  const stretch = (2 * halfWidthM) / W / (span / (H - 2 * PAD))
  const change = high - low

  return (
    <Box>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Ground from west to east over ${whole.format(2 * halfWidthM)} metres. It changes by ${whole.format(change)} metres in height.`} style={{ display: 'block', borderRadius: 6, background: '#f4f1ec' }}>
        {runs.map((points, i) => (
          <g key={i}>
            <path d={`M${points[0][0]} ${H} ${points.map(([px, py]) => `L${px.toFixed(1)} ${py.toFixed(1)}`).join(' ')} L${points[points.length - 1][0]} ${H} Z`} fill="#c98a63" opacity="0.55" />
            <path d={`M${points.map(([px, py]) => `${px.toFixed(1)} ${py.toFixed(1)}`).join(' L')}`} fill="none" stroke="#7a4a2e" strokeWidth="1.8" strokeLinejoin="round" />
          </g>
        ))}
        {here !== null && here !== undefined && (
          <g>
            <line x1={x(centre)} x2={x(centre)} y1={y(here)} y2={H} stroke={NAVY} strokeWidth="1" strokeDasharray="3 3" />
            <circle cx={x(centre)} cy={y(here)} r="4.5" fill={NAVY} stroke="#fff" strokeWidth="1.8" />
          </g>
        )}
      </svg>
      <Flex justify="space-between" fontSize="2xs" color="gray.600" mt="0.5">
        <Text>West, {whole.format(halfWidthM)} m</Text>
        <Text color="gray.800" fontWeight="600">
          This place
        </Text>
        <Text>East, {whole.format(halfWidthM)} m</Text>
      </Flex>
      <Text fontSize="2xs" color="gray.600" mt="1">
        The ground changes by <b>{whole.format(change)} m</b> in height along this {whole.format((2 * halfWidthM) / 1000)} km line. The height is drawn about {whole.format(Math.max(1, stretch))} times taller than real, so the shape can be seen.
      </Text>
    </Box>
  )
}

/** The slope on a band scale, with the name of every band written under it. */
export function SlopeGauge({ degrees }: { degrees: number }) {
  const max = SLOPE_BANDS[SLOPE_BANDS.length - 1].upTo
  const at = `${Math.min(100, (degrees / max) * 100)}%`
  let from = 0
  return (
    <Box role="img" aria-label={`Slope ${degrees.toFixed(1)} degrees on a scale from 0 to ${max} degrees.`}>
      <Box position="relative" pt="12px" mt="1">
        <Flex h="8px" borderRadius="full" overflow="hidden">
          {SLOPE_BANDS.map((band) => {
            const width = ((band.upTo - from) / max) * 100
            from = band.upTo
            return <Box key={band.upTo} w={`${width}%`} bg={band.color} />
          })}
        </Flex>
        <Box position="absolute" top="0" left={at} transform="translateX(-50%)">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
            <path d="M7 13 L1.5 2 H12.5 Z" fill={NAVY} stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
        </Box>
      </Box>
      <Flex fontSize="2xs" color="gray.600" mt="1" fontVariantNumeric="tabular-nums">
        {SLOPE_BANDS.map((band, i) => {
          const start = i === 0 ? 0 : SLOPE_BANDS[i - 1].upTo
          return (
            <Box key={band.upTo} w={`${((band.upTo - start) / max) * 100}%`} pr="1">
              <Text fontWeight="600" color="gray.700">
                {start}°{i === SLOPE_BANDS.length - 1 ? '+' : `–${band.upTo}°`}
              </Text>
              <Text lineHeight="1.2">{band.word}</Text>
            </Box>
          )
        })}
      </Flex>
    </Box>
  )
}
