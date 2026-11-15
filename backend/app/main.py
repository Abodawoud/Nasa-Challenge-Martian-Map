"""Martian Map backend.

M0: health check.
M3: the Jezero elevation grid (DEM). Info about it, and elevation and slope of a point.
M4: two walking routes between two points (see PLAN.md section 8 and app/routing.py).
"""

from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Query
from fastapi.responses import JSONResponse

from . import dem, routing

# The west to east cut through a picked point: this far to each side, one height every step.
PROFILE_HALF_WIDTH_M = 500
PROFILE_STEP_M = 25


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Start the DEM download and load in the background when the app starts."""
    dem.store.start_loading()
    yield


app = FastAPI(
    title="Martian Map API",
    description="Calculations for the Jezero Marswalk planner: elevation, slope and routes.",
    version="0.3.0",
    lifespan=lifespan,
)


@app.get("/api/health")
def health() -> dict[str, str]:
    """Answer 'ok' when the backend is running."""
    return {"status": "ok", "service": "martian-map-backend"}


@app.get("/api/dem/info")
def dem_info() -> dict[str, Any]:
    """Describe the elevation grid and say if it is ready.

    Always answers with HTTP 200. Read the 'status' field.
    'resolution_m', 'bounds', 'width' and 'height' are null until the grid is ready.
    """
    dem.store.start_loading()
    status, error = dem.store.status()
    grid = dem.store.grid()
    info: dict[str, Any] = {
        "status": status,
        "error": error,
        "source": dem.SOURCE_NAME,
        "url": dem.DEM_URL,
        "doi": dem.SOURCE_DOI,
        "resolution_m": None,
        "bounds": None,
        "width": None,
        "height": None,
        "projection": "Equirectangular, Mars sphere radius 3396190 m, centre longitude 0, standard parallel 0",
        "vertical_reference": dem.VERTICAL_REFERENCE,
    }
    if grid is not None:
        rows, cols = grid.heights.shape
        info["resolution_m"] = round(grid.cell_x_m, 3)
        info["bounds"] = [round(v, 6) for v in grid.bounds_deg()]
        info["width"] = cols
        info["height"] = rows
    return info


def _dem_not_ready() -> JSONResponse:
    """The HTTP 503 answer while the grid is loading, or if loading failed."""
    status, error = dem.store.status()
    detail = (
        "The elevation grid is still loading. Try again in a few seconds."
        if status == "loading"
        else "The elevation grid could not be loaded."
    )
    return JSONResponse(
        status_code=503,
        content={"status": status, "error": error, "detail": detail},
        headers={"Retry-After": "3"},
    )


@app.get("/api/route")
def route(
    from_lon: float = Query(..., ge=-180.0, le=360.0, description="Start longitude in degrees, east-positive."),
    from_lat: float = Query(..., ge=-90.0, le=90.0, description="Start latitude in degrees, planetocentric."),
    to_lon: float = Query(..., ge=-180.0, le=360.0, description="End longitude in degrees, east-positive."),
    to_lat: float = Query(..., ge=-90.0, le=90.0, description="End latitude in degrees, planetocentric."),
) -> Any:
    """Two walking routes between two points, from the USGS DEM.

    Route A is "Shortest". Route B is "Lower-slope": it is longer but avoids steep ground.
    Each route has its points, a height profile, statistics and warnings.
    A route that does not exist has 'found: false' and a 'reason'.
    The walking time is an estimate. The 'settings' field lists the numbers behind it.

    HTTP 422 with 'code: outside' if a point is outside the grid or on a cell with no data.
    HTTP 422 with 'code: same_point' if both points are in the same cell.
    HTTP 503 with a JSON body while the grid is still loading, or if loading failed.
    """
    dem.store.start_loading()
    grid = dem.store.grid()
    if grid is None:
        return _dem_not_ready()
    try:
        return routing.compute_routes(grid, from_lon, from_lat, to_lon, to_lat)
    except routing.RouteError as exc:
        content: dict[str, Any] = {"code": exc.code, "detail": exc.detail}
        if exc.code == "outside":
            content["bounds"] = [round(v, 6) for v in grid.bounds_deg()]
        return JSONResponse(status_code=422, content=content)


@app.get("/api/point")
def point(
    lon: float = Query(..., ge=-180.0, le=360.0, description="Longitude in degrees, east-positive."),
    lat: float = Query(..., ge=-90.0, le=90.0, description="Latitude in degrees, planetocentric."),
) -> Any:
    """Elevation and slope of one point, read from the USGS DEM.

    Answers 'inside: false' with no numbers if the point is outside the grid or on a cell with no data.
    Answers HTTP 503 with a JSON body while the grid is still loading, or if loading failed.
    'slope_deg' can be null on the outer border of the grid, where the 3x3 window is not complete.
    Also gives the lowest and highest height of the grid, and a 1 km west to east cut through the point.
    """
    dem.store.start_loading()
    grid = dem.store.grid()
    if grid is None:
        return _dem_not_ready()

    # The grid uses longitudes from -180 to 180. Accept 0 to 360 as well.
    grid_lon = lon - 360.0 if lon > 180.0 else lon

    answer: dict[str, Any] = {
        "inside": False,
        "lon": lon,
        "lat": lat,
        "resolution_m": round(grid.cell_x_m),
        "source": dem.SOURCE_NAME,
    }
    elevation = grid.elevation(grid_lon, lat)
    if elevation is None:
        return answer

    slope = grid.slope(grid_lon, lat)
    answer["inside"] = True
    answer["elevation_m"] = round(elevation, 1)
    answer["slope_deg"] = None if slope is None else round(slope, 1)

    # For the small charts in the Identify panel.
    # 1. The lowest and highest height of the whole grid, so the point can be placed between them.
    low, high = dem.height_range(grid)
    answer["area_min_m"] = round(low, 1)
    answer["area_max_m"] = round(high, 1)
    # 2. A cut through the ground from west to east through the point.
    #    'heights_m' go from west to east. A value is null where the cut leaves the grid.
    answer["profile"] = {
        "direction": "west to east",
        "half_width_m": PROFILE_HALF_WIDTH_M,
        "step_m": PROFILE_STEP_M,
        "heights_m": dem.west_east_profile(grid, grid_lon, lat, PROFILE_HALF_WIDTH_M, PROFILE_STEP_M),
    }
    return answer
