---
name: cesium-mars
description: Verified facts and rules for building this project's Mars map with CesiumJS - the Mars sphere, NASA Trek WMTS imagery, Trek terrain, 2D/3D scene modes, drawing routes with explicit heights, the layer config, and the Jezero DEM. Load before writing or changing ANY code that touches Cesium, map layers, coordinates, terrain or routes.
---

# Cesium on Mars (this project)

Everything here was checked live on 2026-11-14 unless marked ⚠️. The plan and the reasons are in
`PLAN.md` (sections 4 to 8). Do not change a rule here without updating the PLAN.md decision.

## 1. Rules that must never break

1. **One Cesium `Viewer` for the whole app.** No second map engine (no MapLibre, deck.gl, Leaflet,
   R3F map). React only renders panels around it.
2. **Mars is a sphere, radius 3,396,190 m.** Not `Cesium.Ellipsoid.MARS` (that one is flattened
   at the poles, 3396190 × 3376200, and puts Jezero ~10 km off against Trek data).
3. **Set the ellipsoid before creating anything.** Objects made before keep WGS84.
4. **Routes are drawn with explicit heights** (`Cartesian3.fromDegrees(lon, lat, h)`), never
   `clampToGround` / `HeightReference.CLAMP_TO_GROUND` (unreliable off Earth and in 2D).
   **The drawing height `h` comes from the Trek terrain** (`sampleTerrainMostDetailed`), NOT from
   the USGS DEM. Measured in M0: Trek terrain gives +5,638.8 m at the landing site, the real
   areoid height is about −2,570 m. Trek uses another height zero. USGS heights are for the
   numbers shown in the UI only.
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
  mapProjection: new Cesium.GeographicProjection(MARS),   // needed for 2D
  skyAtmosphere: new Cesium.SkyAtmosphere(MARS),          // or false
  baseLayer: false,              // we add Trek imagery ourselves
  baseLayerPicker: false, geocoder: false, homeButton: false,
  sceneModePicker: false,        // we build our own 2D / 3D switch
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
| 2D | `SceneMode.SCENE2D` | `setViewMode(viewer, '2D')` (wraps `scene.morphTo2D(1.0)`) |
| 3D | `SceneMode.SCENE3D` | `setViewMode(viewer, '3D')` (wraps `scene.morphTo3D(1.0)`) |

- **No 2.5D (Columbus view).** Dropped on 2026-11-14 (PLAN.md D15): same picture as 3D near the
  ground, fewer controls, and the source of several camera bugs. Do not add it back.
- **A switch keeps the place.** `setViewMode` reads the view BEFORE the morph (camera values are
  not valid while `scene.mode === MORPHING`) and applies it on `scene.morphComplete`, inside
  try/catch. 3D to 2D: centre = `globe.pick` of the centre ray, width = 2 · distance · tan(fovy/2)
  · aspect. 2D to 3D: look north at the 2D centre, pitch −45°, same width, above the Trek ground.
- **In 2D, the height given to `camera.setView` / `flyTo` becomes the view width** on the ground
  (Camera.js `setView2D`: frustum right − left = height). The 2D frustum is an
  `OrthographicOffCenterFrustum`: width = `right − left`.

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

