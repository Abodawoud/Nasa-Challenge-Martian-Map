// The units distances and areas are shown in. One setting for the whole app, kept in the
// browser's storage. Numbers are always worked out in metres. Only the text changes.
export type UnitSystem = 'metric' | 'imperial'

export const UNIT_SYSTEMS: Array<{ id: UnitSystem; title: string; note: string }> = [
  { id: 'metric', title: 'Metric', note: 'metres, kilometres, km²' },
  { id: 'imperial', title: 'Imperial', note: 'feet, miles, square miles' },
]

const STORAGE_KEY = 'martian-map-units'
const METRES_PER_FOOT = 0.3048
const METRES_PER_MILE = 1609.344

function read(): UnitSystem {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'imperial' ? 'imperial' : 'metric'
  } catch {
    return 'metric'
  }
}

let system: UnitSystem = read()
const listeners = new Set<() => void>()

export const unitStore = {
  get: () => system,
  set(next: UnitSystem) {
    if (next === system) return
    system = next
    try {
      localStorage.setItem(STORAGE_KEY, next)
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

const number = (digits: number) => new Intl.NumberFormat('en', { minimumFractionDigits: digits, maximumFractionDigits: digits })

/** "86.0 m", "1.24 km", "1,530 km" or "282 ft", "0.77 mi". */
export function formatDistance(metres: number): string {
  if (system === 'imperial') {
    const feet = metres / METRES_PER_FOOT
    if (feet < 1000) return `${number(0).format(feet)} ft`
    const miles = metres / METRES_PER_MILE
    return `${number(miles < 100 ? 2 : 0).format(miles)} mi`
  }
  if (metres < 1000) return `${number(metres < 100 ? 1 : 0).format(metres)} m`
  const km = metres / 1000
  return `${number(km < 100 ? 2 : 0).format(km)} km`
}

/** "8,400 m²", "1.25 km²" or "90,400 ft²", "0.48 mi²". */
export function formatArea(squareMetres: number): string {
  if (system === 'imperial') {
    const squareMiles = squareMetres / METRES_PER_MILE ** 2
    if (squareMiles < 0.01) return `${number(0).format(squareMetres / METRES_PER_FOOT ** 2)} ft²`
    return `${number(squareMiles < 100 ? 2 : 0).format(squareMiles)} mi²`
  }
  if (squareMetres < 100_000) return `${number(0).format(squareMetres)} m²`
  const squareKm = squareMetres / 1_000_000
  return `${number(squareKm < 100 ? 2 : 0).format(squareKm)} km²`
}
