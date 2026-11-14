// Mars setup for Cesium. Rules and reasons: .claude/skills/cesium-mars/SKILL.md
// and PLAN.md decisions D3, D7.
import * as Cesium from 'cesium'

/** Mars radius used by NASA Trek and the USGS Mars 2020 products (Mars 2000 sphere, IAU). */
export const MARS_RADIUS_M = 3_396_190

/**
 * A perfect sphere, NOT Cesium.Ellipsoid.MARS (that one is flattened at the poles
 * and does not match the Trek / USGS data).
 */
export const MARS_ELLIPSOID = new Cesium.Ellipsoid(MARS_RADIUS_M, MARS_RADIUS_M, MARS_RADIUS_M)

// Must run before any other Cesium object is created, or that object keeps WGS84.
Cesium.Ellipsoid.default = MARS_ELLIPSOID

export const MARS_TILING = new Cesium.GeographicTilingScheme({ ellipsoid: MARS_ELLIPSOID })

/** Metres per degree of latitude on the Mars sphere (2πR / 360). */
export const METERS_PER_DEGREE = (2 * Math.PI * MARS_RADIUS_M) / 360

export const JEZERO = {
  name: 'Jezero Crater',
  lon: 77.45,
  lat: 18.44,
}

/** Perseverance landing site (Octavia E. Butler Landing). Used to check alignment in M0. */
export const PERSEVERANCE_LANDING = {
  name: 'Perseverance landing site',
  lon: 77.4509,
  lat: 18.4446,
}

/** Trek's own quantized-mesh terrain for Mars. Undocumented endpoint, see PLAN.md risk list. */
export const TREK_TERRAIN_URL = 'https://marshub.s3.amazonaws.com/mars_v14'
