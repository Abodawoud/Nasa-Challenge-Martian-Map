"""Several candidate routes between two points, measured, scored and ranked.

This is the body of GET /api/routes. The idea: create several routes, then check which one is good.

1. Six candidates are searched. Each one has its own idea of what a good route is (see CANDIDATES).
2. Every found line is straightened and then measured with the same yardstick (measure_line).
3. Look-alikes are merged. Routes that are not better than another route on any measure are dropped.
4. The routes that are left get a score from 0 to 100 and a rank. Rank 1 is recommended.

The score weights and every limit in this file are OUR CHOICE. They are sent in the answer.
No route is ever called the best for every danger. Slope, bumps and pits are what the grid can show.

The maths needs only a DemGrid. The tests use small synthetic grids.
"""

from __future__ import annotations

import math
import os
import time
from typing import Any, Callable

import numpy as np
from scipy import ndimage
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra

from . import routing, terrain
from .dem import DemGrid
from .routing import BLOCKED_COST, RouteError
from .terrain import GroundFacts

# ---------------------------------------------------------------------------
# Settings. Every number is explained here. They are sent to the frontend too.
# All of them are OUR CHOICE unless the comment says something else.
# ---------------------------------------------------------------------------

# "Flattest" may not use cells steeper than this.
FLATTEST_MAX_SLOPE_DEG = 20.0

# "Flattest" penalty: cost x (1 + (slope / 5 degrees)^2).
# At 5 degrees a cell costs 2 times more. At 10 degrees it costs 5 times more.
FLATTEST_PENALTY_DEG = 5.0

# "Smooth ground" penalty for bumps: cost x (1 + roughness / this many metres).
# It is the same number as the limit for a rough cell. So a cell at the limit costs 2 times more.
ROUGH_COST_SCALE_M = terrain.ROUGH_M

# "Smooth ground" penalty for pits: a pit cell costs this many times more.
PIT_COST_FACTOR = 3.0

# "Another way": cells closer than this to the best route so far get more expensive.
CORRIDOR_M = 150.0

# "Another way": how many times more expensive the cells in that corridor are.
CORRIDOR_COST_FACTOR = 3.0

# Two routes are look-alikes when they share at least this part of their cells.
# A cell is shared when the other route goes through it or through a cell that touches it.
# Why "touches": after straightening, two lines can run side by side less than one cell apart.
LOOKALIKE_CELL_SHARE = 0.85

# Two routes are look-alikes too when distance, walk time, climb and steepest slope
# all differ by at most this share (2%).
LOOKALIKE_STATS_SHARE = 0.02

# A route is dropped when it is not better than some other route on any measure.
# "Better" means better by more than this share (1%).
BETTER_BY_SHARE = 0.01

# "Another way" is kept even if it is not better on any measure, as long as it shares
# less than this part of its cells with every other returned route. Then it is a truly different way.
DIFFERENT_WAY_CELL_SHARE = 0.5

# Straightening may raise the search cost of a piece of the route by at most this share (1%).
STRAIGHTEN_COST_SHARE = 0.01

# The returned points are about this many metres apart on the ground.
POINT_SPACING_M = 20.0

# The parts of the score. They add up to 1. These weights are OUR CHOICE, not a standard.
# Time counts most. Steep ground comes second. Climb and bumpy ground share the rest.
SCORE_WEIGHTS = {"time": 0.40, "steep": 0.30, "climb": 0.15, "rough": 0.15}

# Small numbers added inside the score parts. They keep a part finite when the best value is 0.
STEEP_SCORE_OFFSET = 5.0
CLIMB_SCORE_OFFSET_M = 10.0
ROUGH_SCORE_OFFSET = 5.0

# How the "Fastest" candidate is searched.
# "direction-aware": a search on steps that knows if a step goes up or down (see direction_aware_path).
# "cell-steepness": the grid search, with the steepness of each cell used both ways.
# Measured on the real grid: the direction-aware search adds 0.07 s for a 6 km route,
# 0.35 s for a 12 km route and 0.7 s for a 17 km route. Its line was 1% to 4% quicker to walk.
# The answer says in 'settings.fastest_method' which of the two made the returned line.
FASTEST_METHOD = "direction-aware"

# The direction-aware search is only tried when its search area has at most this many cells.
# It needs about 200 bytes of memory per cell. A bigger area would be slow and heavy.
# Then the cell-steepness result is used.
# A host with little memory can lower it with the setting DIRECTION_AWARE_MAX_CELLS.
DIRECTION_AWARE_MAX_CELLS = int(os.environ.get("DIRECTION_AWARE_MAX_CELLS", "1200000"))

# The candidates, in table order. 'idea' is shown to the user.
CANDIDATES: tuple[dict[str, Any], ...] = (
    {
        "id": "shortest",
        "name": "Shortest",
        "idea": "The least distance walked on the ground.",
        "max_slope_deg": routing.ROUTE_A_MAX_SLOPE_DEG,
    },
    {
        "id": "fastest",
        "name": "Fastest",
        "idea": "The least estimated walking time.",
        "max_slope_deg": routing.ROUTE_A_MAX_SLOPE_DEG,
    },
    {
        "id": "lower_slope",
        "name": "Lower-slope",
        "idea": "Pays a growing price for steep ground, so it goes around it.",
        "max_slope_deg": routing.ROUTE_B_MAX_SLOPE_DEG,
    },
    {
        "id": "flattest",
        "name": "Flattest",
        "idea": "Stays on the flattest ground it can find, even if that is much longer.",
        "max_slope_deg": FLATTEST_MAX_SLOPE_DEG,
    },
    {
        "id": "smooth_ground",
        "name": "Smooth ground",
        "idea": "Keeps away from bumpy ground and from pits.",
        "max_slope_deg": routing.ROUTE_B_MAX_SLOPE_DEG,
    },
    {
        "id": "alternative",
        "name": "Another way",
        "idea": "A clearly different way, in case the best one is blocked.",
        "max_slope_deg": routing.ROUTE_B_MAX_SLOPE_DEG,
    },
)
CANDIDATE_BY_ID = {c["id"]: c for c in CANDIDATES}

