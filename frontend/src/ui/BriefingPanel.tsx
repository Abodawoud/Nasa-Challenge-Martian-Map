// The Briefing: what an astronaut walks into at Jezero. Weather from NASA's rover weather
// station, radiation, daylight, dust and wind, and the ground. Every card says where its
// number comes from, how old it is, and what is NOT known.
//
// How it is written: first what it means for you (four short lines), then one card per
// subject with one big number, one short sentence, and the long explanation behind
// "What is this?".
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Box, Button, Flex, HStack, SimpleGrid, Spinner, Text, VStack } from '@chakra-ui/react'
import { ClipboardList, Clock, Gauge, MapPin, Radiation, Route, Shirt, Sun, Thermometer, TriangleAlert, Wind } from 'lucide-react'
import { RADIATION_MSV_PER_DAY, SPACEWALK_LIMIT_S, walkDoseMsv } from '../globe/route'
import { EARTH_PRESSURE_PA, inDustSeason, loadWeather } from '../globe/weather'
import type { WeatherSol } from '../globe/weather'
import { ToolCard } from './Sidebar'
import type { Tool } from './Sidebar'

const whole = new Intl.NumberFormat('en', { maximumFractionDigits: 0 })
const one = new Intl.NumberFormat('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const two = new Intl.NumberFormat('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const longDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

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
  const loading = weather.state === 'loading'

  return (
    <ToolCard id="tool-briefing" title="Briefing" icon={<ClipboardList size={16} aria-hidden />} onClose={onClose} width="440px">
      <Box px="5" py="4" bg="brand.700" color="white">
        <Text fontSize="xs" fontWeight="600" letterSpacing="0.1em" textTransform="uppercase" color="whiteAlpha.700">
          Before you go outside
        </Text>
        <Text fontSize="xl" fontWeight="700" lineHeight="1.3" mt="0.5">
          Jezero Crater, Mars
        </Text>
      </Box>

      {/* The quick read: three numbers */}
      <SimpleGrid columns={3} bg="white" borderBottomWidth="1px" borderColor="gray.200">
        <Quick
          icon={<Thermometer size={14} aria-hidden />}
          label="Air"
          loading={loading}
          value={latest?.maxTempC != null && latest.minTempC != null ? `${whole.format(latest.minTempC)}° to ${whole.format(latest.maxTempC)}°` : 'No data'}
          unit={latest?.maxTempC != null ? 'Celsius, night to day' : undefined}
        />
        <Quick icon={<Radiation size={14} aria-hidden />} label="Radiation" value={`${RADIATION_MSV_PER_DAY} mSv`} unit="every day" divider />
        <Quick icon={<Wind size={14} aria-hidden />} label="Dust storms" loading={loading} value={dust === undefined ? 'No data' : dust ? 'In season' : 'Off season'} unit={dust === undefined ? undefined : dust ? 'more likely now' : 'less likely now'} divider />
      </SimpleGrid>

      <VStack align="stretch" gap="3" p="3" bg="gray.50">
        {/* What it means, in plain actions */}
        <Box bg="white" borderWidth="1px" borderColor="gray.200" borderRadius="xl" px="4" py="3.5" shadow="xs">
          <Text as="h3" fontSize="sm" fontWeight="700" color="gray.900" mb="2.5">
            What it means for you
          </Text>
          <VStack as="ul" align="stretch" gap="2.5" listStyleType="none">
            <Advice icon={<Shirt size={15} aria-hidden />} title="Always wear the suit." text="The air is too thin to breathe and far below freezing." />
            <Advice
              icon={<Sun size={15} aria-hidden />}
              title={latest?.sunset ? `Be back before ${latest.sunset}.` : 'Be back before sunset.'}
              text="After sunset it is dark and much colder."
            />
            <Advice icon={<Clock size={15} aria-hidden />} title="Keep walks short." text="Radiation adds up with every hour outside." />
            <Advice
              icon={<Wind size={15} aria-hidden />}
              title={dust ? 'Watch for dust.' : 'Dust is less likely now.'}
              text={dust ? 'It is the season of dust storms on Mars.' : 'It is not the season of dust storms.'}
            />
          </VStack>
        </Box>

        <Card icon={<Thermometer size={16} aria-hidden />} title="Weather" tag="NASA rover weather station">
          {loading && (
            <HStack gap="2" fontSize="sm" color="gray.600">
              <Spinner size="xs" />
              <Text>Loading from NASA…</Text>
            </HStack>
          )}
          {weather.state === 'error' && <Body tone="red">NASA&rsquo;s weather feed could not be reached.</Body>}
          {latest && (
            <>
              <HStack align="flex-start" gap="2.5" px="3" py="2.5" mb="3" borderRadius="lg" bg="orange.50" borderWidth="1px" borderColor="orange.200">
                <Box flexShrink={0} mt="0.5" color="orange.700">
                  <TriangleAlert size={15} aria-hidden />
                </Box>
                <Box>
                  <Text fontSize="sm" fontWeight="700" color="orange.900" lineHeight="1.4">
                    Not today&rsquo;s weather
                  </Text>
                  <Text fontSize="xs" color="orange.900" lineHeight="1.5">
                    NASA&rsquo;s newest reading is from {longDate.format(new Date(`${latest.date}T00:00:00Z`))} (Mars day {latest.sol}).
                  </Text>
                </Box>
              </HStack>
              <SimpleGrid columns={2} gap="2.5">
                <Figure label="Coldest, at night" value={latest.minTempC !== null ? `${one.format(latest.minTempC)} °C` : '–'} />
                <Figure label="Warmest, by day" value={latest.maxTempC !== null ? `${one.format(latest.maxTempC)} °C` : '–'} />
                <Figure label="Air pressure" value={latest.pressurePa !== null ? `${whole.format(latest.pressurePa)} Pa` : '–'} note={latest.pressurePa !== null ? `${one.format((latest.pressurePa / EARTH_PRESSURE_PA) * 100)}% of Earth’s` : undefined} />
                <Figure label="Season" value={latest.season ? latest.season[0].toUpperCase() + latest.season.slice(1) : '–'} note="north of Mars" />
              </SimpleGrid>
              {sols.length > 1 && <TempChart sols={sols} />}
              <More>
                The numbers come from the weather station on the Perseverance rover, which stands in Jezero. The air is almost all carbon dioxide. &ldquo;Pa&rdquo; means pascal, the unit of air pressure.
              </More>
            </>
          )}
        </Card>

        <Card icon={<Sun size={16} aria-hidden />} title="Daylight" tag="NASA rover weather station">
          {latest?.daylightHours != null ? (
            <>
              <BigNumber value={`${one.format(latest.daylightHours)} hours`} unit="of sunlight" />
              <DayBar sunrise={latest.sunrise} sunset={latest.sunset} />
              <Body>
                The Sun rises at <b>{latest.sunrise}</b> and sets at <b>{latest.sunset}</b>, local time.
              </Body>
              <More>A day on Mars is called a &ldquo;sol&rdquo; and lasts 24 hours and 37 minutes. The times are from the same NASA reading as the weather.</More>
            </>
          ) : (
            <Body tone="gray">{loading ? 'Loading…' : 'No sunrise and sunset times available.'}</Body>
          )}
        </Card>

        <Card icon={<Radiation size={16} aria-hidden />} title="Radiation" tag="Curiosity rover, an estimate here">
          <BigNumber value={`${RADIATION_MSV_PER_DAY} mSv`} unit="per day on the surface" />
          <Body>
            One 8-hour spacewalk gives about <b>{two.format(spacewalkDose)} mSv</b>.
          </Body>
          <Body>The level is nearly the same everywhere in Jezero. Less time outside means less radiation.</Body>
          <More>
            Mars has almost no air and no magnetic field to stop cosmic rays. NASA&rsquo;s Curiosity rover measured this number in Gale Crater, which lies about as low as Jezero. Solar storms can raise it for a few hours and are not counted. The layer &ldquo;Cosmic radiation (estimate)&rdquo; shows where the planet gets more or less.
          </More>
          <Actions>
            <Button size="xs" variant="outline" colorPalette="brand" onClick={() => onOpenTool('layers')}>
              See the radiation layer
            </Button>
          </Actions>
        </Card>

        <Card icon={<Wind size={16} aria-hidden />} title="Wind and dust" tag="Partly known">
          <VStack align="stretch" gap="3">
            <Line
              tone={dust === undefined ? 'gray' : dust ? 'orange' : 'green'}
              title={dust === undefined ? 'Dust storm season: no data' : dust ? 'Dust storm season: yes' : 'Dust storm season: no'}
              text={latest ? 'A rule for the whole planet, from where Mars is in its year. It is not a forecast for Jezero.' : 'The season comes from NASA’s weather feed, which could not be read.'}
            />
            <Line tone="gray" title="Wind and dust in the air: not known" text="NASA’s public feed for Jezero has no wind and no dust numbers. We do not guess them." />
            <Line tone="orange" title="Loose sand on the ground: mapped" text="Feet and wheels sink in it. The Route tool counts how much of a walk crosses sand." />
          </VStack>
          <More>
            Dust storms are most common when Mars is between 180° and 360° of its way around the Sun.{latest ? ` At NASA’s newest reading it was at ${whole.format(latest.solarLongitude)}°.` : ''} The sand comes from the USGS rock map: it is the yellow colour in the &ldquo;Geologic units&rdquo; layer.
          </More>
        </Card>

        <Card icon={<Gauge size={16} aria-hidden />} title="The ground" tag="Facts about Mars">
          <SimpleGrid columns={2} gap="2.5">
            <Figure label="Gravity" value="3.71 m/s²" note="38% of Earth’s" />
            <Figure label="Crater floor" value="−2,600 m" note="about, below Mars’s zero level" />
          </SimpleGrid>
          <Body>You weigh much less than on Earth. The ground goes from flat crater floor to the steep front of the old river delta.</Body>
          <Actions>
            <Button size="xs" variant="outline" colorPalette="brand" onClick={() => onOpenTool('identify')}>
              <MapPin size={14} aria-hidden />
              Check one place
            </Button>
            <Button size="xs" variant="outline" colorPalette="brand" onClick={() => onOpenTool('route')}>
              <Route size={14} aria-hidden />
              Plan a walk
            </Button>
          </Actions>
        </Card>
      </VStack>
    </ToolCard>
  )
}

