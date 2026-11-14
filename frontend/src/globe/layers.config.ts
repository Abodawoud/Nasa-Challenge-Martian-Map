import { RADIATION_GRADIENT } from './radiation'

// Every map layer is one entry here. The layer panel and the viewer are built from this list.
// Layer ids, formats and zoom levels were read from the services' capabilities on 2026-11-14.
// Order matters: later layers draw on top of earlier ones.
//
// Display rule (decided 2026-11-14 after testing): ONE seamless source per zoom range.
//   far      Viking colour mosaic
//   near     Jezero region CTX mosaic, aligned (elsewhere: global CTX)
//   closest  HiRISE, only from terrain level 14
// Stacking several mosaics at the same zoom made visible patches, because every mosaic has
// its own brightness. The raw aligned CTX mosaic alone is seamless.

export type LayerCategory = 'optical' | 'topographic' | 'thermal' | 'spectral' | 'vector' | 'geology' | 'radiation'

interface BaseImageryLayer {
  id: string
  title: string
  category: LayerCategory
  maximumLevel: number
  /** Show the layer only from this terrain zoom level on (hides it on the far globe view). */
  minimumZoomLevel?: number
  /** [west, south, east, north] in degrees. Omit for global layers. */
  bounds?: [number, number, number, number]
  defaultOpacity: number
  visible: boolean
  source: string
  /**
   * Areas [west, south, east, north] where another layer on top fully covers this one.
   * Tiles that lie completely inside are not downloaded: nobody could see them.
   */
  hiddenUnder?: Array<[number, number, number, number]>
  /** Recolour a black-and-white layer to Mars colours (visual only, see tint.ts). */
  tintToMars?: boolean
  /** Grey range of this source, stretched before colouring (see tint.ts). */
  greyLevels?: [number, number]
  /** Recolour a grey elevation layer as the radiation estimate (see radiation.ts). */
  radiationRamp?: boolean
}

/** A NASA Mars Trek WMTS layer: https://trek.nasa.gov/tiles/Mars/EQ/<layerId>/1.0.0/WMTSCapabilities.xml */
export interface TrekWmtsLayer extends BaseImageryLayer {
  kind: 'trek-wmts'
  layerId: string
  ext: 'jpg' | 'png'
}

/** A tile service addressed by a URL template with {z}/{y}/{x}, on the same Mars lat/lon grid. */
export interface UrlTemplateLayer extends BaseImageryLayer {
  kind: 'url-template'
  url: string
  tileSize: 256 | 512
}

export type ImageryLayerConfig = TrekWmtsLayer | UrlTemplateLayer

export const TREK_TILE_ROOT = 'https://trek.nasa.gov/tiles/Mars/EQ'

