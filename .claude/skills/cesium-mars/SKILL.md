---
name: cesium-mars
description: Verified facts and rules for building this project's Mars map with CesiumJS - the Mars sphere, NASA Trek WMTS imagery, Trek terrain, 2D/2.5D/3D scene modes, drawing routes with explicit heights, the layer config, and the Jezero DEM. Load before writing or changing ANY code that touches Cesium, map layers, coordinates, terrain or routes.
---

# Cesium on Mars (this project)

Everything here was checked live on 2026-11-14 unless marked ⚠️. The plan and the reasons are in
`README.md` (sections 4 to 8). Do not change a rule here without updating the README decision.

## 1. Rules that must never break

1. **One Cesium `Viewer` for the whole app.** No second map engine (no MapLibre, deck.gl, Leaflet,
   R3F map). React only renders panels around it.
2. **Mars is a sphere, radius 3,396,190 m.** Not `Cesium.Ellipsoid.MARS` (that one is flattened
   at the poles, 3396190 × 3376200, and puts Jezero ~10 km off against Trek data).
3. **Set the ellipsoid before creating anything.** Objects made before keep WGS84.
4. **Routes are drawn with explicit heights** from our DEM (`Cartesian3.fromDegrees(lon, lat, h)`),
   never `clampToGround` / `HeightReference.CLAMP_TO_GROUND` (unreliable off Earth and in 2D).
5. **No Cesium ion.** No token, no `Ion.defaultAccessToken`, no `createWorldTerrain`, no Bing
   imagery, no Cesium Mars 3D Tiles (asset 3644333 does not support 2D).
6. **Coordinates are planetocentric, east-positive longitude, degrees.** Jezero is about
   18.4°N, 77.5°E. Perseverance landing site: 18.4446°N, 77.4509°E (use it as the M0 check).

## 2. Viewer setup (shape of the code)

```ts
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'

export const MARS = new Cesium.Ellipsoid(3396190.0, 3396190.0, 3396190.0)
Cesium.Ellipsoid.default = MARS                       // FIRST, before anything else

const tiling = new Cesium.GeographicTilingScheme({ ellipsoid: MARS })

const viewer = new Cesium.Viewer(container, {
  globe: new Cesium.Globe(MARS),
  mapProjection: new Cesium.GeographicProjection(MARS),   // needed for 2D / 2.5D
  skyAtmosphere: new Cesium.SkyAtmosphere(MARS),          // or false
  baseLayer: false,              // we add Trek imagery ourselves
  baseLayerPicker: false, geocoder: false, homeButton: false,
  sceneModePicker: false,        // we build our own 2D / 2.5D / 3D switch
  navigationHelpButton: false, timeline: false, animation: false,
  infoBox: false, selectionIndicator: false, fullscreenButton: false,
})
viewer.scene.globe.enableLighting = false
```

Vite: use `vite-plugin-cesium` (or copy `node_modules/cesium/Build/Cesium/{Workers,Assets,Widgets,ThirdParty}`
to `public/cesium` and set `window.CESIUM_BASE_URL = '/cesium'`). Pin the cesium version in
`package.json`. React: create the viewer once in a `useEffect` with a ref, `viewer.destroy()` on
unmount, guard against React StrictMode double-mount.

## 3. View modes

| UI label | Cesium | Call |
|---|---|---|
| 2D | `SceneMode.SCENE2D` | `viewer.scene.morphTo2D(1.0)` |
| 2.5D | `SceneMode.COLUMBUS_VIEW` | `viewer.scene.morphToColumbusView(1.0)` |
| 3D | `SceneMode.SCENE3D` | `viewer.scene.morphTo3D(1.0)` |

⚠️ 2D and 2.5D on a custom ellipsoid have no official example. Test in M0. Fallback: 3D with a
top-down camera preset.

## 4. NASA Trek imagery (WMTS)

- Capabilities: `https://trek.nasa.gov/tiles/Mars/EQ/<LAYER>/1.0.0/WMTSCapabilities.xml`
- Tile template (note the double slash, it is real):
  `https://trek.nasa.gov/tiles/Mars/EQ/<LAYER>/1.0.0//default/default028mm/{TileMatrix}/{TileRow}/{TileCol}.<png|jpg>`
- Tile matrix set `default028mm`, 256 px, level 0 = 2 × 1 tiles from -180,90. That is exactly
  `GeographicTilingScheme`. CORS: `Access-Control-Allow-Origin: *` ✅
- Format: global Viking = `.jpg`, Jezero CTX/HiRISE = `.png`. Read the capabilities if unsure.