/** One of the three things in the top row: a label, the value on one line, the unit under it. */
function Quick({ icon, label, value, unit, divider, loading }: { icon: ReactNode; label: string; value: string; unit?: string; divider?: boolean; loading?: boolean }) {
  return (
    <Box px="3.5" py="3" minW="0" borderLeftWidth={divider ? '1px' : undefined} borderColor="gray.200">
      <HStack gap="1.5" color="gray.600">
        {icon}
        <Text fontSize="xs" fontWeight="600">
          {label}
        </Text>
      </HStack>
      {loading ? (
        <Spinner size="xs" mt="2" color="gray.500" />
      ) : (
        <>
          <Text mt="1" fontSize="md" fontWeight="700" color={value === 'No data' ? 'gray.500' : 'gray.900'} lineHeight="1.3" whiteSpace="nowrap" fontVariantNumeric="tabular-nums">
            {value}
          </Text>
          {unit && (
            <Text fontSize="2xs" color="gray.600" lineHeight="1.4">
              {unit}
            </Text>
          )}
        </>
      )}
    </Box>
  )
}

/** One line of "What it means for you": what to do, then why. */
function Advice({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <HStack as="li" align="flex-start" gap="3">
      <Flex flexShrink={0} align="center" justify="center" boxSize="8" borderRadius="full" bg="brand.50" color="brand.700">
        {icon}
      </Flex>
      <Box>
        <Text fontSize="sm" fontWeight="700" color="gray.900" lineHeight="1.4">
          {title}
        </Text>
        <Text fontSize="xs" color="gray.700" lineHeight="1.5">
          {text}
        </Text>
      </Box>
    </HStack>
  )
}

