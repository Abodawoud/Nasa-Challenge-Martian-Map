// The weather at Jezero Crater, from NASA's public feed of the Perseverance rover's weather
// station (MEDA). Read live, never stored. The feed gives, per Mars day (sol): the lowest and
// highest air temperature, the air pressure, sunrise and sunset, and the season.
//
// Honest limits, checked on 2026-11-15:
//   - the newest sol in the feed was sol 1133 (27 April 2024): NASA has not added newer ones,
//     so the dashboard always shows the date of the reading
//   - the feed has NO wind and NO dust numbers
//   - some sols have "--" instead of a number: those are skipped
const WEATHER_URL = 'https://mars.nasa.gov/rss/api/?feed=weather&category=mars2020&feedtype=json'

export interface WeatherSol {
  sol: number
  /** The Earth date of that sol, as "2024-04-27". */
  date: string
  /** Where Mars is on its way around the Sun, 0 to 360 degrees. It tells the season. */
  solarLongitude: number
  season: string
  minTempC: number | null
  maxTempC: number | null
  pressurePa: number | null
  /** Local time, "06:18". */
  sunrise: string
  sunset: string
  daylightHours: number | null
}

interface FeedSol {
  terrestrial_date?: string
  sol?: string | number
  ls?: string | number
  season?: string
  min_temp?: string | number
  max_temp?: string | number
  pressure?: string | number
  sunrise?: string
  sunset?: string
}

const toNumber = (value: unknown): number | null => {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(number) ? number : null
}

const toHours = (time: string | undefined): number | null => {
  const parts = time?.split(':').map(Number)
  if (!parts || parts.length < 2 || parts.some((part) => !Number.isFinite(part))) return null
  return parts[0] + parts[1] / 60 + (parts[2] ?? 0) / 3600
}

let pending: Promise<WeatherSol[]> | undefined

/** The sols of the feed, oldest first. Asked once per page. */
export function loadWeather(): Promise<WeatherSol[]> {
  pending ??= fetch(WEATHER_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`Weather feed: HTTP ${response.status}`)
      return response.json() as Promise<{ sols?: FeedSol[] }>
    })
    .then((feed) => {
      const sols = (feed.sols ?? [])
        .map((item): WeatherSol | null => {
          const sol = toNumber(item.sol)
          if (sol === null || !item.terrestrial_date) return null
          const rise = toHours(item.sunrise)
          const set = toHours(item.sunset)
          return {
            sol,
            date: item.terrestrial_date,
            solarLongitude: toNumber(item.ls) ?? 0,
            season: item.season ?? '',
            minTempC: toNumber(item.min_temp),
            maxTempC: toNumber(item.max_temp),
            pressurePa: toNumber(item.pressure),
            sunrise: (item.sunrise ?? '').slice(0, 5),
            sunset: (item.sunset ?? '').slice(0, 5),
            daylightHours: rise !== null && set !== null ? set - rise : null,
          }
        })
        .filter((item): item is WeatherSol => item !== null)
        .sort((a, b) => a.sol - b.sol)
      if (!sols.length) throw new Error('Weather feed: no sols')
      return sols
    })
    .catch((error) => {
      pending = undefined // a later try asks again
      throw error
    })
  return pending
}

/**
 * Dust storms on Mars are most common in the half of the year when the solar longitude is
 * between 180 and 360 degrees (spring and summer in the south, when Mars is nearest to the
 * Sun). A general rule about the planet, not a forecast for Jezero.
 */
export function inDustSeason(solarLongitude: number): boolean {
  return solarLongitude >= 180 && solarLongitude < 360
}

/** Air pressure at sea level on Earth, in pascal, to compare with. */
export const EARTH_PRESSURE_PA = 101_325