export const IMAGERY_LAYERS: ImageryLayerConfig[] = [
  {
    kind: 'trek-wmts',
    id: 'viking-color',
    title: 'Mars colour mosaic (Viking, 232 m)',
    category: 'optical',
    layerId: 'Mars_Viking_MDIM21_ClrMosaic_global_232m',
    ext: 'jpg',
    maximumLevel: 7,
    defaultOpacity: 1,
    visible: true,
    source: 'NASA/JPL-Caltech/USGS, Mars Trek',
  },
  {
    // Global CTX mosaic (Caltech Murray Lab), served by Esri "OnMars". Same Mars 2000 sphere
    // (wkid 104971), 512 px tiles, level 0 = 2 × 1 tiles from -180,90. CORS: *.
    // Deepest level is 12 (checked 2026-11-14: level 13 answers HTTP 400, which filled the
    // console with "Failed to obtain image tile" and kept the map status on "Loading").
    // It makes everything around Jezero sharp, so the Jezero layers no longer look like a patch.
    kind: 'url-template',
    id: 'ctx-global',
    title: 'Mars CTX mosaic (global, ~5 m)',
    category: 'optical',
    url: 'https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/{z}/{y}/{x}',
    tileSize: 512,
    maximumLevel: 12,
    minimumZoomLevel: 7,
    defaultOpacity: 1,
    visible: true,
    source: 'NASA/JPL/MSSS/Caltech Murray Lab/Esri',
    // The aligned Jezero mosaic (next layer) covers these areas completely. Measured on
    // 2026-11-14 from its level 8 tiles: full coverage except one tile south-east of the
    // crater (77.34-78.05 E, 17.58-18.28 N), which has gaps and is left out here.
    // Near Jezero this layer was a third of all tile downloads, for pixels nobody sees.
    hiddenUnder: [
      [75.25, 18.29, 78.74, 18.97],
      [75.25, 16.18, 78.74, 17.57],
      [75.25, 17.58, 77.33, 18.28],
      [78.06, 17.58, 78.74, 18.28],
    ],
    tintToMars: true,
    greyLevels: [100, 168],
  },
  {
    // Block-adjusted CTX mosaic: all strips aligned to each other, so craters are not cut
    // where two strips meet (the global CTX above is "uncontrolled" and can shift at seams).
    // Covers all of Jezero and its surroundings. Levels 0 to 12, png.
    kind: 'trek-wmts',
    id: 'ctx-jezero-region',
    title: 'Jezero region CTX mosaic, aligned (~6 m)',
    category: 'optical',
    layerId: 'Jezero_CTX_BlockAdj_dd',
    ext: 'png',
    maximumLevel: 12,
    bounds: [75.1537692, 15.9058484, 78.8717121, 19.4453003],
    defaultOpacity: 1,
    visible: true,
    source: 'NASA/JPL-Caltech/MSSS/USGS, Mars Trek',
    tintToMars: true,
    greyLevels: [40, 200],
  },
  {
    kind: 'trek-wmts',
    id: 'ctx-jezero',
    title: 'Jezero CTX mosaic, controlled (6 m)',
    category: 'optical',
    layerId: 'JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0',
    ext: 'png',
    maximumLevel: 13,
    bounds: [77.1604655, 18.2110274, 77.6991776, 18.7211945],
    defaultOpacity: 1,
    // Hidden by default: one bright source image makes a pale rectangle next to the global
    // CTX. The global CTX covers the same area evenly. Kept for the layer panel.
    visible: false,
    source: 'NASA/JPL-Caltech/MSSS/USGS, Mars Trek',
    tintToMars: true,
    greyLevels: [96, 168],
  },
  {
    kind: 'trek-wmts',
    id: 'hirise-jezero',
    title: 'Jezero HiRISE mosaic (25 cm)',
    category: 'optical',
    layerId: 'JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd',
    ext: 'png',
    maximumLevel: 17,
    bounds: [77.2229331, 18.3067994, 77.583964, 18.669315],
    defaultOpacity: 1,
    // HiRISE is many narrow strips taken in different light. From far away they look like
    // stripes, so it only appears when the camera is very close (terrain level 14 and deeper,
    // roughly below 3 km above the ground). There it adds real 25 cm detail: rocks and ripples.
    minimumZoomLevel: 14,
    visible: true,
    source: 'NASA/JPL-Caltech/University of Arizona/USGS, Mars Trek',
    tintToMars: true,
    greyLevels: [38, 150],
  },
  {
    // Night-time heat (THEMIS infrared camera on Mars Odyssey), global between 65 S and 65 N.
    // Checked 2026-11-15: png, levels 0 to 9 answer over Jezero. Kept in its own grey: it is
    // a measurement picture, so it is not recoloured.
    kind: 'trek-wmts',
    id: 'themis-night',
    title: 'Night heat (THEMIS, 100 m)',
    category: 'thermal',
    layerId: 'THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018',
    ext: 'png',
    maximumLevel: 9,
    bounds: [-180, -65, 180, 65],
    defaultOpacity: 0.6,
    visible: false,
    source: 'NASA/JPL-Caltech/Arizona State University, Mars Trek',
  },
  {
    // The MOLA elevation map as grey tiles, recoloured as an ESTIMATE of cosmic radiation
    // (radiation.ts explains the method and its limits). Checked 2026-11-15: png, levels 0
    // to 5 only (level 6 answers 404), about 1.3 km per pixel. Coarse on purpose: the air
    // above a place changes slowly, so the estimate does too.
    kind: 'trek-wmts',
    id: 'radiation-estimate',
    title: 'Cosmic radiation, estimate from ground height',
    category: 'radiation',
    layerId: 'mola128_mola64_merge_90Nto90S_SimpleC_clon0',
    ext: 'png',
    maximumLevel: 5,
    defaultOpacity: 0.6,
    visible: false,
    source: 'Elevation: NASA/GSFC MOLA, Mars Trek. Method: NASA/JPL/JSC (PIA03480)',
    radiationRamp: true,
  },
]