function Card({ icon, title, tag, children }: { icon: ReactNode; title: string; tag: string; children: ReactNode }) {
  return (
    <Box bg="white" borderWidth="1px" borderColor="gray.200" borderRadius="xl" px="4" py="3.5" shadow="xs">
      <Flex align="center" gap="2.5" mb="3">
        <Flex flexShrink={0} align="center" justify="center" boxSize="8" borderRadius="full" bg="brand.50" color="brand.700">
          {icon}
        </Flex>
        <Box flex="1" minW="0">
          <Text as="h3" fontSize="md" fontWeight="700" color="gray.900" lineHeight="1.3">
            {title}
          </Text>
          <Text fontSize="2xs" color="gray.500" lineHeight="1.4">
            Source: {tag}
          </Text>
        </Box>
      </Flex>
      {children}
    </Box>
  )
}

/** The one number a card is about. */
function BigNumber({ value, unit }: { value: string; unit: string }) {
  return (
    <HStack align="baseline" gap="2" mb="2.5" wrap="wrap">
      <Text fontSize="2xl" fontWeight="700" color="gray.900" lineHeight="1.2" whiteSpace="nowrap" fontVariantNumeric="tabular-nums">
        {value}
      </Text>
      <Text fontSize="sm" color="gray.600">
        {unit}
      </Text>
    </HStack>
  )
}