**Perseverance path (used, checked 2026-11-15):** `https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json`
(GeoJSON, one LineString per drive, lon/lat degrees + height, CORS `*`, 1.7 MB, current: sol 2022 on the check day.
Waypoints with distance totals: `.../M20_waypoints.json`). It is drawn as a painted imagery layer
(`src/globe/pathLayer.ts`): Cesium drapes it on the ground in 2D and 3D, so no heights are needed. Use the same
way for any other line or area layer. The Layers panel rows are `PANEL_LAYERS` in `layers.config.ts`, the
switching code is `layerControl.ts` (hidden = `show = false`, the rover path is built on first use).
**USGS geologic map of Jezero (used, checked 2026-11-15):** feature service
`https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Jezero_FeatureServiceFromPro/FeatureServer`
(layers 0 boundary, 1 figures, 2 landing ellipse, 3 cross sections, 4 location features, 5 contacts, 6 linear features,
7 surface features, 8 geologic units; CORS `*`; at most 2000 features per answer, so page with `resultOffset`).
Its coordinates are metres in Transverse Mercator on the Mars sphere, centre 77.5 E: `geologyLayer.ts` converts
them (checked against the service's own GeoJSON output) and paints them as tiles. Unit colours are the service's
own drawing rules. To test painted layers without a screenshot: read pixels with `gl.readPixels` inside
`scene.postRender` (reading the canvas at any other moment gives black).

**Radiation layer (2026-11-15):** NASA Trek has NO radiation layer. `radiation.ts` recolours the MOLA elevation
tiles (`mola128_mola64_merge_90Nto90S_SimpleC_clon0`, png, grey, levels 0 to 5 only, the Hellas floor is stored
as transparent black) with a blue-to-red ramp, following NASA's map PIA03480 (dose rises with ground height,
about 10 to 20 rem per year). It is an ESTIMATE and must always be labelled so. Never print a dose number per
place: the grey-to-height stretch of those tiles and the formula of the 2002 map are not published.