/** How one kind of feature of the geologic map is drawn. Widths and sizes are tile pixels. */
export interface GeologyStyle {
  fill?: string
  stroke?: string
  width?: number
  dash?: number[]
  /** Points: radius of the dot. */
  radius?: number
  /** A pale edge under the line, so dark lines stay readable on dark ground. */
  halo?: boolean
}

/** One layer of the USGS geologic map service (see geologyLayer.ts). */
export interface GeologySource {
  /** Layer number in the feature service. */
  serviceLayer: number
  geometry: 'polygon' | 'line' | 'point'
  /** The attribute that decides the style. Omit when every feature looks the same. */
  field?: string
  /** Style per value of `field`. A value with no style and no fallback is not drawn. */
  styles: Record<string, GeologyStyle>
  fallback?: GeologyStyle
  /** For the panel: "1,308 areas". */
  countWord: string
}

export interface LegendItem {
  color: string
  label: string
  /** Draw the sample as a line, not a square. */
  line?: boolean
  /** Draw the sample as a round marker. */
  dot?: boolean
  /** One plain sentence: what this thing is. Shown in the legend. */
  hint?: string
  dashed?: boolean
}

/**
 * One row of the Layers panel. A row can switch several imagery layers together (the two CTX
 * mosaics are one "photo layer" for the user), the rover path, or one layer of the geologic map.
 */
interface PanelBase {
  id: string
  /** id of a PANEL_GROUPS entry. */
  group: string
  title: string
  category: LayerCategory
  /** One short line: what the layer shows. */
  note: string
  /** How to read the layer, shown while it is on. */
  legend?: string
  legendItems?: LegendItem[]
  /** A colour bar with a word at each end. `css` is a CSS gradient. */
  legendScale?: { css: string; low: string; high: string }
  /** Shown in an amber box while the layer is on: what the layer must not be taken for. */
  caution?: string
  source: string
  defaultOn: boolean
  defaultOpacity: number
  /** Show a transparency slider. */
  adjustable: boolean
}
export interface ImageryPanelLayer extends PanelBase {
  kind: 'imagery'
  /** ids from IMAGERY_LAYERS above. */
  imageryIds: string[]
}
export interface RoverPathPanelLayer extends PanelBase {
  kind: 'rover-path'
}
export interface GeologyPanelLayer extends PanelBase {
  kind: 'geology'
  geology: GeologySource
}
export type PanelLayer = ImageryPanelLayer | RoverPathPanelLayer | GeologyPanelLayer

export const PANEL_GROUPS: Array<{ id: string; title: string; note?: string; startClosed?: boolean }> = [
  { id: 'mission', title: 'Mission' },
  { id: 'measure', title: 'Radiation and heat' },
  {
    id: 'geology',
    title: 'Geologic map of Jezero',
    note: 'What the ground is made of, mapped by USGS scientists (Sun and Stack, 2020, map SIM 3464).',
    startClosed: true,
  },
  { id: 'photos', title: 'Photos', startClosed: true },
]

const USGS_MAP = 'USGS SIM 3464, Sun and Stack (2020)'
const BLACK = '#111111'
const DASH = [7, 6]
const DASH_DOT = [10, 5, 2, 5]

/**
 * The colours of the 14 rock units, exactly as the USGS web map draws them (read from the
 * service's own drawing rules on 2026-11-15). The key is the service's `unit` number.
 */
