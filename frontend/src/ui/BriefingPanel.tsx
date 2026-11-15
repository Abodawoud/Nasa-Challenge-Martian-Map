// The Briefing: what an astronaut walks into at Jezero. Weather from NASA's rover weather
// station, radiation, daylight, dust and wind, and the ground. Every card says where its
// number comes from, how old it is, and what is NOT known.
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Box, Button, Flex, HStack, SimpleGrid, Spinner, Text, VStack } from '@chakra-ui/react'
import { ClipboardList, Gauge, MapPin, Radiation, Route, Sun, Thermometer, TriangleAlert, Wind } from 'lucide-react'
import { RADIATION_MSV_PER_DAY, SPACEWALK_LIMIT_S, walkDoseMsv } from '../globe/route'
import { EARTH_PRESSURE_PA, inDustSeason, loadWeather } from '../globe/weather'
import type { WeatherSol } from '../globe/weather'
import { ToolCard } from './Sidebar'
import type { Tool } from './Sidebar'

const whole = new Intl.NumberFormat('en', { maximumFractionDigits: 0 })
const one = new Intl.NumberFormat('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const two = new Intl.NumberFormat('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const longDate = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

type Weather = { state: 'loading' } | { state: 'error' } | { state: 'ready'; sols: WeatherSol[] }

export function BriefingPanel({ onClose, onOpenTool }: { onClose: () => void; onOpenTool: (tool: Tool) => void }) {
  const [weather, setWeather] = useState<Weather>({ state: 'loading' })

  useEffect(() => {
    let alive = true
    loadWeather().then(
      (sols) => alive && setWeather({ state: 'ready', sols }),
      () => alive && setWeather({ state: 'error' }),
    )
    return () => {
      alive = false
    }
  }, [])

  // The newest sol that has real numbers (some sols in the feed are empty).
  const sols = weather.state === 'ready' ? weather.sols : []
  const latest = [...sols].reverse().find((sol) => sol.minTempC !== null && sol.maxTempC !== null) ?? sols[sols.length - 1]
  const dust = latest ? inDustSeason(latest.solarLongitude) : undefined
  const spacewalkDose = walkDoseMsv(SPACEWALK_LIMIT_S)

  return (
    <ToolCard id="tool-briefing" title="Briefing" icon={<ClipboardList size={16} aria-hidden />} onClose={onClose} width="440px">
      <Box px="4" py="3" bg="brand.700" color="white">
        <Text fontSize="2xs" fontWeight="700" letterSpacing="0.08em" textTransform="uppercase" color="whiteAlpha.700">
          Before you go outside
        </Text>
        <Text fontSize="lg" fontWeight="700" lineHeight="1.3">
          Jezero Crater, Mars
        </Text>
        <Text fontSize="xs" color="whiteAlpha.800" mt="0.5">
          What you walk into: cold, thin air, radiation, dust. Real NASA numbers where they exist. Where they do not, this page says so.
        </Text>
      </Box>

      {/* The quick read */}
      <SimpleGrid columns={3} bg="white" borderBottomWidth="1px" borderColor="gray.200">
        <Quick label="Air temperature" loading={weather.state === 'loading'} value={latest?.maxTempC != null && latest.minTempC != null ? `${whole.format(latest.minTempC)} to ${whole.format(latest.maxTempC)} °C` : 'No data'} tone="blue" />
        <Quick label="Radiation" value={`${RADIATION_MSV_PER_DAY} mSv a day`} tone="orange" divider />
        <Quick label="Dust storm season" loading={weather.state === 'loading'} value={dust === undefined ? 'No data' : dust ? 'Yes' : 'No'} tone={dust ? 'orange' : 'green'} divider />
      </SimpleGrid>

      <VStack align="stretch" gap="2.5" p="3" bg="gray.50">
        <Card icon={<Thermometer size={16} aria-hidden />} title="Weather at Jezero" tag="NASA rover weather station">
          {weather.state === 'loading' && (
            <HStack gap="2" fontSize="sm" color="gray.600">
              <Spinner size="xs" />
              <Text>Loading from NASA…</Text>
            </HStack>
          )}
          {weather.state === 'error' && (
            <Text fontSize="sm" color="red.700">
              NASA&rsquo;s weather feed could not be reached.
            </Text>
          )}
          {latest && (
            <>
              <HStack align="flex-start" gap="2" p="2" mb="2.5" borderRadius="lg" bg="orange.50" borderWidth="1px" borderColor="orange.200">
                <Box flexShrink={0} mt="0.5" color="orange.700">
                  <TriangleAlert size={14} aria-hidden />
                </Box>
                <Text fontSize="xs" color="orange.900">
                  This is the <b>newest reading NASA has published</b>: Mars day {latest.sol} of the mission, {longDate.format(new Date(`${latest.date}T00:00:00Z`))}. It is not today&rsquo;s weather.
                </Text>
              </HStack>
              <SimpleGrid columns={2} gap="2">
                <Figure label="Coldest in the night" value={latest.minTempC !== null ? `${one.format(latest.minTempC)} °C` : '–'} />
                <Figure label="Warmest in the day" value={latest.maxTempC !== null ? `${one.format(latest.maxTempC)} °C` : '–'} />
                <Figure label="Air pressure" value={latest.pressurePa !== null ? `${whole.format(latest.pressurePa)} Pa` : '–'} note={latest.pressurePa !== null ? `${one.format((latest.pressurePa / EARTH_PRESSURE_PA) * 100)}% of the air pressure on Earth` : undefined} />
                <Figure label="Season" value={latest.season ? latest.season[0].toUpperCase() + latest.season.slice(1) : '–'} note="in the north of Mars" />
              </SimpleGrid>
              {sols.length > 1 && <TempChart sols={sols} />}
              <More>
                The numbers come from the weather station on the Perseverance rover, which stands in Jezero. The air is almost all carbon dioxide and far too thin to breathe: a space suit is always needed. The pressure is given in pascal (Pa).
              </More>
            </>
          )}
        </Card>

        <Card icon={<Sun size={16} aria-hidden />} title="Daylight" tag="NASA rover weather station">
          {latest?.daylightHours != null ? (
            <>
              <DayBar sunrise={latest.sunrise} sunset={latest.sunset} />
              <Text fontSize="sm" color="gray.800" mt="2">
                The Sun is up for about <b>{one.format(latest.daylightHours)} hours</b>, from {latest.sunrise} to {latest.sunset} local time.
              </Text>
              <More>
                A day on Mars (a &ldquo;sol&rdquo;) lasts 24 hours and 37 minutes. Plan a walk so that you are back before sunset: the night is very cold and dark. The times are from the same NASA reading as the weather above.
              </More>
            </>
          ) : (
            <Text fontSize="sm" color="gray.600">
              {weather.state === 'loading' ? 'Loading…' : 'No sunrise and sunset times available.'}
            </Text>
          )}
        </Card>

        <Card icon={<Radiation size={16} aria-hidden />} title="Radiation" tag="Measured by the Curiosity rover">
          <HStack align="baseline" gap="2">
            <Text fontSize="2xl" fontWeight="700" color="gray.900" lineHeight="1.2" fontVariantNumeric="tabular-nums">
              {RADIATION_MSV_PER_DAY} mSv
            </Text>
            <Text fontSize="sm" color="gray.700">
              per day on the surface
            </Text>
          </HStack>
          <Text fontSize="sm" color="gray.800" mt="1.5">
            One spacewalk of 8 hours gives about <b>{two.format(spacewalkDose)} mSv</b>. The level is nearly the same everywhere in Jezero, so the way to get less is to spend less time outside.
          </Text>
          <More>
            Mars has almost no air and no magnetic field to stop cosmic rays. The number was measured by NASA&rsquo;s Curiosity rover in Gale Crater, which is about as low as Jezero. We use it here as an estimate. It does not include solar storms, which can raise the dose for a few hours. To see where the planet gets more or less, switch on &ldquo;Cosmic radiation (estimate)&rdquo; in Layers.
          </More>
          <Button size="xs" variant="outline" colorPalette="brand" mt="2" onClick={() => onOpenTool('layers')}>
            Open Layers
          </Button>
        </Card>

        <Card icon={<Wind size={16} aria-hidden />} title="Wind and dust" tag="Partly known">
          <VStack align="stretch" gap="2">
            <Line
              tone={dust === undefined ? 'gray' : dust ? 'orange' : 'green'}
              title={dust === undefined ? 'Dust storm season: no data' : dust ? 'It is dust storm season' : 'It is not dust storm season'}
              text={
                latest
                  ? `At the newest reading Mars was at ${whole.format(latest.solarLongitude)}° of its year. Dust storms are most common between 180° and 360°. This is a rule for the whole planet, not a forecast for Jezero.`
                  : 'The season comes from NASA’s weather feed, which could not be read.'
              }
            />
            <Line tone="gray" title="Wind speed and dust in the air: not known" text="NASA's public weather feed for Jezero has no wind and no dust numbers. This page does not guess them." />
            <Line tone="orange" title="Loose sand on the ground: mapped" text="The USGS rock map marks wind-blown sand ripples (yellow in the Geologic units layer). Feet and wheels sink there. The Route tool tells you how much of a walk crosses them." />
          </VStack>
        </Card>

        <Card icon={<Gauge size={16} aria-hidden />} title="The ground" tag="Facts about Mars">
          <SimpleGrid columns={2} gap="2">
            <Figure label="Gravity" value="3.71 m/s²" note="38% of Earth: you weigh much less" />
            <Figure label="Height of the crater floor" value="about −2,600 m" note="below Mars's zero level" />
          </SimpleGrid>
          <Text fontSize="sm" color="gray.800" mt="2">
            The ground changes from place to place: flat crater floor, the steep front of the old river delta, the crater rim.
          </Text>
          <HStack gap="2" mt="2" wrap="wrap">
            <Button size="xs" variant="outline" colorPalette="brand" onClick={() => onOpenTool('identify')}>
              <MapPin size={14} aria-hidden />
              Check one place
            </Button>
            <Button size="xs" variant="outline" colorPalette="brand" onClick={() => onOpenTool('route')}>
              <Route size={14} aria-hidden />
              Plan a walk
            </Button>
          </HStack>
        </Card>
      </VStack>
    </ToolCard>
  )
}

/** One of the three things in the top row. */
function Quick({ label, value, tone, divider, loading }: { label: string; value: string; tone: 'blue' | 'orange' | 'green'; divider?: boolean; loading?: boolean }) {
  return (
    <Box px="3" py="2.5" minW="0" borderLeftWidth={divider ? '1px' : undefined} borderColor="gray.200">
      <Text fontSize="2xs" fontWeight="600" color="gray.600" lineHeight="1.3">
        {label}
      </Text>
      {loading ? (
        <Spinner size="xs" mt="1.5" color="gray.500" />
      ) : (
        <HStack gap="1.5" mt="1" align="center">
          <Box flexShrink={0} boxSize="8px" borderRadius="full" bg={`${tone}.500`} aria-hidden />
          <Text fontSize="sm" fontWeight="700" color={value === 'No data' ? 'gray.500' : 'gray.900'} lineHeight="1.25" fontVariantNumeric="tabular-nums">
            {value}
          </Text>
        </HStack>
      )}
    </Box>
  )
}

function Card({ icon, title, tag, children }: { icon: ReactNode; title: string; tag: string; children: ReactNode }) {
  return (
    <Box bg="white" borderWidth="1px" borderColor="gray.200" borderRadius="xl" px="3.5" py="3" shadow="xs">
      <Flex align="center" gap="2" mb="2">
        <Flex flexShrink={0} align="center" justify="center" boxSize="7" borderRadius="full" bg="brand.50" color="brand.700">
          {icon}
        </Flex>
        <Text as="h3" flex="1" fontSize="sm" fontWeight="700" color="gray.900">
          {title}
        </Text>
        <Text flexShrink={0} fontSize="2xs" color="gray.500" px="1.5" py="0.5" borderRadius="full" bg="gray.100">
          {tag}
        </Text>
      </Flex>
      {children}
    </Box>
  )
}

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Box borderWidth="1px" borderColor="gray.200" borderRadius="lg" px="2.5" py="2">
      <Text fontSize="xs" fontWeight="600" color="gray.600">
        {label}
      </Text>
      <Text fontSize="lg" fontWeight="700" color="gray.900" lineHeight="1.25" fontVariantNumeric="tabular-nums">
        {value}
      </Text>
      {note && (
        <Text fontSize="2xs" color="gray.500" lineHeight="1.3">
          {note}
        </Text>
      )}
    </Box>
  )
}

