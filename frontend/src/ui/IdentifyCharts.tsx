// Small pictures for the Place info panel. Plain SVG and boxes, no chart library.
// Every picture also says its meaning in words, so it never depends on colour alone.
import { Box, Flex, HStack, Text } from '@chakra-ui/react'
import { SLOPE_BANDS } from '../globe/identify'

const whole = new Intl.NumberFormat('en', { maximumFractionDigits: 0 })
const one = new Intl.NumberFormat('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const NAVY = '#0c1a3d'
const RED = '#e8231f'

/** The band a slope falls in. */
export function slopeBand(degrees: number) {
  return SLOPE_BANDS.find((band) => degrees < band.upTo) ?? SLOPE_BANDS[SLOPE_BANDS.length - 1]
}

/**
 * Where a height lies between the lowest and the highest ground of the height map.
 * The landing site is marked too, as a place people know.
 */
export function HeightScale({ valueM, minM, maxM, landingM }: { valueM: number; minM: number; maxM: number; landingM?: number }) {
  const at = (height: number) => `${Math.min(100, Math.max(0, ((height - minM) / (maxM - minM || 1)) * 100))}%`
  return (
    <Box role="img" aria-label={`This place is at ${whole.format(valueM)} metres. Jezero goes from ${whole.format(minM)} to ${whole.format(maxM)} metres.`}>
      <Box position="relative" h="38px" mt="2">
        {/* The bar: low ground dark, high ground light. */}
        <Box position="absolute" insetX="0" top="20px" h="10px" borderRadius="full" bgGradient="to-r" gradientFrom="#3b2a6b" gradientVia="#b0623c" gradientTo="#f3d9a4" />
        {landingM !== undefined && <Box position="absolute" top="16px" left={at(landingM)} transform="translateX(-50%)" w="3px" h="18px" borderRadius="full" bg={RED} outline="1.5px solid white" />}
        {/* This place: a pin above the bar. */}
        <Box position="absolute" top="0" left={at(valueM)} transform="translateX(-50%)">
          <svg width="20" height="30" viewBox="0 0 20 30" aria-hidden>
            <path d="M10 29 L3 15 A8 8 0 1 1 17 15 Z" fill={NAVY} stroke="#fff" strokeWidth="1.8" />
            <circle cx="10" cy="10" r="2.8" fill="#fff" />
          </svg>
        </Box>
      </Box>
      <Flex justify="space-between" mt="1" fontSize="xs" color="gray.700" fontVariantNumeric="tabular-nums">
        <Box>
          <Text fontWeight="600">Lowest ground</Text>
          <Text color="gray.600">{whole.format(minM)} m</Text>
        </Box>
        <Box textAlign="right">
          <Text fontWeight="600">Highest ground</Text>
          <Text color="gray.600">{whole.format(maxM)} m</Text>
        </Box>
      </Flex>
      <HStack gap="4" mt="2" fontSize="xs" color="gray.700">
        <HStack gap="1.5">
          <Box boxSize="10px" borderRadius="full" bg={NAVY} aria-hidden />
          <Text>This place</Text>
        </HStack>
        {landingM !== undefined && (
          <HStack gap="1.5">
            <Box w="3px" h="12px" borderRadius="full" bg={RED} aria-hidden />
            <Text>Landing site</Text>
          </HStack>
        )}
      </HStack>
    </Box>
  )
}

/**
 * A cut through the ground from west to east through the picked place.
 * The height is stretched so small changes can be seen, and the caption says by how much.
 */
export function GroundCut({ heightsM, halfWidthM }: { heightsM: Array<number | null>; halfWidthM: number }) {
  const known = heightsM.filter((h): h is number => h !== null)
  if (known.length < 3) return null
  const W = 320
  const H = 92
  const PAD = 8
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
  // How many times taller the picture draws the ground than it really is.
  const stretch = Math.max(1, (2 * halfWidthM) / W / (span / (H - 2 * PAD)))
  const change = high - low

  return (
    <Box>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Ground from west to east over ${whole.format(2 * halfWidthM)} metres. It changes by ${whole.format(change)} metres in height.`} style={{ display: 'block', borderRadius: 8, background: '#f6f2ec' }}>
        {runs.map((points, i) => (
          <g key={i}>
            <path d={`M${points[0][0]} ${H} ${points.map(([px, py]) => `L${px.toFixed(1)} ${py.toFixed(1)}`).join(' ')} L${points[points.length - 1][0]} ${H} Z`} fill="#c98a63" opacity="0.6" />
            <path d={`M${points.map(([px, py]) => `${px.toFixed(1)} ${py.toFixed(1)}`).join(' L')}`} fill="none" stroke="#7a4a2e" strokeWidth="2" strokeLinejoin="round" />
          </g>
        ))}
        {here !== null && here !== undefined && (
          <g>
            <line x1={x(centre)} x2={x(centre)} y1={y(here)} y2={H} stroke={NAVY} strokeWidth="1.2" strokeDasharray="3 3" />
            <circle cx={x(centre)} cy={y(here)} r="5" fill={NAVY} stroke="#fff" strokeWidth="2" />
          </g>
        )}
      </svg>
      <Flex justify="space-between" fontSize="xs" color="gray.600" mt="1">
        <Text>← West {whole.format(halfWidthM)} m</Text>
        <Text color="gray.900" fontWeight="600">
          You are here
        </Text>
        <Text>East {whole.format(halfWidthM)} m →</Text>
      </Flex>
      <Text fontSize="xs" color="gray.700" mt="2">
        Over this 1 km the ground goes up and down by <b>{whole.format(change)} m</b>.
      </Text>
      <Text fontSize="2xs" color="gray.500" mt="0.5">
        {stretch < 1.5 ? 'The picture shows the real proportions.' : `The picture is drawn ${whole.format(stretch)}× taller than real, so the shape is easy to see.`}
      </Text>
    </Box>
  )
}

/**
 * The slope as a picture: a ramp at the real angle, how much the ground rises over 100 m,
 * and the four bands with the one that applies marked.
 */
export function SlopeView({ degrees }: { degrees: number }) {
  const band = slopeBand(degrees)
  const tan = Math.tan((degrees * Math.PI) / 180)
  // The ramp is drawn at the true angle. For a steep slope it is made shorter to fit.
  const W = 320
  const H = 96
  const BASE = 66
  const LEFT = 22
  const run = Math.min(230, tan > 0 ? 52 / tan : 230)
  const rise = run * tan
  const right = LEFT + run
  const top = BASE - rise

  return (
    <Box>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`A ramp at ${one.format(degrees)} degrees: the ground rises ${one.format(tan * 100)} metres over 100 metres.`} style={{ display: 'block', borderRadius: 8, background: '#f6f2ec' }}>
        {/* The slope itself */}
        <path d={`M${LEFT} ${BASE} L${right} ${top} L${right} ${BASE} Z`} fill={band.color} opacity="0.3" />
        <path d={`M${LEFT} ${BASE} L${right} ${top}`} stroke={band.color} strokeWidth="3.5" strokeLinecap="round" />
        {/* Flat ground to compare with */}
        <path d={`M${LEFT} ${BASE} H${right + 14}`} stroke="#7a6a5c" strokeWidth="1.5" strokeDasharray="4 4" />
        {/* The rise */}
        {rise > 5 && <path d={`M${right} ${BASE} V${top}`} stroke="#7a6a5c" strokeWidth="1.5" />}
        <text x={right + 20} y={BASE - Math.max(4, rise / 2) + 4} fontSize="11" fontWeight="600" fill="#374151" fontFamily="Inter, system-ui, sans-serif">
          +{one.format(tan * 100)} m
        </text>
        <text x={LEFT} y={BASE + 20} fontSize="10" fill="#6b7280" fontFamily="Inter, system-ui, sans-serif">
          over 100 m of ground
        </text>
      </svg>

      <Text fontSize="xs" color="gray.800" mt="2">
        Walk 100 m and the ground rises <b>{one.format(tan * 100)} m</b>.
      </Text>

      {/* The four bands. The one that applies is marked with its colour and a tick. */}
      <Flex as="ul" gap="1" mt="2" listStyleType="none">
        {SLOPE_BANDS.map((item, i) => {
          const active = item === band
          const start = i === 0 ? 0 : SLOPE_BANDS[i - 1].upTo
          return (
            <Box
              as="li"
              key={item.upTo}
              flex="1"
              minW="0"
              px="1.5"
              py="1"
              borderRadius="md"
              borderWidth="1px"
              borderColor={active ? item.color : 'gray.200'}
              borderTopWidth="4px"
              borderTopColor={item.color}
              bg={active ? 'white' : 'gray.50'}
              opacity={active ? 1 : 0.7}
              aria-current={active ? 'true' : undefined}
            >
              <Text fontSize="2xs" color="gray.600" fontVariantNumeric="tabular-nums">
                {start}°{i === SLOPE_BANDS.length - 1 ? ' and up' : `–${item.upTo}°`}
              </Text>
              <Text fontSize="2xs" fontWeight={active ? '700' : '500'} color={active ? 'gray.900' : 'gray.600'} lineHeight="1.25">
                {active ? '✓ ' : ''}
                {item.word}
              </Text>
            </Box>
          )
        })}
      </Flex>
    </Box>
  )
}