// The last text of each unit is a short, plain version of the USGS interpretation of that
// unit (the service's `Unit_Interpretation` field, read 2026-11-15). Where USGS is not sure,
// it says "probably".
const ROCK_UNITS: Array<[string, string, string, string]> = [
  ['0', '#004deb', 'Jezero fan 2', 'River delta: mud and sand that a river dropped into a lake. The younger part.'],
  ['1', '#0099ff', 'Jezero fan 1', 'An older, worn delta or lake deposit.'],
  ['2', '#eb4d80', 'Jezero floor', 'Probably volcanic ash or dust that fell from the air and covered the crater floor.'],
  ['3', '#de4d00', 'Lower etched', 'Probably volcanic ash, later changed by lake water.'],
  ['4', '#0000eb', 'Nili Planum fan', 'Sand and gravel left by the last river flows.'],
  ['5', '#b300eb', 'Nili Planum 2', 'Probably volcanic ash or dust that fell from the air, also on the crater rim.'],
  ['6', '#ebcc99', 'Nili Planum 1', 'Very old crust: the rock that the Jezero impact hit.'],
  ['7', '#ffff00', 'Eolian bedforms (wind ripples)', 'Loose sand shaped into ripples by the wind. The youngest unit.'],
  ['8', '#ccde99', 'Smooth, undivided', 'Loose material: from slides, ash or wind, or sand and pebbles left behind.'],
  ['9', '#ebb3ff', 'Rugged bright', 'Hard leftover pieces of a layer that was once wider. Its origin is not known.'],
  ['10', '#ffb300', 'Upper etched', 'Probably volcanic ash that covers older rock.'],
  ['11', '#b3804d', 'Crater rim', 'Old rock pushed up by an impact.'],
  ['12', '#669900', 'Crater ejecta', 'Rock and soil thrown out by an impact.'],
  ['13', '#ebeb66', 'Crater interior', 'Fallen blocks or other deposits inside two small craters.'],
]

