"""The Jezero elevation grid (DEM): download, cache, load, elevation and slope.

DEM means Digital Elevation Model. It is a grid of heights in metres.
Source: USGS Astrogeology, Mars 2020 Terrain Relative Navigation, CTX DTM mosaic, 20 m.

The file is never stored in the repo. It is downloaded once into the cache
folder (a Docker volume) and then kept in memory as a numpy array.

The maths functions at the top are pure. They do not need the real file.
The tests use them with small synthetic arrays.
"""

from __future__ import annotations

import logging
import math
import os
import threading
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

# Use the uvicorn logger so the messages show up in the container log.
log = logging.getLogger("uvicorn.error")

# ---------------------------------------------------------------------------
# Facts about the source file
# ---------------------------------------------------------------------------

DEM_URL = os.environ.get(
    "DEM_URL",
    "https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/"
    "JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0.tif",
)
DEM_CACHE_DIR = Path(os.environ.get("DEM_CACHE_DIR", "/data"))
DEM_FILE_NAME = DEM_URL.rsplit("/", 1)[-1]

SOURCE_NAME = "USGS Mars 2020 TRN CTX DTM (20 m)"
SOURCE_DOI = "https://doi.org/10.5066/P906QQT8"

# Radius of the Mars sphere used by the map projection of the file.
# Confirmed in the USGS label file (.lbl): EquatorialRadius = PolarRadius = 3396190.0 m.
MARS_RADIUS_M = 3_396_190.0

# What we know about the height zero. Keep this text honest.
# Checked on 2026-11-15:
# - The GeoTIFF stores no vertical datum, no unit and no height tags.
# - The USGS .lbl file beside it has map facts only, nothing about heights.
# - The USGS .xml file says the values "refer to the Mars 2020 IAU Sphere with a
#   radius of 3396190m". The numbers do not fit that sentence.
# - NASA's rover waypoint file (M20_waypoints.json) gives two heights for each point.
#   At the landing site: elev_geoid = -2569.91 m and elev_radii = -4253.47 m.
#   This DEM reads -2567.5 m there. Over 708 waypoints the DEM minus elev_geoid
#   is -0.9 m on average, with a spread (standard deviation) of 3.3 m.
# So the heights match the areoid ("geoid") heights that the Mars 2020 mission uses.
# We did not find a USGS text that names the exact areoid model.
VERTICAL_REFERENCE = (
    "Metres above the Mars areoid (the Mars 'sea level'), as used by the Mars 2020 mission. "
    "Checked by comparison: the heights agree with the 'elev_geoid' values in NASA's "
    "Perseverance waypoint file (about 1 m mean difference, about 3 m spread). "
    "The file name says 'MOLAtopography DeltaGeoid'. The file itself stores no vertical datum, "
    "and the exact areoid model is not named in the USGS metadata."
)

# How many times the background loader tries before it gives up.
LOAD_ATTEMPTS = 3
# Seconds to wait before a new request may start the loader again after an error.
RETRY_AFTER_ERROR_S = 30.0


# ---------------------------------------------------------------------------
# Pure maths (no file needed)
# ---------------------------------------------------------------------------


def lonlat_to_xy(lon_deg: float, lat_deg: float, radius_m: float = MARS_RADIUS_M) -> tuple[float, float]:
    """Convert longitude and latitude in degrees to map metres.

    The projection is Equirectangular on a sphere.
    Centre longitude is 0 and the standard parallel is 0.
    So x = R * lon and y = R * lat, with the angles in radians.
    Longitude is east-positive. Latitude is planetocentric.
    """
    return radius_m * math.radians(lon_deg), radius_m * math.radians(lat_deg)


def xy_to_lonlat(x_m: float, y_m: float, radius_m: float = MARS_RADIUS_M) -> tuple[float, float]:
    """Convert map metres back to longitude and latitude in degrees."""
    return math.degrees(x_m / radius_m), math.degrees(y_m / radius_m)


def xy_to_rowcol(x_m: float, y_m: float, transform: Any) -> tuple[float, float]:
    """Convert map metres to a fractional row and column.

    'transform' is the affine transform of the raster (pixel to map).
    The answer uses cell-centre indexing:
    row 0.0, col 0.0 is the centre of the top-left cell.
    The top-left corner of the raster is row -0.5, col -0.5.
    """
    col_edge, row_edge = (~transform) * (x_m, y_m)
    return row_edge - 0.5, col_edge - 0.5


def lonlat_to_rowcol(
    lon_deg: float, lat_deg: float, transform: Any, radius_m: float = MARS_RADIUS_M
) -> tuple[float, float]:
    """Convert longitude and latitude in degrees to a fractional row and column."""
    x_m, y_m = lonlat_to_xy(lon_deg, lat_deg, radius_m)
    return xy_to_rowcol(x_m, y_m, transform)