```ts
new Cesium.WebMapTileServiceImageryProvider({
  url: `https://trek.nasa.gov/tiles/Mars/EQ/${layer}/1.0.0//{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.${ext}`,
  layer, style: 'default', tileMatrixSetID: 'default028mm', format: `image/${ext === 'jpg' ? 'jpeg' : 'png'}`,
  tilingScheme: tiling, maximumLevel, rectangle,   // rectangle from the WGS84BoundingBox for local layers
  credit: new Cesium.Credit('NASA/JPL-Caltech Mars Trek'),
})
```

| Layer id | Category | Ext | Area |
|---|---|---|---|
| `Mars_Viking_MDIM21_ClrMosaic_global_232m` | optical | jpg | global |
| `JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0` | optical | png | 77.1605–77.6992°E, 18.2110–18.7212°N |
| `JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd` | optical | png | 77.2229–77.5840°E, 18.3068–18.6693°N |
| `THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018` | thermal | ⚠️ check | global |
| `frt_07_brcarj_mtr3_ll` (carbonates), `frt_07_brmafj_mtr3_ll` (mafic), `frt_07_brphyj_mtr3_ll` (Fe-Mg clays) | spectral | ⚠️ check | ⚠️ check coverage |
| `SIM3292_Global_Geology` | geology | ⚠️ check | global |

Find more: `https://trek.nasa.gov/mars/TrekServices/ws/index/eq/searchItems?key=<word>&proj=urn:ogc:def:crs:EPSG::104905`,
then `.../ws/index/getLayerServices?uuid=<item_UUID>` gives `endPoint` and `layerId`.

Perseverance path (ArcGIS feature service): `https://trek.nasa.gov/mars/trekarcgis/rest/services/Perseverance_Traverse_Path/MapServer/0`
(query with `/query?where=1%3D1&outFields=*&f=geojson`, ⚠️ check CORS, else save a GeoJSON copy to `public/data`).

## 5. Terrain

- Display terrain: Trek's own quantized-mesh service, CORS `*` ✅, levels 0–17 over Jezero ✅.
  `await Cesium.CesiumTerrainProvider.fromUrl('https://marshub.s3.amazonaws.com/mars_v14', { requestVertexNormals: true })`
  ⚠️ Undocumented endpoint. Wrap in try/catch and fall back to `EllipsoidTerrainProvider({ ellipsoid: MARS })`.
- ⚠️ Check that the terrain's ellipsoid matches our sphere (landing site height should be about
  −2,500 m against the areoid, terrain must not float above imagery).
- Ground styling (MONOLITH look): `Cesium.Material.fromType('ElevationContour' | 'ElevationRamp' | 'SlopeRamp')`
  on `viewer.scene.globe.material`. ⚠️ Test how it mixes with imagery.
- For values in the HUD, read OUR DEM grid (exact numbers), not `sampleTerrainMostDetailed`.

## 6. The routing DEM

- Source: USGS Mars 2020 TRN, `https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0.tif` (9.7 MB)
- Projection: Equirectangular, Mars 2000 sphere r = 3,396,190 m, centre lon 0, lat_ts 0.
  Heights: metres from the MOLA areoid (⚠️ confirm in the `.xml` / `.lbl`).
- **Lives on the backend only.** The backend downloads it from the URL above into the Docker cache
  volume and loads it with rasterio. Never commit it, never ship it to the frontend.
- The frontend gets numbers from the backend API: `/api/dem/info`, `/api/point?lon=&lat=`,
  `/api/route` (A and B with points `[lon, lat, h]` + stats), `/api/profile`.
- Metres per degree on Mars: `2πR/360 = 59,274.7 m`. East-west metres per degree × `cos(lat)`.
- Slope: Horn method in real metres. Routes: scikit-image `MCP_Geometric` (see README section 8).
- Draw route points exactly as the API returns them (`[lon, lat, h]`), with explicit heights.

## 7. Layer config

Every map layer is one entry in `src/globe/layers.config.ts` (id, title, category
optical/topographic/thermal/spectral/vector, source, layerId, ext, rectangle, defaultOpacity,
visible, legend). The layer panel is built from that list. Opacity = `imageryLayer.alpha`.
Swipe compare = `imageryLayer.splitDirection = Cesium.SplitDirection.LEFT` + `scene.splitPosition`.

## 8. Performance

- `viewer.scene.requestRenderMode = true` and call `scene.requestRender()` after changes.
- `viewer.resolutionScale` 1 (lower on weak machines), `globe.maximumScreenSpaceError` 2 (raise to 4 if slow).
- Limit HiRISE `maximumLevel` and give it a `rectangle` so it loads only over Jezero.