# The 16 steps of the direction-aware search: the 8 neighbours and the 8 knight moves.
STEPS_8 = ((-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1))
STEPS_KNIGHT = ((-2, -1), (-2, 1), (-1, -2), (-1, 2), (1, -2), (1, 2), (2, -1), (2, 1))

Cell = tuple[int, int]
Window = tuple[int, int, int, int]


# ---------------------------------------------------------------------------
# Cost of a cell for every candidate
# ---------------------------------------------------------------------------


def base_walk_speed_m_s() -> float:
    """Walking speed on flat ground in metres per second: model speed x suit x load."""
    return routing.WALK_SPEED_M_S * routing.SUIT_FACTOR * routing.LOAD_FACTOR


def raw_cost(candidate_id: str, slope_deg: np.ndarray, roughness_m: np.ndarray, pit: np.ndarray) -> np.ndarray:
    """Cost of a cell for one candidate, without any blocking. NaN where the slope is not known.

    shortest:      1 / cos(slope). Flat map distance becomes distance on the sloping ground.
    fastest:       1 / (cos(slope) x speed factor). The time to cross the cell, in flat-ground metres.
                   The speed factor is the walking curve (Tobler) at the steepness of the cell.
                   The grid search cannot know the walking direction.
                   So it uses the steepness of the cell both ways, as if every step went uphill.
                   The reported walk time afterwards IS direction-aware (see measure_line).
    lower_slope:   the Route B cost of /api/route: 1 / cos(slope) x (1 + (slope / 10)^2).
    flattest:      1 / cos(slope) x (1 + (slope / 5)^2).
    smooth_ground: the lower_slope cost x (1 + roughness / ROUGH_COST_SCALE_M) x 3 in a pit cell.
    alternative:   the lower_slope cost. The corridor price is added later (see corridor_mask).
    """
    slope = np.asarray(slope_deg, dtype=np.float64)
    with np.errstate(invalid="ignore"):
        on_ground = 1.0 / np.cos(np.radians(slope))
        if candidate_id == "shortest":
            return on_ground
        if candidate_id == "fastest":
            return on_ground / routing.walk_slope_factor(np.tan(np.radians(slope)))
        if candidate_id == "flattest":
            return on_ground * (1.0 + (slope / FLATTEST_PENALTY_DEG) ** 2)
        lower_slope = on_ground * (1.0 + (slope / routing.SLOPE_PENALTY_DEG) ** 2)
        if candidate_id in ("lower_slope", "alternative"):
            return lower_slope
        if candidate_id == "smooth_ground":
            bumps = 1.0 + np.nan_to_num(np.asarray(roughness_m, dtype=np.float64)) / ROUGH_COST_SCALE_M
            return lower_slope * bumps * np.where(pit, PIT_COST_FACTOR, 1.0)
    raise ValueError(f"Unknown candidate: {candidate_id}")


def window_cost(
    grid: DemGrid,
    facts: GroundFacts,
    candidate_id: str,
    window: Window,
    start: Cell,
    goal: Cell,
    expensive: np.ndarray | None = None,
) -> np.ndarray:
    """The cost grid of one candidate inside a search area. Blocked cells get BLOCKED_COST.

    Blocked: no height, no slope (border of the grid), or a slope over the limit of the candidate.
    The start and goal cells are always usable, as in /api/route.
    'expensive' is a mask of the whole grid. Cells in it cost CORRIDOR_COST_FACTOR times more.
    """
    r0, r1, c0, c1 = window
    slope = facts.slope_deg[r0:r1, c0:c1].astype(np.float64)
    raw = raw_cost(candidate_id, slope, facts.roughness_m[r0:r1, c0:c1], facts.pit[r0:r1, c0:c1])
    if expensive is not None:
        raw = np.where(expensive[r0:r1, c0:c1], raw * CORRIDOR_COST_FACTOR, raw)
    limit = CANDIDATE_BY_ID[candidate_id]["max_slope_deg"]
    with np.errstate(invalid="ignore"):
        usable = np.isfinite(slope) & np.isfinite(grid.heights[r0:r1, c0:c1]) & (slope <= limit)
    cost = np.where(usable, raw, BLOCKED_COST)
    for cell in (start, goal):
        local = (cell[0] - r0, cell[1] - c0)
        # A start or goal on the border of the grid has no slope. It gets the cost of flat ground.
        cost[local] = raw[local] if math.isfinite(float(raw[local])) else 1.0
    return cost


# ---------------------------------------------------------------------------
# Straightening ("string pulling")
# ---------------------------------------------------------------------------


def straighten(
    path: list[Cell], cost_so_far: np.ndarray, line_cost: Callable[[Cell, Cell], float | None]
) -> list[Cell]:
    """Replace the zigzags of a grid path with straight pieces. Returns the corner cells that are kept.

    A grid path can only step to a neighbour cell, so it zigzags.
    We walk along the path and try to join cells with a straight line.
    A straight line is taken only if it crosses no blocked cell, and if its cost is at most
    1% (STRAIGHTEN_COST_SHARE) higher than the cost of the piece of path it replaces.

    'cost_so_far[k]' is the cost of the path from its first cell to cell k.
    'line_cost(a, b)' is the cost of the straight line from a to b, or None if it is blocked.
    From every kept cell we look for a far cell that can be joined: first in doubling jumps,
    then by halving. This finds a far cell fast. It is not always the farthest one.
    """
    last = len(path) - 1
    if last < 2:
        return list(path)

    def joins(i: int, j: int) -> bool:
        if j == i + 1:
            return True
        cost = line_cost(path[i], path[j])
        allowed = (cost_so_far[j] - cost_so_far[i]) * (1.0 + STRAIGHTEN_COST_SHARE) + 1e-9
        return cost is not None and cost <= allowed

    kept = [0]
    i = 0
    while i < last:
        good = i + 1
        jump = 2
        bad = None
        while True:
            j = min(i + jump, last)
            if joins(i, j):
                good = j
                if j == last:
                    break
                jump *= 2
            else:
                bad = j
                break
        while bad is not None and bad - good > 1:
            middle = (good + bad) // 2
            if joins(i, middle):
                good = middle
            else:
                bad = middle
        kept.append(good)
        i = good
    return [path[k] for k in kept]


