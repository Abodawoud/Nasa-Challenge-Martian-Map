"""Walking routes on the Jezero height grid (PLAN.md section 8, decisions D9, D10, D14).

Two routes are made between a start cell and a goal cell:

- Route A, "Shortest". The cost of a cell is 1 / cos(slope).
  That turns flat map distance into distance on the sloping ground.
- Route B, "Lower-slope". The same cost times a penalty that grows with the slope.
  Route B is never called "safest". Slope is only one danger.

The search is scikit-image's MCP_Geometric. It finds the path with the lowest total cost.
The cost of one step is the mean cost of its two cells times the length of the step.

The maths here needs only a DemGrid. The tests use small synthetic grids.
"""

from __future__ import annotations

import math
import threading
import time
from typing import Any

import numpy as np
from skimage.graph import MCP_Geometric

from .dem import DemGrid, bilinear, is_inside, lonlat_to_rowcol

# ---------------------------------------------------------------------------
# Settings. Every number is explained here. They are sent to the frontend too.
# ---------------------------------------------------------------------------

# Route A may not use cells steeper than this. A setting from PLAN.md section 8.
# It is our choice, not a NASA limit for astronauts.
ROUTE_A_MAX_SLOPE_DEG = 30.0

# Route B may not use cells steeper than this. A setting from PLAN.md section 8.
# It is our choice too.
ROUTE_B_MAX_SLOPE_DEG = 25.0

# Route B penalty: cost x (1 + (slope / 10 degrees)^2).
# At 10 degrees a cell costs 2 times more. At 20 degrees it costs 5 times more.
# A setting from PLAN.md section 8. It is our choice.
SLOPE_PENALTY_DEG = 10.0

# Cells steeper than this count as "steep" in the statistics and warnings.
# A setting from PLAN.md section 8. It is our choice.
STEEP_DEG = 15.0

# Comfortable walking speed in Mars gravity (3.71 m/s2) without a suit, in metres per second.
# It comes from the Froude number rule for walking (PLAN.md section 8). It is a model value.
# Nobody has walked on Mars, so it is not a measured speed.
WALK_SPEED_M_S = 0.9

# A space suit makes walking slower. ASSUMPTION: the speed is multiplied by 0.6.
SUIT_FACTOR = 0.6

# Carried equipment makes walking slower. ASSUMPTION: 1.0 means no extra load.
LOAD_FACTOR = 1.0

# Top speed of the Perseverance rover on flat hard ground, in metres per hour (NASA figure).
# The real average speed of the rover is much lower.
ROVER_SPEED_M_PER_HOUR = 152.0

# The two numbers of Tobler's hiking function: speed ~ exp(-3.5 * abs(s + 0.05)).
# 's' is the height change divided by the flat length of a step.
# The curve was measured for people walking on Earth.
# ASSUMPTION: the same shape holds for a person in a suit on Mars.
TOBLER_STEEPNESS = 3.5
TOBLER_OFFSET = 0.05

# The search area is cut to the box around start and goal plus a margin.
# This keeps short routes fast. How the margin was chosen:
# - At least 150 cells (3 km at 20 m per cell). A short route can still go around
#   a crater or a cliff that is a few kilometres wide.
# - For long routes: half of the longer side of the box. The room for a detour
#   then grows with the length of the route.
# A route inside the cut area can be a little longer than the best route on the whole grid.
# That happens only if the best route leaves the cut area.
# If no route exists in the cut area, the search runs once more on the whole grid.
CROP_MARGIN_MIN_CELLS = 150
CROP_MARGIN_SHARE = 0.5

# MCP_Geometric treats a cell with a negative cost as a wall.
# The tests check this. They also check that infinity works the same way.
BLOCKED_COST = -1.0

ROUTE_DEFS = (
    {"id": "a", "name": "Shortest", "max_slope_deg": ROUTE_A_MAX_SLOPE_DEG, "penalty": False},
    {"id": "b", "name": "Lower-slope", "max_slope_deg": ROUTE_B_MAX_SLOPE_DEG, "penalty": True},
)


class RouteError(Exception):
    """A request that cannot be answered. 'code' is 'outside' or 'same_point'."""

    def __init__(self, code: str, detail: str) -> None:
        super().__init__(detail)
        self.code = code
        self.detail = detail


# ---------------------------------------------------------------------------
# Slope grid
# ---------------------------------------------------------------------------


