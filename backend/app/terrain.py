"""Ground facts of the height grid: slope, roughness and pits.

Every fact is one number per cell. They are worked out once per grid and kept in memory.
The route candidates (app/candidates.py) and the walking-time map (app/reach.py) use them.

The maths needs only a DemGrid. The tests use small synthetic grids.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Any

import numpy as np
from scipy import ndimage
from skimage.morphology import reconstruction

from . import routing
from .dem import DemGrid

# ---------------------------------------------------------------------------
# Settings. They are OUR CHOICE. They are not NASA limits.
# ---------------------------------------------------------------------------

# A cell counts as "rough" (bumpy) when its roughness is over this many metres.
# Roughness is the spread of the 3x3 heights around their best-fit plane (see roughness_grid_m).
# How we chose it: we looked at the real Jezero grid (1512 x 1596 cells, all with a height).
# Measured percentiles of roughness in metres:
# 50% = 0.13, 75% = 0.21, 90% = 0.33, 95% = 0.44, 97% = 0.53, 99% = 0.75, 99.9% = 1.40.
# Measured share of cells over a limit: 0.3 m = 12.7%, 0.4 m = 6.4%, 0.5 m = 3.5%.
# We take 0.4 m. About the bumpiest 6% of the ground then counts as rough.
# The grid has 20 m cells. It cannot see single rocks. This is bumpiness at the 20 m scale only.
ROUGH_M = 0.4

# A cell counts as a "pit" when it lies more than this many metres under the rim of a closed dip.
# Measured share of cells of the real grid in a closed dip deeper than a limit:
# 0.5 m = 14.7%, 1 m = 12.9%, 2 m = 10.5%, 5 m = 7.0%, 10 m = 4.4%.
# We take 2 m. A shallower dip is small next to the 20 m cell and can be noise in the heights.
PIT_DEPTH_M = 2.0

# A closed dip counts as a pit only if its area (the part deeper than PIT_DEPTH_M) is at most this.
# Why: on the real grid the 14 biggest dips hold 6.5% of all cells. They are wide basins.
# The biggest one is 19 km2: the lowest part of the crater floor. A walker does not see it as a hole.
# Without this limit a walk over the flat crater floor would count as kilometres "in a pit".
# With the limit 4.0% of the cells of the real grid count as pit cells (measured).
PIT_MAX_AREA_KM2 = 1.0


# ---------------------------------------------------------------------------
# Roughness
# ---------------------------------------------------------------------------


def roughness_grid_m(heights: np.ndarray) -> np.ndarray:
    """Roughness in metres for every cell: how bumpy the ground is apart from its tilt.

    For every cell we take its 3x3 window of heights.
    We fit the best plane through the 9 heights (least squares) and take it away.
    The roughness is the standard deviation of what is left.
    A smooth tilted slope gives 0. A bumpy patch gives a number above 0.

    The fit uses cell numbers, not metres. A plane in metres is a plane in cell numbers too.
    So the size of a cell does not matter here.
    A cell gets NaN if its 3x3 window is not complete (border, or next to missing data).
    """
    z = heights.astype(np.float64)
    rough = np.full(z.shape, np.nan, dtype=np.float32)
    if z.shape[0] < 3 or z.shape[1] < 3:
        return rough

    centre = z[1:-1, 1:-1]
    # Take the centre height away first. The numbers stay small and the sums stay exact.
    a, b, c = z[:-2, :-2] - centre, z[:-2, 1:-1] - centre, z[:-2, 2:] - centre
    d, f = z[1:-1, :-2] - centre, z[1:-1, 2:] - centre
    g, h, i = z[2:, :-2] - centre, z[2:, 1:-1] - centre, z[2:, 2:] - centre

    # The plane is: mean + tilt_x * x + tilt_y * y, with x and y in (-1, 0, 1).
    # These three parts do not overlap, so each one is a simple sum.
    mean = (a + b + c + d + f + g + h + i) / 9.0
    tilt_x = ((c + f + i) - (a + d + g)) / 6.0
    tilt_y = ((g + h + i) - (a + b + c)) / 6.0
    squares = a * a + b * b + c * c + d * d + f * f + g * g + h * h + i * i
    left_over = squares - 9.0 * mean * mean - 6.0 * tilt_x * tilt_x - 6.0 * tilt_y * tilt_y
    inner = np.sqrt(np.maximum(left_over, 0.0) / 9.0)
    inner[~np.isfinite(centre)] = np.nan
    rough[1:-1, 1:-1] = inner
    return rough


# ---------------------------------------------------------------------------
# Pits
# ---------------------------------------------------------------------------


def pit_depth_grid_m(heights: np.ndarray) -> np.ndarray:
    """Depth in metres of every cell under the rim of the closed dip it lies in. 0 outside dips.

    This is the classic "fill sinks" method. Think of rain on the ground.
    Water runs off over the border of the grid. Where it cannot run off, it makes a lake.
    The filled grid is the ground with all lakes full. Depth = filled height - ground height.
    The filling is scikit-image's 'reconstruction' by erosion. Water may run to all 8 neighbours.

    Cells with no data act like the border: water can leave through them.
    We do not know the ground there, so we do not call anything next to them a pit.
    Cells with no data get NaN.
    """
    z = heights.astype(np.float64)
    known = np.isfinite(z)
    depth = np.full(z.shape, np.nan, dtype=np.float32)
    if not known.any():
        return depth

    low = float(z[known].min())
    high = float(z[known].max())
    ground = np.where(known, z, low)
    # Start with everything under water up to the highest point.
    # Only the outlets keep their own height: the border and the cells with no data.
    outlet = ~known
    outlet[0, :] = outlet[-1, :] = True
    outlet[:, 0] = outlet[:, -1] = True
    seed = np.full(z.shape, high, dtype=np.float64)
    seed[outlet] = ground[outlet]
    filled = reconstruction(seed, ground, method="erosion", footprint=np.ones((3, 3), dtype=bool))
    depth[known] = (filled - ground)[known]
    return depth


def pit_cells(pit_depth_m: np.ndarray, cell_area_m2: float) -> np.ndarray:
    """True for every cell that counts as a pit.

    A pit cell is deeper than PIT_DEPTH_M under the rim of its closed dip.
    The dip must also be small: the joined area of such cells is at most PIT_MAX_AREA_KM2.
    Cells that touch (also at a corner) belong to the same area.
    """
    with np.errstate(invalid="ignore"):
        deep = pit_depth_m > PIT_DEPTH_M
    labels, count = ndimage.label(deep, structure=np.ones((3, 3), dtype=bool))
    if count == 0:
        return deep
    cells_per_area = np.bincount(labels.ravel(), minlength=count + 1)
    small = cells_per_area * cell_area_m2 <= PIT_MAX_AREA_KM2 * 1.0e6
    small[0] = False
    return small[labels]


# ---------------------------------------------------------------------------
# All facts of one grid, kept in memory
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class GroundFacts:
    """The facts of one grid. Every array has the shape of the grid."""

    slope_deg: np.ndarray
    roughness_m: np.ndarray
    pit_depth_m: np.ndarray
    # True where the cell counts as rough or as a pit. Cells with no value are False.
    rough: np.ndarray
    pit: np.ndarray


def ground_facts(grid: DemGrid, slope_deg: np.ndarray | None = None) -> GroundFacts:
    """Work out the facts of a grid. Not cached. Use cached_ground_facts for the real grid."""
    if slope_deg is None:
        size_y_m, size_x_m = routing.ground_cell_sizes(grid)
        slope_deg = routing.slope_grid_deg(grid.heights, size_x_m, size_y_m)
    roughness = roughness_grid_m(grid.heights)
    pit_depth = pit_depth_grid_m(grid.heights)
    with np.errstate(invalid="ignore"):
        rough = roughness > ROUGH_M
    cell_y_m, cell_x_m = routing.ground_cell_sizes(grid)
    pit = pit_cells(pit_depth, cell_y_m * cell_x_m)
    return GroundFacts(slope_deg=slope_deg, roughness_m=roughness, pit_depth_m=pit_depth, rough=rough, pit=pit)


_facts_lock = threading.Lock()
# Holds (grid, facts) of the last grid. The grid is kept so it is compared by identity.
_facts_cache: list[Any] = []


def cached_ground_facts(grid: DemGrid) -> GroundFacts:
    """The facts of 'grid'. Worked out once and then kept in memory."""
    with _facts_lock:
        if _facts_cache and _facts_cache[0] is grid:
            return _facts_cache[1]
        facts = ground_facts(grid, routing.cached_slope_grid(grid))
        _facts_cache[:] = [grid, facts]
        return facts
