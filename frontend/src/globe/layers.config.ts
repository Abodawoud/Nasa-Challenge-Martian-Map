// Every map layer is one entry here. The layer panel and the viewer are built from this list.
// Layer ids, formats and zoom levels were read from Trek's WMTSCapabilities.xml on 2026-11-14.

export type LayerCategory = 'optical' | 'topographic' | 'thermal' | 'spectral' | 'vector'

export interface TrekImageryLayer {
  id: string
  title: string
  category: LayerCategory
  /** Trek layer id, as in https://trek.nasa.gov/tiles/Mars/EQ/<layerId>/1.0.0/WMTSCapabilities.xml */
  layerId: string
  ext: 'jpg' | 'png'
  maximumLevel: number
  /** [west, south, east, north] in degrees. Omit for global layers. */
  bounds?: [number, number, number, number]
  defaultOpacity: number
  visible: boolean
  source: string
  /** Recolour a black-and-white layer to Mars colours (visual only, see tint.ts). */
  tintToMars?: boolean
}

export const TREK_TILE_ROOT = 'https://trek.nasa.gov/tiles/Mars/EQ'

export const IMAGERY_LAYERS: TrekImageryLayer[] = [
  {
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
    id: 'ctx-jezero',
    title: 'Jezero CTX mosaic (6 m)',
    category: 'optical',
    layerId: 'JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0',
    ext: 'png',
    maximumLevel: 13,
    bounds: [77.1604655, 18.2110274, 77.6991776, 18.7211945],
    defaultOpacity: 1,
    visible: true,
    source: 'NASA/JPL-Caltech/MSSS/USGS, Mars Trek',
    tintToMars: true,
  },
  {
    id: 'hirise-jezero',
    title: 'Jezero HiRISE mosaic (25 cm)',
    category: 'optical',
    layerId: 'JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd',
    ext: 'png',
    maximumLevel: 17,
    bounds: [77.2229331, 18.3067994, 77.583964, 18.669315],
    defaultOpacity: 1,
    visible: true,
    source: 'NASA/JPL-Caltech/University of Arizona/USGS, Mars Trek',
    tintToMars: true,
  },
]