def middle_latitude_deg(grid: DemGrid) -> float:
    """Latitude of the middle of the grid, in degrees."""
    _west, south, _east, north = grid.bounds_deg()
    return (south + north) / 2.0


def ground_cell_sizes(grid: DemGrid) -> tuple[float, float]:
    """Real size of one cell on the ground as (north-south metres, east-west metres).

    The map is Equirectangular with standard parallel 0.
    North-south a cell is 'cell_y_m' everywhere.
    East-west it is 'cell_x_m * cos(latitude)'.
    We use one cos for the whole grid: the cos of the middle latitude.
    The Jezero grid is about 0.5 degrees tall. Across it the cos changes by about 0.3%.
    """
    dy = grid.cell_y_m
    dx = grid.cell_x_m * math.cos(math.radians(middle_latitude_deg(grid)))
    return dy, dx


def slope_grid_deg(heights: np.ndarray, cell_x_m: float, cell_y_m: float) -> np.ndarray:
    """Slope in degrees for every cell, with Horn's method (the same as 'gdaldem slope').

    'cell_x_m' and 'cell_y_m' are the sizes of one cell on the ground in metres.
    A cell gets NaN if its 3x3 window is not complete.
    That is the outer border, and every cell that touches a cell with no data.
    """
    z = heights.astype(np.float64)
    slope = np.full(z.shape, np.nan, dtype=np.float32)
    if z.shape[0] < 3 or z.shape[1] < 3:
        return slope

    # The 8 neighbours of every inner cell. 'a' is top-left, 'i' is bottom-right.
    a, b, c = z[:-2, :-2], z[:-2, 1:-1], z[:-2, 2:]
    d, f = z[1:-1, :-2], z[1:-1, 2:]
    g, h, i = z[2:, :-2], z[2:, 1:-1], z[2:, 2:]
    centre = z[1:-1, 1:-1]

    dz_dx = ((c + 2.0 * f + i) - (a + 2.0 * d + g)) / (8.0 * cell_x_m)
    dz_dy = ((g + 2.0 * h + i) - (a + 2.0 * b + c)) / (8.0 * cell_y_m)
    inner = np.degrees(np.arctan(np.hypot(dz_dx, dz_dy)))
    # A NaN neighbour already gives NaN. A NaN centre must give NaN too.
    inner[~np.isfinite(centre)] = np.nan
    slope[1:-1, 1:-1] = inner
    return slope


_slope_lock = threading.Lock()
# Holds (grid, slope grid) of the last grid. The grid is kept so it is compared by identity.
_slope_cache: list[Any] = []


def cached_slope_grid(grid: DemGrid) -> np.ndarray:
    """The slope grid of 'grid'. Worked out once and then kept in memory."""
    with _slope_lock:
        if _slope_cache and _slope_cache[0] is grid:
            return _slope_cache[1]
        dy, dx = ground_cell_sizes(grid)
        slope = slope_grid_deg(grid.heights, dx, dy)
        _slope_cache[:] = [grid, slope]
        return slope


# ---------------------------------------------------------------------------
# Cost grids and the search
# ---------------------------------------------------------------------------


def cell_cost(slope_deg: np.ndarray, penalty: bool) -> np.ndarray:
    """Cost of walking over cells with this slope, without any blocking.

    Route A: 1 / cos(slope). Route B: the same times (1 + (slope / 10 degrees)^2).
    """
    slope = np.asarray(slope_deg, dtype=np.float64)
    cost = 1.0 / np.cos(np.radians(slope))
    if penalty:
        cost = cost * (1.0 + (slope / SLOPE_PENALTY_DEG) ** 2)
    return cost


def cost_grid(slope_deg: np.ndarray, heights: np.ndarray, max_slope_deg: float, penalty: bool) -> np.ndarray:
    """Cost per cell for one route. Blocked cells get BLOCKED_COST.

    Blocked: no height, no slope (border of the grid), or a slope over the limit.
    """
    slope = slope_deg.astype(np.float64)
    usable = np.isfinite(slope) & np.isfinite(heights) & (slope <= max_slope_deg)
    cost = np.full(slope.shape, BLOCKED_COST, dtype=np.float64)
    cost[usable] = cell_cost(slope[usable], penalty)
    return cost