def cells_on_line(a: Cell, b: Cell, per_cell: int) -> tuple[np.ndarray, np.ndarray]:
    """The cells under the straight line from cell a to cell b, sampled 'per_cell' times per cell."""
    d_row, d_col = b[0] - a[0], b[1] - a[1]
    count = max(1, max(abs(d_row), abs(d_col)) * per_cell)
    t = (np.arange(count) + 0.5) / count
    rows = np.rint(a[0] + t * d_row).astype(np.int64)
    cols = np.rint(a[1] + t * d_col).astype(np.int64)
    return rows, cols


def straighten_on_cost_grid(path: list[Cell], cost: np.ndarray, sampling: tuple[float, float]) -> list[Cell]:
    """Straighten a path of the grid search. 'cost' is the cost grid that the search used.

    The cost of a path step is the mean cost of its two cells times its length, as in the search.
    The cost of a straight line is the mean cost of the cells under it times its length.
    The line is sampled 4 times per cell, so it does not jump over a blocked cell.
    """
    dy, dx = sampling
    rows = np.array([p[0] for p in path])
    cols = np.array([p[1] for p in path])
    values = cost[rows, cols]
    lengths = np.hypot(np.diff(rows) * dy, np.diff(cols) * dx)
    cost_so_far = np.concatenate(([0.0], np.cumsum((values[:-1] + values[1:]) / 2.0 * lengths)))

    def line_cost(a: Cell, b: Cell) -> float | None:
        line_rows, line_cols = cells_on_line(a, b, 4)
        under = cost[line_rows, line_cols]
        if (under < 0).any():
            return None
        return float(under.mean()) * math.hypot((b[0] - a[0]) * dy, (b[1] - a[1]) * dx)

    return straighten(path, cost_so_far, line_cost)


def resample(corners: list[Cell], sampling: tuple[float, float]) -> tuple[np.ndarray, np.ndarray]:
    """Points about POINT_SPACING_M apart along the straight pieces between the corner cells.

    Returns fractional rows and columns. Row 0.0, col 0.0 is the centre of the top-left cell.
    Every corner cell is one of the points.
    """
    dy, dx = sampling
    rows: list[np.ndarray] = [np.array([float(corners[0][0])])]
    cols: list[np.ndarray] = [np.array([float(corners[0][1])])]
    for (r_a, c_a), (r_b, c_b) in zip(corners[:-1], corners[1:]):
        length = math.hypot((r_b - r_a) * dy, (c_b - c_a) * dx)
        pieces = max(1, int(round(length / POINT_SPACING_M)))
        t = np.arange(1, pieces + 1) / pieces
        rows.append(r_a + t * (r_b - r_a))
        cols.append(c_a + t * (c_b - c_a))
    return np.concatenate(rows), np.concatenate(cols)


# ---------------------------------------------------------------------------
# The searches
# ---------------------------------------------------------------------------


def search_candidate(
    grid: DemGrid,
    facts: GroundFacts,
    candidate_id: str,
    start: Cell,
    goal: Cell,
    margin_cells: int | None = None,
    expensive: np.ndarray | None = None,
) -> tuple[list[Cell], list[Cell], Window] | None:
    """One grid search (MCP_Geometric) for one candidate.

    Returns (the path cells, the corner cells after straightening, the search area), or None.
    First the cut area around the two points is searched. If that finds nothing, the whole grid
    is searched once. This is the same rule as in /api/route (see routing.crop_window).
    """
    sampling = routing.ground_cell_sizes(grid)
    shape = grid.heights.shape
    whole = (0, shape[0], 0, shape[1])
    windows = [routing.crop_window(start, goal, shape, margin_cells)]
    if windows[0] != whole:
        windows.append(whole)
    for window in windows:
        r0, _r1, c0, _c1 = window
        cost = window_cost(grid, facts, candidate_id, window, start, goal, expensive)
        local_start = (start[0] - r0, start[1] - c0)
        local_goal = (goal[0] - r0, goal[1] - c0)
        path = routing.least_cost_path(cost, local_start, local_goal, sampling)
        if path is not None:
            corners = straighten_on_cost_grid(path, cost, sampling)
            return (
                [(r + r0, c + c0) for r, c in path],
                [(r + r0, c + c0) for r, c in corners],
                window,
            )
    return None


def step_times_s(heights: np.ndarray, rows: np.ndarray, cols: np.ndarray, sampling: tuple[float, float]) -> np.ndarray:
    """Walking time in seconds of every step between cells, with the height of the cell centres.

    This is the same rule as 'walk_time_s': 3D length / (flat speed x slope factor of the step).
    The slope of a step has a sign. Uphill and downhill get different speeds.
    """
    dy, dx = sampling
    flat = np.hypot(np.diff(rows) * dy, np.diff(cols) * dx)
    dz = np.diff(heights[rows, cols].astype(np.float64))
    return np.hypot(flat, dz) / (base_walk_speed_m_s() * routing.walk_slope_factor(dz / flat))