/** One statement with a coloured edge: green = fine, orange = take care, grey = not known. */
function Line({ tone, title, text }: { tone: 'green' | 'orange' | 'gray'; title: string; text: string }) {
  return (
    <Box pl="2.5" borderLeftWidth="4px" borderColor={tone === 'gray' ? 'gray.300' : `${tone}.400`}>
      <Text fontSize="sm" fontWeight="700" color="gray.900">
        {title}
      </Text>
      <Text fontSize="xs" color="gray.700">
        {text}
      </Text>
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

/** The day as a bar: night, daylight, night. */
function DayBar({ sunrise, sunset }: { sunrise: string; sunset: string }) {
  const hours = (time: string) => {
    const [h, m] = time.split(':').map(Number)
    return h + m / 60
  }
  const from = (hours(sunrise) / 24) * 100
  const to = (hours(sunset) / 24) * 100
  return (
    <Box role="img" aria-label={`Daylight from ${sunrise} to ${sunset}.`}>
      <Box position="relative" h="14px" borderRadius="full" bg="#1b2440" overflow="hidden">
        <Box position="absolute" top="0" bottom="0" left={`${from}%`} w={`${to - from}%`} bgGradient="to-r" gradientFrom="#f6c66b" gradientVia="#fde9b0" gradientTo="#f6c66b" />
      </Box>
      <Flex position="relative" h="16px" mt="0.5" fontSize="2xs" color="gray.600" fontVariantNumeric="tabular-nums">
        <Text position="absolute" left="0">
          00:00
        </Text>
        <Text position="absolute" left={`${from}%`} transform="translateX(-50%)" fontWeight="600" color="gray.800">
          {sunrise}
        </Text>
        <Text position="absolute" left={`${to}%`} transform="translateX(-50%)" fontWeight="600" color="gray.800">
          {sunset}
        </Text>
        <Text position="absolute" right="0">
          24:00
        </Text>
      </Flex>
    </Box>
  )
}

/** The coldest and warmest air temperature of the last sols in the feed, as bars. */
function TempChart({ sols }: { sols: WeatherSol[] }) {
  const shown = sols.filter((sol) => sol.minTempC !== null && sol.maxTempC !== null).slice(-7)
  if (shown.length < 2) return null
  const low = Math.min(...shown.map((sol) => sol.minTempC!))
  const high = Math.max(...shown.map((sol) => sol.maxTempC!))
  const W = 360
  const H = 132
  const top = 18
  const bottom = 40
  const y = (temp: number) => top + (H - top - bottom) * (1 - (temp - low) / (high - low || 1))
  const slot = W / shown.length
  return (
    <Box mt="3">
      <Text fontSize="xs" fontWeight="600" color="gray.700" mb="1">
        Night and day temperature, last {shown.length} readings
      </Text>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Air temperature of the last ${shown.length} readings: between ${whole.format(low)} and ${whole.format(high)} degrees Celsius.`} style={{ display: 'block' }}>
        {shown.map((sol, i) => {
          const x = i * slot + slot / 2
          return (
            <g key={sol.sol}>
              <rect x={x - 7} y={y(sol.maxTempC!)} width="14" height={Math.max(2, y(sol.minTempC!) - y(sol.maxTempC!))} rx="7" fill="#5b7fd6" opacity="0.85" />
              <text x={x} y={y(sol.maxTempC!) - 5} textAnchor="middle" fontSize="10" fontWeight="600" fill="#374151" fontFamily="Inter, system-ui, sans-serif">
                {whole.format(sol.maxTempC!)}°
              </text>
              <text x={x} y={y(sol.minTempC!) + 13} textAnchor="middle" fontSize="10" fontWeight="600" fill="#374151" fontFamily="Inter, system-ui, sans-serif">
                {whole.format(sol.minTempC!)}°
              </text>
              <text x={x} y={H - 4} textAnchor="middle" fontSize="9" fill="#6b7280" fontFamily="Inter, system-ui, sans-serif">
                sol {sol.sol}
              </text>
            </g>
          )
        })}
      </svg>
    </Box>
  )
}