def is_inside(row: float, col: float, height: int, width: int) -> bool:
    """Say if a fractional row and column fall on the raster area."""
    return -0.5 <= row < height - 0.5 and -0.5 <= col < width - 0.5


def bilinear(grid: np.ndarray, row: float, col: float) -> float | None:
    """Interpolate a height from the 4 nearest cell centres.

    'grid' holds heights. Cells with no data must be NaN.
    Returns None if the point is outside, or if a cell that is needed has no data.
    In the half cell along the border the point is moved to the nearest centre.
    """
    height, width = grid.shape
    if not is_inside(row, col, height, width):
        return None

    row = min(max(row, 0.0), height - 1.0)
    col = min(max(col, 0.0), width - 1.0)

    r0 = min(int(math.floor(row)), height - 2) if height > 1 else 0
    c0 = min(int(math.floor(col)), width - 2) if width > 1 else 0
    r1 = min(r0 + 1, height - 1)
    c1 = min(c0 + 1, width - 1)
    fr = row - r0
    fc = col - c0

    cells = (
        (float(grid[r0, c0]), (1.0 - fr) * (1.0 - fc)),
        (float(grid[r0, c1]), (1.0 - fr) * fc),
        (float(grid[r1, c0]), fr * (1.0 - fc)),
        (float(grid[r1, c1]), fr * fc),
    )
    total = 0.0
    for z, weight in cells:
        # A cell with weight 0 does not change the answer, so it may be empty.
        if weight == 0.0:
            continue
        if not math.isfinite(z):
            return None
        total += z * weight
    return total


def horn_slope_deg(window: np.ndarray, cell_x_m: float, cell_y_m: float) -> float | None:
    """Slope in degrees from a 3x3 window of heights, with Horn's method.

    This is the same formula as GDAL's 'gdaldem slope'.
    'cell_x_m' is the east-west size of one cell in metres on the ground.
    'cell_y_m' is the north-south size of one cell in metres on the ground.
    Returns None if the window is not 3x3 or if a cell has no data (NaN).
    """
    if window.shape != (3, 3) or not np.all(np.isfinite(window)):
        return None

    a, b, c = (float(v) for v in window[0])
    d, _e, f = (float(v) for v in window[1])
    g, h, i = (float(v) for v in window[2])

    dz_dx = ((c + 2.0 * f + i) - (a + 2.0 * d + g)) / (8.0 * cell_x_m)
    dz_dy = ((g + 2.0 * h + i) - (a + 2.0 * b + c)) / (8.0 * cell_y_m)
    return math.degrees(math.atan(math.hypot(dz_dx, dz_dy)))


# ---------------------------------------------------------------------------
# The grid in memory
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class DemGrid:
    """A height grid with its map position.

    'heights' is a 2D float array. Cells with no data are NaN.
    'transform' is the affine transform (pixel to map metres).
    """

    heights: np.ndarray
    transform: Any
    radius_m: float = MARS_RADIUS_M

    @property
    def cell_x_m(self) -> float:
        """East-west cell size in map metres."""
        return abs(self.transform.a)

    @property
    def cell_y_m(self) -> float:
        """North-south cell size in map metres."""
        return abs(self.transform.e)

    def bounds_deg(self) -> list[float]:
        """The raster edges as [west, south, east, north] in degrees."""
        height, width = self.heights.shape
        x0, y0 = self.transform * (0, 0)
        x1, y1 = self.transform * (width, height)
        lon0, lat0 = xy_to_lonlat(x0, y0, self.radius_m)
        lon1, lat1 = xy_to_lonlat(x1, y1, self.radius_m)
        return [min(lon0, lon1), min(lat0, lat1), max(lon0, lon1), max(lat0, lat1)]

    def elevation(self, lon_deg: float, lat_deg: float) -> float | None:
        """Height in metres at a point, or None if outside or no data."""
        row, col = lonlat_to_rowcol(lon_deg, lat_deg, self.transform, self.radius_m)
        return bilinear(self.heights, row, col)

    def slope(self, lon_deg: float, lat_deg: float) -> float | None:
        """Slope in degrees at a point, or None if it cannot be calculated.

        Uses the 3x3 cells around the cell that holds the point.
        Returns None on the border row or column, and next to cells with no data.

        Ground distance: the map is Equirectangular with standard parallel 0.
        So one cell is 'cell_y_m' metres north-south everywhere,
        but east-west it is only 'cell_x_m * cos(lat)' metres on the ground.
        At Jezero (18.4 N) that is about 19.0 m, not 20 m.
        We use the ground size, so slopes are in real metres.
        """
        row, col = lonlat_to_rowcol(lon_deg, lat_deg, self.transform, self.radius_m)
        height, width = self.heights.shape
        if not is_inside(row, col, height, width):
            return None
        r = int(round(row))
        c = int(round(col))
        r = min(max(r, 0), height - 1)
        c = min(max(c, 0), width - 1)
        if r < 1 or c < 1 or r > height - 2 or c > width - 2:
            return None
        window = self.heights[r - 1 : r + 2, c - 1 : c + 2]
        ground_x_m = self.cell_x_m * math.cos(math.radians(lat_deg))
        return horn_slope_deg(window, ground_x_m, self.cell_y_m)