// Order matters: this is also the drawing order, first entry on top (see layerControl.ts).
export const PANEL_LAYERS: PanelLayer[] = [
  {
    kind: 'rover-path',
    id: 'rover-path',
    group: 'mission',
    title: 'Perseverance path',
    category: 'vector',
    note: 'Every drive of the rover since landing in 2021.',
    legendItems: [
      { color: '#ffffff', label: 'Path the rover drove', line: true, hint: 'Real drives, from NASA mission data.' },
      { color: '#ffffff', label: 'Where the rover was last', dot: true },
    ],
    source: 'NASA/JPL-Caltech, Mars 2020 mission map',
    defaultOn: false,
    defaultOpacity: 1,
    adjustable: true,
  },
  {
    kind: 'geology',
    id: 'geo-landing-ellipse',
    group: 'mission',
    title: 'Landing ellipse',
    category: 'geology',
    note: 'The area the rover was planned to land in.',
    legendItems: [{ color: '#ffffff', label: 'Planned landing area', line: true, hint: 'The rover was expected to touch down somewhere inside this line.' }],
    source: USGS_MAP,
    geology: { serviceLayer: 2, geometry: 'polygon', styles: {}, fallback: { stroke: '#ffffff', width: 3 }, countWord: 'outline' },
    defaultOn: false,
    defaultOpacity: 1,
    adjustable: false,
  },
  {
    kind: 'geology',
    id: 'geo-points',
    group: 'geology',
    title: 'Location features',
    category: 'geology',
    note: 'Small craters and blocks of broken old rock.',
    legendItems: [
      { color: BLACK, label: 'Crater, 200 to 500 m', dot: true, hint: 'A crater too small to draw as an area.' },
      { color: '#ff0000', label: 'Megabreccia (broken old rock)', dot: true, hint: 'Big blocks of very old crust, broken by impacts.' },
    ],
    source: USGS_MAP,
    geology: {
      serviceLayer: 4,
      geometry: 'point',
      field: 'TYPE',
      styles: {
        'small crater': { fill: BLACK, stroke: '#ffffff', width: 1.5, radius: 4 },
        megabreccia: { fill: '#ff0000', stroke: '#ffffff', width: 1.5, radius: 4 },
      },
      countWord: 'points',
    },
    defaultOn: false,
    defaultOpacity: 1,
    adjustable: false,
  },
  {
    kind: 'geology',
    id: 'geo-sections',
    group: 'geology',
    title: 'Cross sections',
    category: 'geology',
    note: 'The two lines along which the map shows a cut through the ground.',
    legendItems: [{ color: BLACK, label: 'Cross section line', line: true, hint: 'The USGS map shows a cut through the ground along this line.' }],
    source: USGS_MAP,
    geology: { serviceLayer: 3, geometry: 'line', styles: {}, fallback: { stroke: BLACK, width: 2.5, halo: true }, countWord: 'lines' },
    defaultOn: false,
    defaultOpacity: 1,
    adjustable: false,
  },
  {
    kind: 'geology',
    id: 'geo-linear',
    group: 'geology',
    title: 'Linear features',
    category: 'geology',
    note: 'Old river channels, crater rims, ridges and the fronts of the delta.',
    legendItems: [
      { color: '#005ce6', label: 'River channel', line: true, dashed: true, hint: 'Where water once flowed.' },
      { color: '#00c5ff', label: 'Delta lobe front', line: true, dashed: true, hint: 'The outer edge of a tongue of the river delta.' },
      { color: BLACK, label: 'Crater rim crest', line: true, hint: 'The top line of a crater wall.' },
      { color: BLACK, label: 'Lineament, buried crater', line: true, dashed: true, hint: 'A straight feature in the ground, or the rim of a crater that is now covered.' },
    ],
    source: USGS_MAP,
    geology: {
      serviceLayer: 6,
      geometry: 'line',
      field: 'TYPE',
      styles: {
        'channel (fluvial)': { stroke: '#005ce6', width: 2.5, dash: DASH_DOT, halo: true },
        'delta lobe front': { stroke: '#00c5ff', width: 2.5, dash: DASH, halo: true },
        'crest of crater rim': { stroke: BLACK, width: 2, halo: true },
        'crest of buried crater': { stroke: BLACK, width: 2, dash: DASH_DOT, halo: true },
        lineament: { stroke: BLACK, width: 2.5, dash: DASH, halo: true },
        'ridge crest (type 1), certain': { stroke: BLACK, width: 3.5, halo: true },
      },
      fallback: { stroke: BLACK, width: 2, halo: true },
      countWord: 'lines',
    },
    defaultOn: false,
    defaultOpacity: 1,
    adjustable: false,
  },
  {
    kind: 'geology',
    id: 'geo-contacts',
    group: 'geology',
    title: 'Geologic contacts',
    category: 'geology',
    note: 'The lines where one rock unit meets another.',
    legendItems: [
      { color: BLACK, label: 'Certain', line: true, hint: 'The border between two rock units is clearly seen.' },
      { color: BLACK, label: 'Approximate, inferred or hidden', line: true, dashed: true, hint: 'The border is not clearly seen: its place is a best estimate.' },
    ],
    source: USGS_MAP,
    geology: {
      serviceLayer: 5,
      geometry: 'line',
      field: 'TYPE',
      styles: {
        boundary: { stroke: BLACK, width: 2.4 },
        certain: { stroke: BLACK, width: 1.5 },
        approximate: { stroke: BLACK, width: 1.5, dash: DASH },
        concealed: { stroke: BLACK, width: 1.5, dash: DASH },
        inferred: { stroke: BLACK, width: 1.5, dash: DASH },
        'generic contact 1': { stroke: '#8f5853', width: 2 },
        'generic contact 2': { stroke: '#5ced5f', width: 2 },
        // "gradational" has no line on the USGS map either: it is left out.
      },
      countWord: 'lines',
    },
    defaultOn: false,
    defaultOpacity: 1,
    adjustable: false,
  },
  {
    kind: 'geology',
    id: 'geo-surface',
    group: 'geology',
    title: 'Surface features',
    category: 'geology',
    note: 'Ridged ground and dark material lying on top of the rock.',
    legendItems: [
      { color: 'rgba(0,0,0,0.35)', label: 'Ridged ground', hint: 'Ground covered with many small ridges.' },
      { color: 'rgba(20,20,20,0.6)', label: 'Dark mantling material', hint: 'A thin dark cover lying on top of the rock.' },
    ],
    source: USGS_MAP,
    geology: {
      serviceLayer: 7,
      geometry: 'polygon',
      field: 'TYPE',
      styles: {
        ridged: { fill: 'rgba(0,0,0,0.28)', stroke: BLACK, width: 1, dash: [3, 4] },
        'dark-colored mantling material': { fill: 'rgba(20,20,20,0.5)' },
      },
      fallback: { fill: 'rgba(0,0,0,0.28)' },
      countWord: 'areas',
    },
    defaultOn: false,
    defaultOpacity: 0.8,
    adjustable: true,
  },
  {
    kind: 'geology',
    id: 'geo-units',
    group: 'geology',
    title: 'Geologic units',
    category: 'geology',
    note: 'The 14 kinds of rock and ground, each in its own colour.',
    legendItems: ROCK_UNITS.map(([, color, label, hint]) => ({ color, label, hint })),
    source: USGS_MAP,
    geology: {
      serviceLayer: 8,
      geometry: 'polygon',
      field: 'unit',
      styles: Object.fromEntries(ROCK_UNITS.map(([unit, color]) => [unit, { fill: color }])),
      countWord: 'areas',
    },
    defaultOn: false,
    defaultOpacity: 0.55,
    adjustable: true,
  },
  {
    kind: 'geology',
    id: 'geo-boundary',
    group: 'geology',
    title: 'Map boundary',
    category: 'geology',
    note: 'The edge of the area the geologic map covers.',
    legendItems: [{ color: BLACK, label: 'Edge of the geologic map', line: true, hint: 'Outside this line the USGS map has no data.' }],
    source: USGS_MAP,
    geology: { serviceLayer: 0, geometry: 'polygon', styles: {}, fallback: { stroke: BLACK, width: 3, halo: true }, countWord: 'outline' },
    defaultOn: false,
    defaultOpacity: 1,
    adjustable: false,
  },
  {
    kind: 'imagery',
    id: 'radiation',
    group: 'measure',
    title: 'Cosmic radiation (estimate)',
    category: 'radiation',
    note: 'Where cosmic rays reach the ground more, and where less.',
    legend: 'Low ground has more air above it, so less radiation reaches it. High ground gets more.',
    legendScale: { css: RADIATION_GRADIENT, low: 'Less (low ground)', high: 'More (high ground)' },
    caution:
      'An estimate, not a measurement. It follows NASA\'s 2002 map: about 10 rem per year in the lowest places, about 20 on the highest. It does not show solar storms or shelter from cliffs.',
    source: 'Our estimate from NASA MOLA elevation, method of NASA/JPL/JSC map PIA03480',
    imageryIds: ['radiation-estimate'],
    defaultOn: false,
    defaultOpacity: 0.6,
    adjustable: true,
  },
  {
    kind: 'imagery',
    id: 'themis-night',
    group: 'measure',
    title: 'Night heat',
    category: 'thermal',
    note: 'How warm the ground stays at night, 100 m per pixel.',
    legend: 'Bright = warm at night (rock). Dark = cold (dust and sand).',
    legendScale: { css: 'linear-gradient(90deg, #111111, #ffffff)', low: 'Cold (dust, sand)', high: 'Warm (rock)' },
    source: 'THEMIS, NASA/JPL-Caltech/ASU',
    imageryIds: ['themis-night'],
    defaultOn: false,
    defaultOpacity: 0.6,
    adjustable: true,
  },
  {
    kind: 'imagery',
    id: 'hirise',
    group: 'photos',
    title: 'Ultra-detail photos',
    category: 'optical',
    note: 'HiRISE, 25 cm per pixel. Seen only very close to the ground, near the landing site.',
    source: 'NASA/JPL-Caltech/University of Arizona',
    imageryIds: ['hirise-jezero'],
    defaultOn: true,
    defaultOpacity: 1,
    adjustable: false,
  },
  {
    kind: 'imagery',
    id: 'ctx',
    group: 'photos',
    title: 'Detail photos',
    category: 'optical',
    note: 'CTX, about 5 m per pixel. Without it, only the colour map of the whole planet is left.',
    source: 'NASA/JPL-Caltech/MSSS, Caltech Murray Lab, Esri',
    imageryIds: ['ctx-global', 'ctx-jezero-region'],
    defaultOn: true,
    defaultOpacity: 1,
    adjustable: false,
  },
]