def direction_aware_path(
    grid: DemGrid,
    facts: GroundFacts,
    start: Cell,
    goal: Cell,
    window: Window,
    known_path: list[Cell],
) -> tuple[list[Cell], list[Cell]] | None:
    """The fastest way when every step knows if it goes up or down. Returns (path, corners) or None.

    The grid search (MCP_Geometric) gives one cost to a cell. It cannot know the walking direction.
    Here we build a graph instead. Every usable cell is a node.
    A node has up to 16 steps: to its 8 neighbours and the 8 knight moves (2 cells and 1 cell).
    The cost of a step is its walking time, with the signed slope of the step.
    Blocked cells (steeper than the limit of "Fastest", or no data) are not in the graph.
    A knight move passes between two cells. It is only allowed if both are usable.
    The search is Dijkstra from scipy.

    To stay fast the graph is cut down with a rule that cannot lose the best way:
    'known_path' is a path we already have. Its time is an upper limit for the best time.
    A cell is left out if even a straight walk at the highest speed of the walking curve,
    from the start to the cell and on to the goal, takes longer than that.

    Returns None if the cut area is still too big (DIRECTION_AWARE_MAX_CELLS).
    """
    sampling = routing.ground_cell_sizes(grid)
    dy, dx = sampling
    r0, r1, c0, c1 = window
    heights = grid.heights[r0:r1, c0:c1].astype(np.float64)
    slope = facts.slope_deg[r0:r1, c0:c1]
    limit = CANDIDATE_BY_ID["fastest"]["max_slope_deg"]
    with np.errstate(invalid="ignore"):
        usable = np.isfinite(slope) & np.isfinite(heights) & (slope <= limit)
    s = (start[0] - r0, start[1] - c0)
    g = (goal[0] - r0, goal[1] - c0)
    usable[s] = usable[g] = True

    known_rows = np.array([p[0] - r0 for p in known_path])
    known_cols = np.array([p[1] - c0 for p in known_path])
    known_time = float(step_times_s(heights, known_rows, known_cols, sampling).sum())

    # The highest value of the slope factor is on a gentle downhill (s = -TOBLER_OFFSET).
    top_speed = base_walk_speed_m_s() * float(routing.walk_slope_factor(np.array(-routing.TOBLER_OFFSET)))
    row_index, col_index = np.ogrid[: heights.shape[0], : heights.shape[1]]
    via = np.hypot((row_index - s[0]) * dy, (col_index - s[1]) * dx) + np.hypot(
        (row_index - g[0]) * dy, (col_index - g[1]) * dx
    )
    near = usable & (via <= known_time * top_speed * 1.001)

    # Cut to the box around the cells that are left.
    rows_used = np.flatnonzero(near.any(axis=1))
    cols_used = np.flatnonzero(near.any(axis=0))
    b_r0, b_r1 = int(rows_used[0]), int(rows_used[-1]) + 1
    b_c0, b_c1 = int(cols_used[0]), int(cols_used[-1]) + 1
    near = near[b_r0:b_r1, b_c0:b_c1]
    z = heights[b_r0:b_r1, b_c0:b_c1]
    height, width = near.shape
    count = height * width
    if count > DIRECTION_AWARE_MAX_CELLS:
        return None
    s = (s[0] - b_r0, s[1] - b_c0)
    g = (g[0] - b_r0, g[1] - b_c0)

    speed = base_walk_speed_m_s()
    steps = STEPS_8 + STEPS_KNIGHT
    times = np.full((len(steps), height, width), np.inf, dtype=np.float32)
    for k, (d_row, d_col) in enumerate(steps):
        if height <= abs(d_row) or width <= abs(d_col):
            continue
        src = (slice(max(0, -d_row), height - max(0, d_row)), slice(max(0, -d_col), width - max(0, d_col)))
        dst = (slice(max(0, d_row), height - max(0, -d_row)), slice(max(0, d_col), width - max(0, -d_col)))
        allowed = near[src] & near[dst]
        if abs(d_row) == 2 or abs(d_col) == 2:
            # The two cells that a knight move passes between.
            if abs(d_row) == 2:
                between = ((d_row // 2, 0), (d_row // 2, d_col))
            else:
                between = ((0, d_col // 2), (d_row, d_col // 2))
            for m_row, m_col in between:
                moved = (
                    slice(src[0].start + m_row, src[0].stop + m_row),
                    slice(src[1].start + m_col, src[1].stop + m_col),
                )
                allowed = allowed & near[moved]
        flat = math.hypot(d_row * dy, d_col * dx)
        dz = z[dst] - z[src]
        with np.errstate(invalid="ignore"):
            step_time = np.hypot(flat, dz) / (speed * routing.walk_slope_factor(dz / flat))
        view = times[k][src]
        view[allowed] = step_time[allowed]

    # Pack the steps into a sparse graph. Row n of the graph holds the steps that leave node n.
    by_node = times.reshape(len(steps), count).T
    exists = np.isfinite(by_node)
    offsets = np.array([d_row * width + d_col for d_row, d_col in steps], dtype=np.int32)
    targets = (np.arange(count, dtype=np.int32)[:, None] + offsets[None, :])[exists]
    row_starts = np.concatenate(([0], np.cumsum(exists.sum(axis=1))))
    graph = csr_matrix((by_node[exists].astype(np.float64), targets, row_starts), shape=(count, count))

    start_node = s[0] * width + s[1]
    goal_node = g[0] * width + g[1]
    best, before = dijkstra(
        graph, directed=True, indices=start_node, return_predecessors=True, limit=known_time * 1.001
    )
    if not math.isfinite(float(best[goal_node])):
        return None
    nodes = [goal_node]
    while nodes[-1] != start_node:
        nodes.append(int(before[nodes[-1]]))
    nodes.reverse()
    local_path = [(n // width, n % width) for n in nodes]

    # Straighten with the same idea of cost: the walking time of the straight line.
    path_rows = np.array([p[0] for p in local_path])
    path_cols = np.array([p[1] for p in local_path])
    time_so_far = np.concatenate(([0.0], np.cumsum(step_times_s(z, path_rows, path_cols, sampling))))
    usable_box = usable[b_r0:b_r1, b_c0:b_c1]

    def line_time(a: Cell, b: Cell) -> float | None:
        line_rows, line_cols = cells_on_line(a, b, 4)
        if not usable_box[line_rows, line_cols].all():
            return None
        # One height per cell along the line. Cell a and cell b are the two ends.
        pieces = max(abs(b[0] - a[0]), abs(b[1] - a[1]))
        t = np.arange(pieces + 1) / pieces
        rows_f = a[0] + t * (b[0] - a[0])
        cols_f = a[1] + t * (b[1] - a[1])
        line_z = z[np.rint(rows_f).astype(np.int64), np.rint(cols_f).astype(np.int64)]
        flat = np.hypot(np.diff(rows_f) * dy, np.diff(cols_f) * dx)
        dz = np.diff(line_z)
        return float((np.hypot(flat, dz) / (speed * routing.walk_slope_factor(dz / flat))).sum())

    corners = straighten(local_path, time_so_far, line_time)
    shift_r, shift_c = r0 + b_r0, c0 + b_c0
    return (
        [(r + shift_r, c + shift_c) for r, c in local_path],
        [(r + shift_r, c + shift_c) for r, c in corners],
    )


def corridor_mask(shape: tuple[int, int], cells: set[Cell], sampling: tuple[float, float], radius_m: float) -> np.ndarray:
    """True for every cell of the grid that is closer than 'radius_m' to one of the given cells."""
    dy, dx = sampling
    rows = np.array([c[0] for c in cells])
    cols = np.array([c[1] for c in cells])
    pad = int(math.ceil(radius_m / min(dy, dx))) + 1
    r0, r1 = max(0, int(rows.min()) - pad), min(shape[0], int(rows.max()) + pad + 1)
    c0, c1 = max(0, int(cols.min()) - pad), min(shape[1], int(cols.max()) + pad + 1)
    away = np.ones((r1 - r0, c1 - c0), dtype=bool)
    away[rows - r0, cols - c0] = False
    distance = ndimage.distance_transform_edt(away, sampling=sampling)
    mask = np.zeros(shape, dtype=bool)
    mask[r0:r1, c0:c1] = distance <= radius_m
    return mask


# ---------------------------------------------------------------------------
# One yardstick for all routes
# ---------------------------------------------------------------------------


def heights_at(heights: np.ndarray, rows: np.ndarray, cols: np.ndarray) -> np.ndarray:
    """Heights at fractional rows and columns, from the 4 nearest cell centres (bilinear).

    Where one of the 4 cells has no data, the height of the nearest cell is used.
    """
    n_rows, n_cols = heights.shape
    r_low = np.clip(np.floor(rows).astype(np.int64), 0, max(n_rows - 2, 0))
    c_low = np.clip(np.floor(cols).astype(np.int64), 0, max(n_cols - 2, 0))
    r_high = np.minimum(r_low + 1, n_rows - 1)
    c_high = np.minimum(c_low + 1, n_cols - 1)
    f_r = rows - r_low
    f_c = cols - c_low
    total = np.zeros(len(rows), dtype=np.float64)
    for rr, cc, weight in (
        (r_low, c_low, (1.0 - f_r) * (1.0 - f_c)),
        (r_low, c_high, (1.0 - f_r) * f_c),
        (r_high, c_low, f_r * (1.0 - f_c)),
        (r_high, c_high, f_r * f_c),
    ):
        # A cell with weight 0 does not change the answer, so it may be empty.
        total += np.where(weight > 0, heights[rr, cc].astype(np.float64) * weight, 0.0)
    nearest = heights[np.rint(rows).astype(np.int64), np.rint(cols).astype(np.int64)].astype(np.float64)
    return np.where(np.isfinite(total), total, nearest)


def format_duration(seconds: float) -> str:
    """A time as plain text, such as '8 h 12 min' or '45 min'."""
    minutes = int(round(seconds / 60.0))
    hours, rest = divmod(minutes, 60)
    if hours == 0:
        return f"{rest} min"
    return f"{hours} h {rest} min"


def measure_line(
    grid: DemGrid, facts: GroundFacts, rows: np.ndarray, cols: np.ndarray, max_slope_deg: float
) -> dict[str, Any]:
    """Points, height profile, statistics and warnings of a line. The same for every candidate.

    'rows' and 'cols' are the points of the line as fractional cell numbers, about 20 m apart.
    The height of a point is read between the cell centres (bilinear).
    Slope, roughness and pits of a point are those of the cell it lies in.

    The numbers follow the same rules as routing.describe_path of /api/route:
    'distance_m' is the length along the ground in 3D. 'flat_distance_m' ignores heights.
    'walk_time_s' is an ESTIMATE and it is direction-aware: every step uses its own signed slope.
    Speed = 0.9 m/s x suit factor x load factor x slope factor. See routing.py for the assumptions.
    'rover_time_s' uses the top speed of Perseverance for the whole way.

    New here: 'rough_percent' is the share of the length on rough cells.
    'pit_m' is the length in metres inside pit cells. See terrain.py for both limits.
    """
    dy, dx = routing.ground_cell_sizes(grid)
    cell_rows = np.rint(rows).astype(np.int64)
    cell_cols = np.rint(cols).astype(np.int64)
    z = heights_at(grid.heights, rows, cols)
    slopes = facts.slope_deg[cell_rows, cell_cols].astype(np.float64)
    lon, lat = routing.cell_centres_lonlat(grid, rows, cols)

    flat = np.hypot(np.diff(rows) * dy, np.diff(cols) * dx)
    dz = np.diff(z)
    step_3d = np.hypot(flat, dz)
    along = np.concatenate(([0.0], np.cumsum(step_3d)))

    distance = float(step_3d.sum())
    flat_distance = float(flat.sum())
    climb = float(dz[dz > 0].sum())
    descent = float(-dz[dz < 0].sum())

    # Half of every step belongs to the point at each end.
    point_length = np.zeros(len(rows))
    point_length[:-1] += step_3d / 2.0
    point_length[1:] += step_3d / 2.0
    known = np.isfinite(slopes)
    steep_length = float(point_length[known & (slopes > routing.STEEP_DEG)].sum())
    steep_percent = 100.0 * steep_length / distance if distance > 0 else 0.0
    # The slope is not known only for a start or goal cell on the border of the grid.
    max_slope = float(slopes[known].max()) if known.any() else None
    mean_slope = float(slopes[known].mean()) if known.any() else None
    rough_length = float(point_length[facts.rough[cell_rows, cell_cols]].sum())
    rough_percent = 100.0 * rough_length / distance if distance > 0 else 0.0
    pit_length = float(point_length[facts.pit[cell_rows, cell_cols]].sum())

    walk_time = float((step_3d / (base_walk_speed_m_s() * routing.walk_slope_factor(dz / flat))).sum())
    rover_time = distance / (routing.ROVER_SPEED_M_PER_HOUR / 3600.0)

    # The warnings use the rounded numbers of the statistics.
    # So a sentence never shows a different number than the table beside it.
    steep_percent = round(steep_percent, 1)
    rough_percent = round(rough_percent, 1)
    pit_length = round(pit_length, 1)
    warnings: list[str] = []
    steep_text = f"{routing.STEEP_DEG:g}°"
    if steep_percent >= 0.5:
        warnings.append(f"{steep_percent:.0f}% of this route is steeper than {steep_text}.")
    elif steep_percent > 0:
        warnings.append(f"Less than 1% of this route is steeper than {steep_text}.")
    if max_slope is not None and max_slope > routing.STEEP_DEG:
        warnings.append(f"The steepest part is {max_slope:.0f}°.")
    if rough_percent >= 0.5:
        warnings.append(f"{rough_percent:.0f}% of this route is on bumpy ground.")
    elif rough_percent > 0:
        warnings.append("Less than 1% of this route is on bumpy ground.")
    if pit_length >= 0.5:
        warnings.append(f"It crosses {pit_length:.0f} m of pits.")
    for name, value in (("start", slopes[0]), ("end", slopes[-1])):
        if not math.isfinite(value):
            warnings.append(f"The slope at the {name} point is not known. It is on the edge of the height map.")
        elif value > max_slope_deg:
            warnings.append(f"The {name} point is on ground steeper than the limit of this route.")

    rounded = routing._rounded
    return {
        "points": [
            [round(float(lo), 6), round(float(la), 6), round(float(h), 1)] for lo, la, h in zip(lon, lat, z)
        ],
        "profile": {
            "distance_m": rounded(along, 1),
            "elevation_m": rounded(z, 1),
            "slope_deg": rounded(slopes, 1),
        },
        "stats": {
            "distance_m": round(distance, 1),
            "flat_distance_m": round(flat_distance, 1),
            "climb_m": round(climb, 1),
            "descent_m": round(descent, 1),
            "max_slope_deg": None if max_slope is None else round(max_slope, 1),
            "mean_slope_deg": None if mean_slope is None else round(mean_slope, 1),
            "steep_percent": steep_percent,
            "rough_percent": rough_percent,
            "pit_m": pit_length,
            "walk_time_s": round(walk_time),
            "rover_time_s": round(rover_time),
        },
        "warnings": warnings,
    }


def build_route(
    grid: DemGrid, facts: GroundFacts, candidate_id: str, corners: list[Cell]
) -> dict[str, Any]:
    """Turn the corner cells of a found candidate into a measured route.

    Keys that start with '_' are for this module only. They are removed before the answer is sent.
    """
    definition = CANDIDATE_BY_ID[candidate_id]
    rows, cols = resample(corners, routing.ground_cell_sizes(grid))
    route: dict[str, Any] = {
        "id": definition["id"],
        "name": definition["name"],
        "idea": definition["idea"],
        "also": [],
    }
    route.update(measure_line(grid, facts, rows, cols, definition["max_slope_deg"]))
    route["_cells"] = set(zip(np.rint(rows).astype(int).tolist(), np.rint(cols).astype(int).tolist()))
    route["_merged"] = []
    return route


# ---------------------------------------------------------------------------
# Compare routes: look-alikes, routes that are not better, score and rank
# ---------------------------------------------------------------------------


def measures(stats: dict[str, Any]) -> dict[str, float]:
    """The five numbers that routes are compared on. Lower is better for all of them.

    steepness: steep_percent + the degrees that the steepest slope is over STEEP_DEG.
    smooth:    rough_percent + the percent of the length that is inside pits.
    """
    max_slope = stats["max_slope_deg"] or 0.0
    distance = stats["distance_m"]
    return {
        "distance": float(distance),
        "time": float(stats["walk_time_s"]),
        "steepness": stats["steep_percent"] + max(0.0, max_slope - routing.STEEP_DEG),
        "climb": float(stats["climb_m"]),
        "smooth": stats["rough_percent"] + (stats["pit_m"] / distance * 100.0 if distance > 0 else 0.0),
    }


def shared_cell_share(cells: set[Cell], other: set[Cell]) -> float:
    """The part of 'cells' that the other route goes through, or right next to (a touching cell)."""
    if not cells:
        return 0.0
    near_other = {(r + dr, c + dc) for r, c in other for dr in (-1, 0, 1) for dc in (-1, 0, 1)}
    return len(cells & near_other) / len(cells)


def are_lookalikes(route: dict[str, Any], earlier: dict[str, Any]) -> bool:
    """True if two routes are so alike that only one of them should be shown.

    Rule 1: each route has at least LOOKALIKE_CELL_SHARE of its cells on or next to the other.
    Rule 2: distance, walk time, climb and steepest slope all differ by at most LOOKALIKE_STATS_SHARE.
    """
    share = min(
        shared_cell_share(route["_cells"], earlier["_cells"]),
        shared_cell_share(earlier["_cells"], route["_cells"]),
    )
    if share >= LOOKALIKE_CELL_SHARE:
        return True
    for key in ("distance_m", "walk_time_s", "climb_m", "max_slope_deg"):
        a = route["stats"][key] or 0.0
        b = earlier["stats"][key] or 0.0
        if abs(a - b) > LOOKALIKE_STATS_SHARE * max(a, b):
            return False
    return True


def is_not_better(route: dict[str, Any], other: dict[str, Any]) -> bool:
    """True if 'route' is not better than 'other' by more than 1% on any of the five measures."""
    mine, theirs = measures(route["stats"]), measures(other["stats"])
    return all(mine[key] >= theirs[key] * (1.0 - BETTER_BY_SHARE) for key in mine)


def score_routes(routes: list[dict[str, Any]]) -> None:
    """Give every route its score parts, score, rank, 'recommended' and 'best_at'. Sorts the list by rank.

    Every part goes from 0 to 100. Higher is better. A part compares a route with the best
    of the routes in the list:
    time:  100 x best time / this time
    steep: 100 x (best p + 5) / (p + 5), with p = the 'steepness' measure
    climb: 100 x (best climb + 10) / (climb + 10)
    rough: 100 x (best q + 5) / (q + 5), with q = the 'smooth' measure
    The score is the weighted sum of the parts with SCORE_WEIGHTS. The weights are OUR CHOICE.
    Rank 1 is the highest score. With equal scores the shorter time comes first.
    """
    if not routes:
        return
    values = [measures(r["stats"]) for r in routes]
    best = {key: min(v[key] for v in values) for key in values[0]}
    for route, value in zip(routes, values):
        parts = {
            "time": 100.0 * best["time"] / value["time"] if value["time"] > 0 else 100.0,
            "steep": 100.0 * (best["steepness"] + STEEP_SCORE_OFFSET) / (value["steepness"] + STEEP_SCORE_OFFSET),
            "climb": 100.0 * (best["climb"] + CLIMB_SCORE_OFFSET_M) / (value["climb"] + CLIMB_SCORE_OFFSET_M),
            "rough": 100.0 * (best["smooth"] + ROUGH_SCORE_OFFSET) / (value["smooth"] + ROUGH_SCORE_OFFSET),
        }
        route["score"] = int(round(sum(SCORE_WEIGHTS[key] * parts[key] for key in SCORE_WEIGHTS)))
        route["score_parts"] = {key: int(round(parts[key])) for key in SCORE_WEIGHTS}
        route["best_at"] = [key for key in ("distance", "time", "steepness", "climb", "smooth") if value[key] <= best[key]]
    routes.sort(key=lambda r: (-r["score"], r["stats"]["walk_time_s"]))
    for position, route in enumerate(routes):
        route["rank"] = position + 1
        route["recommended"] = position == 0


def drop_not_better(routes: list[dict[str, Any]], dropped: list[dict[str, str]]) -> list[dict[str, Any]]:
    """Take out the routes that are not better than another route on any measure.

    The weakest route (lowest score) is checked first. So of two equal routes the stronger one stays.
    "Another way" stays if it is a truly different way (see DIFFERENT_WAY_CELL_SHARE).
    """
    score_routes(routes)
    kept = list(routes)
    for route in reversed(routes):
        others = [r for r in kept if r is not route]
        if not others:
            break
        if route["id"] == "alternative":
            most_shared = max(shared_cell_share(route["_cells"], r["_cells"]) for r in others)
            if most_shared < DIFFERENT_WAY_CELL_SHARE:
                continue
        winner = next((r for r in others if is_not_better(route, r)), None)
        if winner is None:
            continue
        kept.remove(route)
        reason = f"Not better than the {winner['name']} route on any measure."
        dropped.append({"id": route["id"], "name": route["name"], "reason": reason})
        for merged_id, merged_name in route["_merged"]:
            dropped.append({"id": merged_id, "name": merged_name, "reason": reason})
    return kept


# ---------------------------------------------------------------------------
# The recommendation text
# ---------------------------------------------------------------------------


def _percent_text(value: float) -> str:
    """A percent for a sentence: '9%' or 'less than 1%'."""
    if 0 < value < 0.5:
        return "less than 1%"
    return f"{value:.0f}%"


def _steep_clause(stats: dict[str, Any]) -> str:
    steep_text = f"{routing.STEEP_DEG:g}°"
    if stats["steep_percent"] == 0:
        return f"none of it is steeper than {steep_text}"
    return f"{_percent_text(stats['steep_percent'])} of it is steeper than {steep_text}"


def _weak_point(runner: dict[str, Any], top: dict[str, Any]) -> str | None:
    """One clause that says where the runner-up is weaker than the top route. Real numbers only."""
    gaps = {key: top["score_parts"][key] - runner["score_parts"][key] for key in ("steep", "climb", "rough")}
    key = max(gaps, key=lambda k: gaps[k])
    if gaps[key] <= 0:
        return None
    mine, theirs = runner["stats"], top["stats"]
    if key == "steep":
        if _percent_text(mine["steep_percent"]) != _percent_text(theirs["steep_percent"]):
            return (
                f"{_percent_text(mine['steep_percent'])} of it is steeper than {routing.STEEP_DEG:g}°, "
                f"against {_percent_text(theirs['steep_percent'])}"
            )
        if mine["max_slope_deg"] is not None and theirs["max_slope_deg"] is not None:
            return f"its steepest part is {mine['max_slope_deg']:.0f}°, against {theirs['max_slope_deg']:.0f}°"
        return None
    if key == "climb":
        return f"it climbs {mine['climb_m']:.0f} m, against {theirs['climb_m']:.0f} m"
    if _percent_text(mine["rough_percent"]) != _percent_text(theirs["rough_percent"]):
        return (
            f"{_percent_text(mine['rough_percent'])} of it is on bumpy ground, "
            f"against {_percent_text(theirs['rough_percent'])}"
        )
    return f"it crosses {mine['pit_m']:.0f} m of pits, against {theirs['pit_m']:.0f} m"


def recommendation_text(routes: list[dict[str, Any]]) -> str:
    """One or two plain sentences that say why rank 1 is recommended. Every number comes from the stats."""
    top = routes[0]
    took = format_duration(top["stats"]["walk_time_s"])
    if len(routes) == 1:
        return f"It is the only route to show between these two points. It takes {took}, and {_steep_clause(top['stats'])}."
    if "time" in top["best_at"]:
        first = f"It takes {took}, the least of the {len(routes)} routes, and {_steep_clause(top['stats'])}."
    else:
        first = (
            f"It has the highest score of the {len(routes)} routes: "
            f"it takes {took}, and {_steep_clause(top['stats'])}."
        )
    runner = routes[1]
    runner_took = format_duration(runner["stats"]["walk_time_s"])
    weak = _weak_point(runner, top)
    if runner["stats"]["walk_time_s"] < top["stats"]["walk_time_s"]:
        second = f"{runner['name']} is quicker ({runner_took})"
        second += f", but {weak}." if weak else "."
    else:
        second = f"{runner['name']} comes next. It takes {runner_took}"
        second += f", and {weak}." if weak else "."
    return f"{first} {second}"


# ---------------------------------------------------------------------------
# The whole request
# ---------------------------------------------------------------------------


def settings(grid: DemGrid) -> dict[str, Any]:
    """The setting numbers, for the frontend to show. The settings of /api/route plus the new ones."""
    values = routing.settings(grid)
    values.update(
        rough_m=terrain.ROUGH_M,
        pit_depth_m=terrain.PIT_DEPTH_M,
        pit_max_area_km2=terrain.PIT_MAX_AREA_KM2,
        corridor_m=CORRIDOR_M,
        corridor_cost_factor=CORRIDOR_COST_FACTOR,
        flattest_max_slope_deg=FLATTEST_MAX_SLOPE_DEG,
        flattest_penalty_deg=FLATTEST_PENALTY_DEG,
        rough_cost_scale_m=ROUGH_COST_SCALE_M,
        pit_cost_factor=PIT_COST_FACTOR,
        lookalike_cell_share=LOOKALIKE_CELL_SHARE,
        point_spacing_m=POINT_SPACING_M,
        fastest_method=FASTEST_METHOD,
    )
    return values


def _not_found(candidate_id: str) -> dict[str, str]:
    definition = CANDIDATE_BY_ID[candidate_id]
    return {
        "id": definition["id"],
        "name": definition["name"],
        "reason": (
            f"Ground steeper than {definition['max_slope_deg']:g}° or ground with no height data "
            "blocks every way between these two points."
        ),
    }


def find_fastest(
    grid: DemGrid, facts: GroundFacts, start: Cell, goal: Cell, margin_cells: int | None
) -> tuple[dict[str, Any] | None, str]:
    """The "Fastest" candidate. Returns (route or None, the method that made the returned line).

    The grid search with the cell-steepness cost always runs first.
    With FASTEST_METHOD = "direction-aware" the direction-aware search runs after it.
    Both lines are measured with the same yardstick. The one with the lower walk time is used.
    """
    found = search_candidate(grid, facts, "fastest", start, goal, margin_cells)
    if found is None:
        return None, "cell-steepness"
    path, corners, window = found
    route = build_route(grid, facts, "fastest", corners)
    if FASTEST_METHOD != "direction-aware":
        return route, "cell-steepness"
    aware = direction_aware_path(grid, facts, start, goal, window, path)
    if aware is None:
        return route, "cell-steepness"
    aware_route = build_route(grid, facts, "fastest", aware[1])
    if aware_route["stats"]["walk_time_s"] < route["stats"]["walk_time_s"]:
        return aware_route, "direction-aware"
    return route, "cell-steepness"


def plan_candidates(
    grid: DemGrid,
    start: Cell,
    goal: Cell,
    facts: GroundFacts | None = None,
    margin_cells: int | None = None,
) -> dict[str, Any]:
    """Search, measure, compare and rank the candidates between two cells given as (row, col).

    Returns the keys 'routes', 'not_found', 'dropped', 'recommendation' and 'fastest_used'.
    """
    if facts is None:
        facts = terrain.cached_ground_facts(grid)
    sampling = routing.ground_cell_sizes(grid)
    not_found: list[dict[str, str]] = []
    dropped: list[dict[str, str]] = []
    fastest_used = "cell-steepness"

    # 1. Search the first five candidates and measure them.
    kept: list[dict[str, Any]] = []
    lower_slope_found = False
    for definition in CANDIDATES:
        candidate_id = definition["id"]
        if candidate_id == "alternative":
            continue
        if candidate_id == "fastest":
            route, fastest_used = find_fastest(grid, facts, start, goal, margin_cells)
        else:
            found = search_candidate(grid, facts, candidate_id, start, goal, margin_cells)
            route = None if found is None else build_route(grid, facts, candidate_id, found[1])
        if route is None:
            not_found.append(_not_found(candidate_id))
            continue
        if candidate_id == "lower_slope":
            lower_slope_found = True
        # 2. Merge look-alikes into the earlier route.
        twin = next((r for r in kept if are_lookalikes(route, r)), None)
        if twin is not None:
            twin["also"].append(route["name"])
            twin["_merged"].append((route["id"], route["name"]))
        else:
            kept.append(route)

    # 3. Drop the routes that are not better than another one on any measure.
    kept = drop_not_better(kept, dropped)

    # 4. "Another way": make the ground near the best route so far more expensive and search again.
    #    It has the blocked cells of "Lower-slope". If that one found no way, this one cannot either.
    if not lower_slope_found:
        not_found.append(_not_found("alternative"))
    else:
        score_routes(kept)
        expensive = corridor_mask(grid.heights.shape, kept[0]["_cells"], sampling, CORRIDOR_M)
        found = search_candidate(grid, facts, "alternative", start, goal, margin_cells, expensive)
        if found is None:
            not_found.append(_not_found("alternative"))
        else:
            route = build_route(grid, facts, "alternative", found[1])
            twin = next((r for r in kept if are_lookalikes(route, r)), None)
            if twin is not None:
                # It is not merged into 'also'. "Also another way" on the same line would make no sense.
                dropped.append(
                    {
                        "id": route["id"],
                        "name": route["name"],
                        "reason": f"No clearly different way was found. It is almost the same line as the {twin['name']} route.",
                    }
                )
            else:
                kept.append(route)
                kept = drop_not_better(kept, dropped)

    # 5. Score and rank the routes that are left.
    score_routes(kept)
    recommendation = None
    if kept:
        recommendation = {"id": kept[0]["id"], "why": recommendation_text(kept)}
    routes = [{key: value for key, value in route.items() if not key.startswith("_")} for route in kept]
    order = {definition["id"]: position for position, definition in enumerate(CANDIDATES)}
    not_found.sort(key=lambda item: order[item["id"]])
    dropped.sort(key=lambda item: order[item["id"]])
    return {
        "routes": routes,
        "not_found": not_found,
        "dropped": dropped,
        "recommendation": recommendation,
        "fastest_used": fastest_used,
    }


def compute_candidates(grid: DemGrid, from_lon: float, from_lat: float, to_lon: float, to_lat: float) -> dict[str, Any]:
    """Answer one request. This is the body of GET /api/routes.

    Raises RouteError with code 'outside' or 'same_point', like /api/route.
    """
    started = time.perf_counter()
    start, start_height = routing._locate(grid, from_lon, from_lat, "start")
    goal, goal_height = routing._locate(grid, to_lon, to_lat, "end")
    if start == goal:
        raise RouteError(
            "same_point",
            f"The start point and the end point are in the same {round(grid.cell_x_m)} m cell. "
            "Pick two points that are further apart.",
        )
    plan = plan_candidates(grid, start, goal)
    values = settings(grid)
    # 'fastest_method' says how the returned "Fastest" line of THIS answer was made.
    values["fastest_method"] = plan["fastest_used"]
    return {
        "status": "ok",
        "start": {"lon": from_lon, "lat": from_lat, "elevation_m": round(start_height, 1)},
        "goal": {"lon": to_lon, "lat": to_lat, "elevation_m": round(goal_height, 1)},
        "settings": values,
        "weights": dict(SCORE_WEIGHTS),
        "routes": plan["routes"],
        "not_found": plan["not_found"],
        "dropped": plan["dropped"],
        "recommendation": plan["recommendation"],
        "compute_ms": round((time.perf_counter() - started) * 1000),
    }