# ---------------------------------------------------------------------------
# Download and load
# ---------------------------------------------------------------------------


def dem_path() -> Path:
    """Where the cached DEM file lives."""
    return DEM_CACHE_DIR / DEM_FILE_NAME


def download_dem(url: str = DEM_URL, target: Path | None = None) -> Path:
    """Download the DEM into the cache folder if it is not there yet.

    The data goes to a temporary name first and is renamed at the end.
    So a broken download is never used.
    """
    target = target or dem_path()
    if target.exists() and target.stat().st_size > 0:
        return target

    target.parent.mkdir(parents=True, exist_ok=True)
    part = target.with_name(target.name + f".{os.getpid()}.part")
    log.info("Downloading DEM from %s", url)
    request = urllib.request.Request(url, headers={"User-Agent": "martian-map-backend"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response, open(part, "wb") as out:
            expected = response.headers.get("Content-Length")
            written = 0
            while True:
                chunk = response.read(1024 * 256)
                if not chunk:
                    break
                out.write(chunk)
                written += len(chunk)
        if written == 0:
            raise OSError("The DEM download was empty.")
        if expected is not None and written != int(expected):
            raise OSError(f"The DEM download is not complete: {written} of {expected} bytes.")
        os.replace(part, target)
    finally:
        if part.exists():
            part.unlink()
    log.info("DEM saved to %s (%d bytes)", target, written)
    return target


def read_dem(path: Path) -> tuple[DemGrid, dict[str, Any]]:
    """Read the GeoTIFF into memory. Cells with no data become NaN."""
    import rasterio  # Imported here so the pure maths works without rasterio.

    with rasterio.open(path) as src:
        heights = src.read(1).astype(np.float32)
        nodata = src.nodata
        transform = src.transform
        meta = {
            "width": src.width,
            "height": src.height,
            "nodata": nodata,
            "dtype": src.dtypes[0],
            "crs_wkt": src.crs.to_wkt() if src.crs else None,
            "tags": dict(src.tags()),
            "band_tags": dict(src.tags(1)),
            "units": src.units[0] if src.units else None,
        }

    if nodata is not None and not math.isnan(nodata):
        heights[heights == np.float32(nodata)] = np.nan
    # Very large negative numbers are a common "no data" marker in planetary files.
    heights[~np.isfinite(heights)] = np.nan
    heights[heights < -1.0e30] = np.nan

    return DemGrid(heights=heights, transform=transform), meta


class DemStore:
    """Holds the DEM in memory and loads it once, in a background thread."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._grid: DemGrid | None = None
        self._meta: dict[str, Any] = {}
        self._error: str | None = None
        self._error_time = 0.0

    def start_loading(self) -> None:
        """Start the background load. Safe to call many times."""
        with self._lock:
            if self._grid is not None:
                return
            if self._thread is not None and self._thread.is_alive():
                return
            if self._error is not None and time.monotonic() - self._error_time < RETRY_AFTER_ERROR_S:
                return
            self._error = None
            self._thread = threading.Thread(target=self._load, name="dem-loader", daemon=True)
            self._thread.start()

    def _load(self) -> None:
        last_error = "Unknown error."
        for attempt in range(1, LOAD_ATTEMPTS + 1):
            try:
                # Import first. A missing library must not look like a broken file.
                from rasterio.errors import RasterioIOError

                path = download_dem()
                try:
                    grid, meta = read_dem(path)
                except RasterioIOError:
                    # The cached file cannot be read. Remove it so the next try downloads again.
                    path.unlink(missing_ok=True)
                    raise
                with self._lock:
                    self._grid = grid
                    self._meta = meta
                    self._error = None
                log.info("DEM ready: %d x %d cells", meta["width"], meta["height"])
                return
            except Exception as exc:  # noqa: BLE001 - we report every failure as status
                last_error = f"{type(exc).__name__}: {exc}"
                log.warning("DEM load attempt %d failed: %s", attempt, last_error)
                if attempt < LOAD_ATTEMPTS:
                    time.sleep(2.0 * attempt)
        with self._lock:
            self._error = last_error
            self._error_time = time.monotonic()

    def status(self) -> tuple[str, str | None]:
        """Return ('ready' | 'loading' | 'error', error text or None)."""
        with self._lock:
            if self._grid is not None:
                return "ready", None
            if self._error is not None:
                return "error", self._error
            return "loading", None

    def grid(self) -> DemGrid | None:
        """The loaded grid, or None if it is not ready."""
        with self._lock:
            return self._grid

    def meta(self) -> dict[str, Any]:
        """Facts read from the file. Empty until the grid is ready."""
        with self._lock:
            return dict(self._meta)


store = DemStore()