**Backend height service (built 2026-11-15):** `GET /api/dem/info` and `GET /api/point?lon=&lat=` (`backend/app/dem.py`). Answers `elevation_m` and `slope_deg` (Horn, in ground metres) from the USGS 20 m DEM, `inside: false` outside it (bounds 77.1605 to 77.6990 E, 18.2110 to 18.7212 N), HTTP 503 while the file is still downloading. `slope_deg` can be null on the outermost cells. Checked: the landing site reads -2567.5 m (NASA's waypoint file: -2569.91 m), and over all 708 NASA waypoints the difference is -0.9 m on average (spread 3.3 m). Vertical zero: the numbers match NASA's AREOID heights (`elev_geoid`), not sphere heights, although the USGS metadata sentence says "refer to the sphere". No USGS text names the areoid model: say "Mars reference level (areoid)" in the UI, not more.
**Routes (built 2026-11-15, PLAN.md section 8):** `GET /api/route?from_lon=&from_lat=&to_lon=&to_lat=` (`backend/app/routing.py`, scikit-image `MCP_Geometric`). Answers routes `a` (Shortest) and `b` (Lower-slope) with `points` [lon, lat, height], `profile`, `stats`, `warnings`, and the `settings` used. 422 with `code: outside` or `same_point`, 503 while the DEM loads. About 0.1 s for 6 km, 0.4 s for 12 km, 2 s corner to corner. Frontend: `globe/route.ts` (RouteTool) + `ui/RoutePanel.tsx`. Lines are drawn like the measure line (ground height + lift, redone by `onGroundChanged`). Paths follow the 20 m grid, so long straight runs and 45° turns are normal.
**Route candidates (2026-11-15, PLAN.md D14b):** `GET /api/routes` creates six routes, measures, scores and ranks them (`backend/app/candidates.py`, `terrain.py`), about 0.4 s for 6 km, 1.5 s for 12 km, 3 s for 17 km. `GET /api/reach?lon=&lat=` gives the walking-time map as a small PNG data URL with `bounds` and `legend` (about 1 s). The frontend (`route.ts` `fetchRoutes`) leaves out routes that win no measure. Briefing dashboard: `globe/weather.ts` reads `https://mars.nasa.gov/rss/api/?feed=weather&category=mars2020&feedtype=json` (CORS `*`, newest sol 1133 = 2024-04-27, no wind, no dust: always show the reading's date).
**Shapes on the ground, performance (measured 2026-11-15):** `onGroundChanged` calls only after the camera has stopped and tiles have stopped arriving (300 ms of quiet), never during a move. `RouteTool.reground` redoes only the points in view (`inViewTest`), in 4 ms slices per frame. Before: all points at once, several times a second, gave frames of up to 76 ms with 5 routes. After: under 10 ms. `globe.getHeight` costs about 17 microseconds per point: never call it for thousands of points in one frame.
**Map tools (2026-11-15):** `mapTools.ts` has the shared helpers (`pickPlace`, `drawPosition`, distances, `toolInput` to hold the mouse and the cursor over groundControls). Tools draw with entities at `globe.getHeight()` + a few metres and `disableDepthTestDistance` / `depthFailMaterial`, never clampToGround. Rover photos: `https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&sol=N` (CORS `*`, ignores `num`, includes sky photos: filter on `extended.mastEl`).

**2D never turns:** in 2D `enableRotate` must stay off (it switches Cesium's twist gesture), `enableTranslate` on.

Older, stops at sol 1176 (ArcGIS feature service, not used): `https://trek.nasa.gov/mars/trekarcgis/rest/services/Perseverance_Traverse_Path/MapServer/0`
(query with `/query?where=1%3D1&outFields=*&f=geojson`, ⚠️ check CORS, else save a GeoJSON copy to `public/data`).

### Imagery rules learned the hard way (2026-11-14)

- **Never return a canvas from a wrapped `requestImage`.** Cesium loads tiles as `ImageBitmap`
  objects that are already flipped for WebGL. A canvas gets flipped again on upload, so every
  tile is mirrored top to bottom inside its own square: craters cut at tile edges, horizontal
  bands. If you process a tile, draw it on an `OffscreenCanvas` and return
  `transferToImageBitmap()` (see `src/globe/tint.ts`).
- **One seamless source per zoom range.** Far: Viking colour. Near: `Jezero_CTX_BlockAdj_dd`
  (aligned CTX, seamless) over Jezero, global CTX elsewhere. Closest: HiRISE from terrain
  level 14 only. Do not stack several mosaics at the same zoom: each has its own brightness.
- The global CTX (Esri OnMars) is "uncontrolled": strips can be offset at seams. Its deepest
  level is 12 (level 13 answers HTTP 400). A few of its tiles near Jezero are broken files on
  the server (valid PNG header, cannot be decoded): "Failed to obtain image tile" for those
  is expected and harmless, they are under the Jezero mosaic.
- "Is the view ready" = `visibleTilesLoaded()` in `preload.ts`, not `globe.tilesLoaded`
  (that one also waits for tiles Cesium preloads around the view).
- Testing note: Chrome throttles a window that is covered by other windows to about 1 to 6
  frames per second. Animations and tile loading then look slow. Check
  `requestAnimationFrame` rate before blaming the app (one frame costs under 4 ms here).
- To debug imagery, compare with the raw tiles first (draw them on a canvas in the page).

### 3D mouse controls near the ground

Cesium's own 3D drag and tilt grab the smooth sphere, which is about 5.6 km below Trek's ground,
so near the surface they move the camera the wrong way (worse after a Ctrl + drag tilt).
`src/globe/groundControls.ts` replaces them below 300 km above the ground: drag = move over the
ground (exact: the cursor ray is intersected with the sphere through the grabbed point, then the
camera is rotated around the planet centre), Ctrl + drag (or middle drag) = orbit around the
screen-centre ground point, with a height floor so tilting never drops the camera to the ground.
Test any change by checking that a grabbed point ends under the cursor (0 px error). Do not
re-enable Cesium's rotate / tilt / translate in 3D near the ground.

## 5. Terrain

- Display terrain: Trek's own quantized-mesh service, CORS `*` ✅, levels 0–17 over Jezero ✅.
  `await Cesium.CesiumTerrainProvider.fromUrl('https://marshub.s3.amazonaws.com/mars_v14', { requestVertexNormals: true })`
  ⚠️ Undocumented endpoint. Wrap in try/catch and fall back to `EllipsoidTerrainProvider({ ellipsoid: MARS })`.
- ✅ Works with our sphere: imagery drapes correctly, 2D and 3D work (M0, 2026-11-14).
- ⚠️ **Always load it with `createTrekTerrain()` (`src/globe/trekTerrain.ts`), never with plain
  `CesiumTerrainProvider.fromUrl`.** Trek's tile headers carry bounding spheres computed for another
  planet shape (about 12 km and 2 km of height off). Cesium then culls visible tiles, which made
  holes and "cut" strips. `createTrekTerrain()` rebuilds each sphere from the tile's OBB.
- Camera limits live in `MarsViewer.tsx`: 3D at least 25 m above the ground, pitch at most +15°,
  zoom out at most 25,000 km. 2D zoom between 1 km across and the whole map, the map always
  fills the screen and its edges stop at the screen edges.
- ⚠️ Its heights use a different zero (+5,639 m at the landing site against about −2,570 m real).
  Never show Trek terrain heights as numbers. ⚠️ M3: check the relief is not vertically stretched
  by comparing height differences (delta top against crater floor) with the USGS DEM.
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
- Slope: Horn method in real metres. Routes: scikit-image `MCP_Geometric` (see PLAN.md section 8).
- Draw route points exactly as the API returns them (`[lon, lat, h]`), with explicit heights.

## 7. Layer config

Every map layer is one entry in `src/globe/layers.config.ts` (id, title, category
optical/topographic/thermal/spectral/vector, source, layerId, ext, rectangle, defaultOpacity,
visible, legend). The layer panel is built from that list. Opacity = `imageryLayer.alpha`.
Swipe compare = `imageryLayer.splitDirection = Cesium.SplitDirection.LEFT` + `scene.splitPosition`.

## 8. Performance

Settings that were measured (Jezero arrival view: 1,400 requests / 2.4 s before, 675 / 1.4 s after).
Do not undo them without measuring again (method: `surface.invalidateAllTiles()`, set the view,
call `viewer.render()` in a loop until the high and medium load queues are empty, count tile
requests with the Resource Timing API):
- `globe.preloadSiblings = false`, `preloadAncestors = true`.
- `scene.fog`: enabled, `renderable = false`, `screenSpaceErrorFactor = 4` (coarser far tiles, not drawn).
- `maximumScreenSpaceError` 1.3 when still, 2 while the camera moves (`camera.moveStart` / `moveEnd`).
- Tile cache: `public/tile-cache-sw.js` (service worker, cache-first for Trek, the terrain bucket
  and Esri tiles). The same worker keeps a safety copy of the live data files (rover path, weather
  and photo lists, USGS geologic map): network first, the copy from the last visit after 8 s or on
  failure (`mars-data-v1`). If tiles look stale after changing a layer, bump `CACHE` in that file.
- Look-around preload on `camera.moveEnd` (3 directions x 200 nearest tiles, below 100 km).
- Lowest camera height depends on photo detail: 25 m inside the HiRISE bounds, 250 m elsewhere
  (`minHeightAboveGround`). Blurry ground far from the landing site is the data limit, not a bug.
- `hiddenUnder` in `layers.config.ts`: tiles of a layer that lie fully under another layer are
  answered with an empty ImageBitmap (`createImageBitmap(new ImageData(1, 1))`), not downloaded.
  Never throw or return a canvas from `requestImage`: a throw leaves the tile loading forever.

- `viewer.scene.requestRenderMode = true` and call `scene.requestRender()` after changes.
- `viewer.resolutionScale` 1 (lower on weak machines), `globe.maximumScreenSpaceError` 2 (raise to 4 if slow).
- Limit HiRISE `maximumLevel` and give it a `rectangle` so it loads only over Jezero.
- **Load a destination before flying there: `src/globe/preload.ts`.** Cesium's own flight preload
  (`scene.preloadFlightCamera`) only works for 3D Tiles, never for the globe (checked in the
  1.147 source). `preloadView(viewer, view, groundHeight)` plans the terrain and imagery tiles of a
  camera view with Cesium's own rules, keeps the nearest 500, and downloads them at low priority
  into the browser HTTP cache. `waitForTiles` holds a pause until `globe.tilesLoaded`. Use both for
  every new "fly to" (intro, sites). Imagery URLs come from `tileUrl()` in `imagery.ts`: the same
  template as the providers, so the cache entry matches.