/** A sentence of a card: comfortable to read. */
function Body({ children, tone = 'dark' }: { children: ReactNode; tone?: 'dark' | 'gray' | 'red' }) {
  return (
    <Text fontSize="sm" color={tone === 'red' ? 'red.700' : tone === 'gray' ? 'gray.600' : 'gray.800'} lineHeight="1.55" mt="2.5" css={{ textWrap: 'pretty' }}>
      {children}
    </Text>
  )
}

function Actions({ children }: { children: ReactNode }) {
  return (
    <HStack gap="2" mt="3" wrap="wrap">
      {children}
    </HStack>
  )
}

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Box borderWidth="1px" borderColor="gray.200" borderRadius="lg" px="3" py="2.5" bg="gray.50">
      <Text fontSize="xs" color="gray.600" lineHeight="1.4">
        {label}
      </Text>
      <Text mt="0.5" fontSize="lg" fontWeight="700" color="gray.900" lineHeight="1.3" whiteSpace="nowrap" fontVariantNumeric="tabular-nums">
        {value}
      </Text>
      {note && (
        <Text fontSize="2xs" color="gray.500" lineHeight="1.4">
          {note}
        </Text>
      )}
    </Box>
  )
}

/** One statement with a coloured edge: green = fine, orange = take care, grey = not known. */
function Line({ tone, title, text }: { tone: 'green' | 'orange' | 'gray'; title: string; text: string }) {
  return (
    <Box pl="3" borderLeftWidth="4px" borderColor={tone === 'gray' ? 'gray.300' : `${tone}.400`}>
      <Text fontSize="sm" fontWeight="700" color="gray.900" lineHeight="1.4">
        {title}
      </Text>
      <Text fontSize="xs" color="gray.700" lineHeight="1.5" mt="0.5" css={{ textWrap: 'pretty' }}>
        {text}
      </Text>
    </Box>
  )
}

