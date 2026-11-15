// The units distances and areas are shown in. One setting for the whole app, kept in the
// browser's storage. Numbers are always worked out in metres. Only the text changes.
//
// A unit can be fixed ("kilometres": every distance in km) or automatic ("metric": metres
// for short distances, kilometres for long ones).

interface Unit {
  id: string
  /** Shown in the dropdown, and what the search looks through. */
  label: string
  /** Turn metres (or square metres) into text. */
  format: (value: number) => string
}

const digits = (count: number) => new Intl.NumberFormat('en', { minimumFractionDigits: count, maximumFractionDigits: count })
/** A number with a sensible count of decimals for its size. */
const nice = (value: number) => digits(value >= 100 ? 0 : value >= 10 ? 1 : value >= 1 ? 2 : 3).format(value)

const FOOT = 0.3048
const YARD = 0.9144
const MILE = 1609.344
const NAUTICAL_MILE = 1852

export const DISTANCE_UNITS: Unit[] = [
  { id: 'auto-metric', label: 'Automatic: metres and kilometres', format: (m) => (m < 1000 ? `${digits(m < 100 ? 1 : 0).format(m)} m` : `${digits(m < 100_000 ? 2 : 0).format(m / 1000)} km`) },
  { id: 'm', label: 'Metres (m)', format: (m) => `${digits(m < 100 ? 1 : 0).format(m)} m` },
  { id: 'km', label: 'Kilometres (km)', format: (m) => `${nice(m / 1000)} km` },
  { id: 'auto-imperial', label: 'Automatic: feet and miles', format: (m) => (m / FOOT < 1000 ? `${digits(0).format(m / FOOT)} ft` : `${digits(m / MILE < 100 ? 2 : 0).format(m / MILE)} mi`) },
  { id: 'ft', label: 'Feet (ft)', format: (m) => `${digits(0).format(m / FOOT)} ft` },
  { id: 'yd', label: 'Yards (yd)', format: (m) => `${digits(0).format(m / YARD)} yd` },
  { id: 'mi', label: 'Miles (mi)', format: (m) => `${nice(m / MILE)} mi` },
  { id: 'nmi', label: 'Nautical miles (nmi)', format: (m) => `${nice(m / NAUTICAL_MILE)} nmi` },
]

export const AREA_UNITS: Unit[] = [
  { id: 'auto-metric', label: 'Automatic: m² and km²', format: (a) => (a < 100_000 ? `${digits(0).format(a)} m²` : `${digits(a < 1e8 ? 2 : 0).format(a / 1e6)} km²`) },
  { id: 'm2', label: 'Square metres (m²)', format: (a) => `${digits(0).format(a)} m²` },
  { id: 'ha', label: 'Hectares (ha)', format: (a) => `${nice(a / 10_000)} ha` },
  { id: 'km2', label: 'Square kilometres (km²)', format: (a) => `${nice(a / 1e6)} km²` },
  { id: 'auto-imperial', label: 'Automatic: ft² and mi²', format: (a) => (a / MILE ** 2 < 0.01 ? `${digits(0).format(a / FOOT ** 2)} ft²` : `${digits(a / MILE ** 2 < 100 ? 2 : 0).format(a / MILE ** 2)} mi²`) },
  { id: 'ft2', label: 'Square feet (ft²)', format: (a) => `${digits(0).format(a / FOOT ** 2)} ft²` },
  { id: 'ac', label: 'Acres (ac)', format: (a) => `${nice(a / 4046.8564224)} ac` },
  { id: 'mi2', label: 'Square miles (mi²)', format: (a) => `${nice(a / MILE ** 2)} mi²` },
]

export interface UnitChoice {
  distance: string
  area: string
}

const STORAGE_KEY = 'martian-map-unit-choice'
const DEFAULT: UnitChoice = { distance: 'auto-metric', area: 'auto-metric' }

function read(): UnitChoice {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<UnitChoice>
    return {
      distance: DISTANCE_UNITS.some((unit) => unit.id === saved.distance) ? saved.distance! : DEFAULT.distance,
      area: AREA_UNITS.some((unit) => unit.id === saved.area) ? saved.area! : DEFAULT.area,
    }
  } catch {
    return DEFAULT
  }
}

let choice: UnitChoice = read()
const listeners = new Set<() => void>()

export const unitStore = {
  get: () => choice,
  set(change: Partial<UnitChoice>) {
    choice = { ...choice, ...change }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(choice))
    } catch {
      // Storage blocked: the choice still holds until the page is closed.
    }
    for (const listener of listeners) listener()
  },
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}

/** A distance in metres as text, in the chosen unit. */
export function formatDistance(metres: number): string {
  return (DISTANCE_UNITS.find((unit) => unit.id === choice.distance) ?? DISTANCE_UNITS[0]).format(metres)
}

/** An area in square metres as text, in the chosen unit. */
export function formatArea(squareMetres: number): string {
  return (AREA_UNITS.find((unit) => unit.id === choice.area) ?? AREA_UNITS[0]).format(squareMetres)
}
