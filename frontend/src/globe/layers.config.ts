// Every map layer is one entry here. The layer panel and the viewer are built from this list.
// Layer ids, formats and zoom levels were read from the services' capabilities on 2026-11-14.
// Order matters: later layers draw on top of earlier ones.

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
    // (wkid 104971), 512 px tiles, level 0 = 2 × 1 tiles from -180,90. CORS: *. Usable to level 13.
    // It makes everything around Jezero sharp, so the Jezero layers no longer look like a patch.
    kind: 'url-template',
    id: 'ctx-global',
    title: 'Mars CTX mosaic (global, ~5 m)',
    category: 'optical',
    url: 'https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/{z}/{y}/{x}',
    tileSize: 512,
    maximumLevel: 13,
    minimumZoomLevel: 7,
    defaultOpacity: 1,
    visible: true,
    source: 'NASA/JPL/MSSS/Caltech Murray Lab/Esri',
    tintToMars: true,
    greyLevels: [100, 168],
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
    // Hidden by default: HiRISE is many narrow strips taken in different light, so close up
    // they look like stripes of different brightness. Optional "Ultra-detail" layer later.
    visible: false,
    source: 'NASA/JPL-Caltech/University of Arizona/USGS, Mars Trek',
    tintToMars: true,
    greyLevels: [38, 150],
  },
]