def open_cell(cost: np.ndarray, slope_deg: np.ndarray, cell: tuple[int, int], penalty: bool) -> None:
    """Make the start or goal cell usable, even if it is too steep for the route.

    The cell gets the normal cost of its slope, without the limit.
    If the slope is not known (border of the grid) the cost is 1, the cost of flat ground.
    """
    slope = float(slope_deg[cell])
    cost[cell] = float(cell_cost(np.array(slope), penalty)) if math.isfinite(slope) else 1.0


def crop_window(
    start: tuple[int, int], goal: tuple[int, int], shape: tuple[int, int], margin_cells: int | None = None
) -> tuple[int, int, int, int]:
    """The search area as (row0, row1, col0, col1). Row1 and col1 are not included.

    It is the box around start and goal plus a margin on every side.
    See CROP_MARGIN_MIN_CELLS for how the margin is chosen.
    """
    r_lo, r_hi = sorted((start[0], goal[0]))
    c_lo, c_hi = sorted((start[1], goal[1]))
    if margin_cells is None:
        longer_side = max(r_hi - r_lo, c_hi - c_lo)
        margin_cells = max(CROP_MARGIN_MIN_CELLS, int(math.ceil(CROP_MARGIN_SHARE * longer_side)))
    return (
        max(0, r_lo - margin_cells),
        min(shape[0], r_hi + margin_cells + 1),
        max(0, c_lo - margin_cells),
        min(shape[1], c_hi + margin_cells + 1),
    )


def least_cost_path(
    cost: np.ndarray, start: tuple[int, int], goal: tuple[int, int], sampling: tuple[float, float]
) -> list[tuple[int, int]] | None:
    """The cheapest path from start to goal as a list of (row, col), or None if there is none.

    'sampling' is the real cell size (north-south, east-west) in metres.
    With it a diagonal step and a step on a non-square cell get the right length.
    Steps go to all 8 neighbours.
    """
    mcp = MCP_Geometric(cost, sampling=sampling, fully_connected=True)
    totals, _traceback = mcp.find_costs([start], [goal])
    if not math.isfinite(float(totals[goal])):
        return None
    return [(int(r), int(c)) for r, c in mcp.traceback(goal)]


def find_path(
    grid: DemGrid,
    slope_deg: np.ndarray,
    start: tuple[int, int],
    goal: tuple[int, int],
    max_slope_deg: float,
    penalty: bool,
    margin_cells: int | None = None,
) -> tuple[list[tuple[int, int]] | None, bool]:
    """Search one route. Returns (path or None, True if the whole grid was searched).

    First the cut area is searched. If that finds nothing, the whole grid is searched once.
    """
    sampling = ground_cell_sizes(grid)
    shape = grid.heights.shape
    window = crop_window(start, goal, shape, margin_cells)
    whole = (0, shape[0], 0, shape[1])
    for r0, r1, c0, c1 in (window, whole):
        cost = cost_grid(slope_deg[r0:r1, c0:c1], grid.heights[r0:r1, c0:c1], max_slope_deg, penalty)
        local_start = (start[0] - r0, start[1] - c0)
        local_goal = (goal[0] - r0, goal[1] - c0)
        open_cell(cost, slope_deg[r0:r1, c0:c1], local_start, penalty)
        open_cell(cost, slope_deg[r0:r1, c0:c1], local_goal, penalty)
        path = least_cost_path(cost, local_start, local_goal, sampling)
        is_whole = (r0, r1, c0, c1) == whole
        if path is not None:
            return [(r + r0, c + c0) for r, c in path], is_whole
        if is_whole:
            break
    return None, True


# ---------------------------------------------------------------------------
# Numbers for a found path
# ---------------------------------------------------------------------------


def walk_slope_factor(s: np.ndarray) -> np.ndarray:
    """How much slower or faster a step is than a step on flat ground.

    's' is the height change divided by the flat length of the step.
    It is positive uphill and negative downhill.
    This is the shape of Tobler's hiking function, scaled so that flat ground gives 1.
    The curve is fastest on a gentle downhill (s = -0.05). There it gives about 1.19.
    ASSUMPTION: the curve was measured on Earth. We use its shape for Mars.
    """
    return np.exp(-TOBLER_STEEPNESS * np.abs(s + TOBLER_OFFSET)) / math.exp(-TOBLER_STEEPNESS * TOBLER_OFFSET)


