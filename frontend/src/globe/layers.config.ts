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

export type LayerCategory = 'optical' | 'topographic' | 'thermal' | 'spectral' | 'vector'

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
]

/**
 * One row of the Layers panel. A row can switch several imagery layers together (the two CTX
 * mosaics are one "photo layer" for the user), or the rover path.
 */
interface PanelBase {
  id: string
  title: string
  category: LayerCategory
  /** One short line: what the layer shows. */
  note: string
  /** How to read the colours, shown while the layer is on. */
  legend?: string
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
export type PanelLayer = ImageryPanelLayer | RoverPathPanelLayer

export const PANEL_LAYERS: PanelLayer[] = [
  {
    kind: 'rover-path',
    id: 'rover-path',
    title: 'Perseverance path',
    category: 'vector',
    note: 'Every drive of the rover since landing in 2021.',
    source: 'NASA/JPL-Caltech, Mars 2020 mission map',
    defaultOn: false,
    defaultOpacity: 1,
    adjustable: true,
  },
  {
    kind: 'imagery',
    id: 'themis-night',
    title: 'Night heat',
    category: 'thermal',
    note: 'How warm the ground stays at night, 100 m per pixel.',
    legend: 'Bright = warm at night (rock). Dark = cold (dust and sand).',
    source: 'THEMIS, NASA/JPL-Caltech/ASU',
    imageryIds: ['themis-night'],
    defaultOn: false,
    defaultOpacity: 0.6,
    adjustable: true,
  },
  {
    kind: 'imagery',
    id: 'hirise',
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