/** The longer explanation, closed until asked for. */
function More({ children }: { children: ReactNode }) {
  return (
    <Box asChild mt="3" pt="2.5" borderTopWidth="1px" borderColor="gray.100">
      <details>
        <Box asChild cursor="pointer" fontSize="xs" fontWeight="600" color="brand.600" _hover={{ textDecoration: 'underline' }}>
          <summary>What is this?</summary>
        </Box>
        <Text fontSize="xs" color="gray.700" mt="2" lineHeight="1.6" css={{ textWrap: 'pretty' }}>
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
      <Flex position="relative" h="18px" mt="1" fontSize="2xs" color="gray.500" fontVariantNumeric="tabular-nums">
        <Text position="absolute" left="0">
          00:00
        </Text>
        <Text position="absolute" left={`${from}%`} transform="translateX(-50%)" fontWeight="700" color="gray.800">
          {sunrise}
        </Text>
        <Text position="absolute" left={`${to}%`} transform="translateX(-50%)" fontWeight="700" color="gray.800">
          {sunset}
        </Text>
        <Text position="absolute" right="0">
          24:00
        </Text>
      </Flex>
    </Box>
  )
}

/**
 * The coldest and warmest air temperature of the last readings, one row per Mars day.
 * Every row has the same scale, so the bars can be compared: the left end of a bar is the
 * night, the right end is the day, and both numbers are written beside it.
 */
function TempChart({ sols }: { sols: WeatherSol[] }) {
  const shown = sols
    .filter((sol) => sol.minTempC !== null && sol.maxTempC !== null)
    .slice(-5)
    .reverse() // newest first
  if (shown.length < 2) return null
  // One scale for all rows, with a little room at both ends.
  const low = Math.floor((Math.min(...shown.map((sol) => sol.minTempC!)) - 4) / 10) * 10
  const high = Math.ceil((Math.max(...shown.map((sol) => sol.maxTempC!)) + 4) / 10) * 10
  const at = (temp: number) => ((temp - low) / (high - low)) * 100
  return (
    <Box mt="4">
      <Text fontSize="sm" fontWeight="700" color="gray.900">
        The last {shown.length} readings
      </Text>
      <HStack gap="4" mt="1" mb="2" fontSize="xs" color="gray.700">
        <HStack gap="1.5">
          <Box boxSize="10px" borderRadius="full" bg="#3f6fd8" aria-hidden />
          <Text>Coldest, at night</Text>
        </HStack>
        <HStack gap="1.5">
          <Box boxSize="10px" borderRadius="full" bg="#e8833a" aria-hidden />
          <Text>Warmest, by day</Text>
        </HStack>
      </HStack>
      <VStack as="ul" align="stretch" gap="2" listStyleType="none">
        {shown.map((sol, i) => (
          <Flex as="li" key={sol.sol} align="center" gap="3">
            <Box flexShrink={0} w="74px">
              <Text fontSize="xs" fontWeight="600" color="gray.800" lineHeight="1.3" fontVariantNumeric="tabular-nums">
                Day {sol.sol}
              </Text>
              {i === 0 && (
                <Text fontSize="2xs" color="gray.500" lineHeight="1.3">
                  newest
                </Text>
              )}
            </Box>
            <Text flexShrink={0} w="42px" textAlign="right" fontSize="sm" fontWeight="700" color="#2f57b0" fontVariantNumeric="tabular-nums">
              {whole.format(sol.minTempC!)}°
            </Text>
            {/* The bar: from the night temperature to the day temperature, on the shared scale. */}
            <Box flex="1" position="relative" h="10px" borderRadius="full" bg="gray.100" aria-hidden>
              <Box position="absolute" top="0" bottom="0" left={`${at(sol.minTempC!)}%`} w={`${at(sol.maxTempC!) - at(sol.minTempC!)}%`} borderRadius="full" bgGradient="to-r" gradientFrom="#3f6fd8" gradientTo="#e8833a" />
            </Box>
            <Text flexShrink={0} w="42px" fontSize="sm" fontWeight="700" color="#b85a17" fontVariantNumeric="tabular-nums">
              {whole.format(sol.maxTempC!)}°
            </Text>
          </Flex>
        ))}
      </VStack>
      <Text fontSize="2xs" color="gray.500" mt="2" lineHeight="1.4">
        Degrees Celsius. All bars use one scale, from {low}° to {high}°. &ldquo;Day&rdquo; is the Mars day of the mission.
      </Text>
    </Box>
  )
}