def cell_centres_lonlat(grid: DemGrid, rows: np.ndarray, cols: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Longitude and latitude in degrees (east-positive) of cell centres."""
    t = grid.transform
    x = t.a * (cols + 0.5) + t.b * (rows + 0.5) + t.c
    y = t.d * (cols + 0.5) + t.e * (rows + 0.5) + t.f
    return np.degrees(x / grid.radius_m), np.degrees(y / grid.radius_m)


def _rounded(values: np.ndarray, digits: int) -> list[float | None]:
    """Round an array for JSON. NaN becomes None."""
    return [round(float(v), digits) if math.isfinite(float(v)) else None for v in values]


def describe_path(
    grid: DemGrid, slope_deg: np.ndarray, path: list[tuple[int, int]], max_slope_deg: float
) -> dict[str, Any]:
    """Points, height profile, statistics and warnings of a path.

    Distances use the real cell sizes on the ground.
    'distance_m' is the length along the ground in 3D. 'flat_distance_m' ignores heights.

    'walk_time_s' is an ESTIMATE. For every step:
    speed = 0.9 m/s x suit factor x load factor x slope factor, and time = 3D length / speed.
    The 0.9 m/s is a model value for Mars gravity.
    The suit factor (0.6) and the load factor (1.0) are assumptions.
    The slope factor uses a walking curve measured on Earth. That is an assumption too.

    'rover_time_s' uses the top speed of Perseverance (152 m per hour) for the whole way.
    """
    dy, dx = ground_cell_sizes(grid)
    rows = np.array([p[0] for p in path], dtype=np.int64)
    cols = np.array([p[1] for p in path], dtype=np.int64)
    z = grid.heights[rows, cols].astype(np.float64)
    slopes = slope_deg[rows, cols].astype(np.float64)
    lon, lat = cell_centres_lonlat(grid, rows, cols)

    flat = np.hypot(np.diff(rows) * dy, np.diff(cols) * dx)
    dz = np.diff(z)
    step_3d = np.hypot(flat, dz)
    along = np.concatenate(([0.0], np.cumsum(step_3d)))

    distance = float(step_3d.sum())
    flat_distance = float(flat.sum())
    climb = float(dz[dz > 0].sum())
    descent = float(-dz[dz < 0].sum())

    # Half of every step belongs to the cell at each end. This is how the search counts too.
    cell_length = np.zeros(len(path))
    cell_length[:-1] += step_3d / 2.0
    cell_length[1:] += step_3d / 2.0
    known = np.isfinite(slopes)
    steep_length = float(cell_length[known & (slopes > STEEP_DEG)].sum())
    steep_percent = 100.0 * steep_length / distance if distance > 0 else 0.0
    # The slope is not known only for a start or goal cell on the border of the grid.
    max_slope = float(slopes[known].max()) if known.any() else None
    mean_slope = float(slopes[known].mean()) if known.any() else None

    speed = WALK_SPEED_M_S * SUIT_FACTOR * LOAD_FACTOR * walk_slope_factor(dz / flat)
    walk_time = float((step_3d / speed).sum())
    rover_time = distance / (ROVER_SPEED_M_PER_HOUR / 3600.0)

    warnings: list[str] = []
    steep_text = f"{STEEP_DEG:g}°"
    if steep_percent >= 0.5:
        warnings.append(f"{steep_percent:.0f}% of this route is steeper than {steep_text}.")
    elif steep_percent > 0:
        warnings.append(f"Less than 1% of this route is steeper than {steep_text}.")
    if max_slope is not None and max_slope > STEEP_DEG:
        warnings.append(f"The steepest part is {max_slope:.0f}°.")
    for name, value in (("start", slopes[0]), ("end", slopes[-1])):
        if not math.isfinite(value):
            warnings.append(f"The slope at the {name} point is not known. It is on the edge of the height map.")
        elif value > max_slope_deg:
            warnings.append(f"The {name} point is on ground steeper than the limit of this route.")

    return {
        "points": [
            [round(float(lo), 6), round(float(la), 6), round(float(h), 1)] for lo, la, h in zip(lon, lat, z)
        ],
        "profile": {
            "distance_m": _rounded(along, 1),
            "elevation_m": _rounded(z, 1),
            "slope_deg": _rounded(slopes, 1),
        },
        "stats": {
            "distance_m": round(distance, 1),
            "flat_distance_m": round(flat_distance, 1),
            "climb_m": round(climb, 1),
            "descent_m": round(descent, 1),
            "max_slope_deg": None if max_slope is None else round(max_slope, 1),
            "mean_slope_deg": None if mean_slope is None else round(mean_slope, 1),
            "steep_percent": round(steep_percent, 1),
            "walk_time_s": round(walk_time),
            "rover_time_s": round(rover_time),
        },
        "warnings": warnings,
    }


def settings(grid: DemGrid) -> dict[str, Any]:
    """The setting numbers, for the frontend to show."""
    return {
        "resolution_m": round(grid.cell_x_m),
        "route_a_max_slope_deg": ROUTE_A_MAX_SLOPE_DEG,
        "route_b_max_slope_deg": ROUTE_B_MAX_SLOPE_DEG,
        "slope_penalty_deg": SLOPE_PENALTY_DEG,
        "steep_deg": STEEP_DEG,
        "walk_speed_m_s": WALK_SPEED_M_S,
        "suit_factor": SUIT_FACTOR,
        "load_factor": LOAD_FACTOR,
        "rover_speed_m_per_hour": ROVER_SPEED_M_PER_HOUR,
    }


def plan_routes(
    grid: DemGrid,
    start: tuple[int, int],
    goal: tuple[int, int],
    slope_deg: np.ndarray | None = None,
    margin_cells: int | None = None,
) -> list[dict[str, Any]]:
    """Make Route A and Route B between two cells given as (row, col)."""
    if slope_deg is None:
        slope_deg = cached_slope_grid(grid)
    routes: list[dict[str, Any]] = []
    for definition in ROUTE_DEFS:
        limit = definition["max_slope_deg"]
        path, _whole = find_path(grid, slope_deg, start, goal, limit, definition["penalty"], margin_cells)
        route: dict[str, Any] = {"id": definition["id"], "name": definition["name"]}
        if path is None:
            route.update(
                found=False,
                reason=(
                    f"Ground steeper than {limit:g}° or ground with no height data "
                    "blocks every way between these two points."
                ),
                points=[],
                profile={"distance_m": [], "elevation_m": [], "slope_deg": []},
                stats=None,
                warnings=[],
            )
        else:
            route.update(found=True, reason=None)
            route.update(describe_path(grid, slope_deg, path, limit))
        routes.append(route)
    return routes


def _locate(grid: DemGrid, lon_deg: float, lat_deg: float, name: str) -> tuple[tuple[int, int], float]:
    """Find the cell of a point and the height at the point. Raises RouteError if there is none."""
    # The grid uses longitudes from -180 to 180. Accept 0 to 360 as well.
    grid_lon = lon_deg - 360.0 if lon_deg > 180.0 else lon_deg
    rows, cols = grid.heights.shape
    row, col = lonlat_to_rowcol(grid_lon, lat_deg, grid.transform, grid.radius_m)
    if is_inside(row, col, rows, cols):
        cell = (min(max(int(round(row)), 0), rows - 1), min(max(int(round(col)), 0), cols - 1))
        cell_height = float(grid.heights[cell])
        if math.isfinite(cell_height):
            # The height between cell centres, like /api/point. Next to missing data use the cell.
            smooth = bilinear(grid.heights, row, col)
            return cell, cell_height if smooth is None else smooth
        raise RouteError(
            "outside",
            f"The {name} point is on ground with no height data. The height map covers Jezero Crater only.",
        )
    raise RouteError(
        "outside", f"The {name} point is outside the height map. The height map covers Jezero Crater only."
    )


def compute_routes(grid: DemGrid, from_lon: float, from_lat: float, to_lon: float, to_lat: float) -> dict[str, Any]:
    """Answer one route request. This is the body of GET /api/route.

    Raises RouteError with code 'outside' or 'same_point'.
    """
    started = time.perf_counter()
    start, start_height = _locate(grid, from_lon, from_lat, "start")
    goal, goal_height = _locate(grid, to_lon, to_lat, "end")
    if start == goal:
        raise RouteError(
            "same_point",
            f"The start point and the end point are in the same {round(grid.cell_x_m)} m cell. "
            "Pick two points that are further apart.",
        )
    routes = plan_routes(grid, start, goal)
    return {
        "status": "ok",
        "start": {"lon": from_lon, "lat": from_lat, "elevation_m": round(start_height, 1)},
        "goal": {"lon": to_lon, "lat": to_lat, "elevation_m": round(goal_height, 1)},
        "settings": settings(grid),
        "routes": routes,
        "compute_ms": round((time.perf_counter() - started) * 1000),
    }
