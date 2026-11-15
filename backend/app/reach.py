"""The walking-time map: from one start point, the estimated walking time to every cell.

This is the body of GET /api/reach.
One grid search (MCP_Geometric 'find_costs') runs over the whole grid, with the cost of the
"Fastest" candidate (see candidates.raw_cost). The answer is a picture with time bands as rings.

The time is an ESTIMATE, with the same speeds and assumptions as 'walk_time_s' in routing.py.
One more limit: the grid search cannot know the walking direction.
It uses the steepness of each cell both ways, as if every step went uphill.
So the times on this map are a little longer than the direction-aware 'walk_time_s' of a route.
"""

from __future__ import annotations

import base64
import io
import math
import time
from typing import Any

import numpy as np
from PIL import Image
from skimage.graph import MCP_Geometric

from . import candidates, routing, terrain
from .dem import DemGrid
from .terrain import GroundFacts

# The upper ends of the time bands in seconds: 30 min, 1 h, 2 h, 4 h, 8 h. OUR CHOICE.
# Cells further away than the last band get one more colour ("More than 8 h").
BANDS_S = (1800, 3600, 7200, 14400, 28800)

# One colour per band, from light (near) to dark (far). The last one is for "more than 8 h".
# It is the "YlGnBu" ramp of ColorBrewer with 6 steps. It also works for colour-blind readers,
# because the steps go from light to dark and do not rely on red against green.
BAND_COLORS = ("#ffffcc", "#c7e9b4", "#7fcdbb", "#41b6c4", "#2c7fb8", "#253494")

# How solid the colours are, from 0 (clear) to 1 (solid). Cells with no way are fully clear.
IMAGE_ALPHA = 0.6

# The picture has one pixel for every 2nd cell in each direction. This keeps it small.
IMAGE_STEP = 2


def band_label(seconds: int) -> str:
    """A band end as plain text: '30 min' or '2 h'."""
    if seconds < 3600:
        return f"{seconds // 60} min"
    return f"{seconds / 3600:g} h"


def legend() -> list[dict[str, Any]]:
    """The colours of the bands, for the frontend to show. The last entry has no upper end."""
    items: list[dict[str, Any]] = [
        {"up_to_s": end, "color": color, "label": band_label(end)} for end, color in zip(BANDS_S, BAND_COLORS)
    ]
    items.append({"up_to_s": None, "color": BAND_COLORS[-1], "label": f"More than {band_label(BANDS_S[-1])}"})
    return items


def time_grid_s(grid: DemGrid, facts: GroundFacts, start: tuple[int, int]) -> np.ndarray:
    """Estimated walking time in seconds from the start cell to every cell. Infinity where there is no way.

    The cost of a cell is the "Fastest" cost: the time to cross it, in flat-ground metres.
    So the total cost of a way divided by the flat walking speed is its time in seconds.
    Blocked cells are those of "Fastest": steeper than 30 degrees, or no data. The start is always usable.
    """
    shape = grid.heights.shape
    whole = (0, shape[0], 0, shape[1])
    cost = candidates.window_cost(grid, facts, "fastest", whole, start, start)
    mcp = MCP_Geometric(cost, sampling=routing.ground_cell_sizes(grid), fully_connected=True)
    totals, _traceback = mcp.find_costs([start])
    return totals / candidates.base_walk_speed_m_s()


def band_image(times_s: np.ndarray) -> np.ndarray:
    """An RGBA picture of the time bands. Row 0 is the north edge, like the grid.

    Every band has one flat colour, so the band ends show as rings.
    Cells with no way are fully clear.
    """
    small = times_s[::IMAGE_STEP, ::IMAGE_STEP]
    reachable = np.isfinite(small)
    band = np.searchsorted(np.array(BANDS_S, dtype=np.float64), np.where(reachable, small, 0.0), side="left")
    colors = np.array([[int(c[i : i + 2], 16) for i in (1, 3, 5)] for c in BAND_COLORS], dtype=np.uint8)
    image = np.zeros(small.shape + (4,), dtype=np.uint8)
    image[..., :3] = colors[band]
    image[..., 3] = np.where(reachable, int(round(IMAGE_ALPHA * 255)), 0)
    image[~reachable, :3] = 0
    return image


def png_data_url(image: np.ndarray) -> tuple[str, int]:
    """Encode an RGBA picture as a PNG data URL. Returns (the URL, the size of the PNG in bytes)."""
    buffer = io.BytesIO()
    Image.fromarray(image).save(buffer, format="PNG", optimize=True)
    data = buffer.getvalue()
    return "data:image/png;base64," + base64.b64encode(data).decode("ascii"), len(data)


def compute_reach(grid: DemGrid, lon: float, lat: float) -> dict[str, Any]:
    """Answer one request. This is the body of GET /api/reach.

    Raises routing.RouteError with code 'outside' if the point is not on the height map.
    """
    started = time.perf_counter()
    start, start_height = routing._locate(grid, lon, lat, "start")
    facts = terrain.cached_ground_facts(grid)
    times = time_grid_s(grid, facts, start)

    reachable = np.isfinite(times)
    with_data = np.isfinite(grid.heights)
    # The share of the cells with a height that have no way from the start.
    no_way = int((with_data & ~reachable).sum())
    unreachable_percent = 100.0 * no_way / max(int(with_data.sum()), 1)
    image, png_bytes = png_data_url(band_image(times))
    return {
        "status": "ok",
        "start": {"lon": lon, "lat": lat, "elevation_m": round(start_height, 1)},
        # The edges of the whole grid as [west, south, east, north]. The picture covers this area.
        # Its pixels are every 2nd cell, so it can be up to one cell (20 m) off at the east and south edge.
        "bounds": [round(v, 6) for v in grid.bounds_deg()],
        "max_time_s": round(float(times[reachable].max())),
        "bands_s": list(BANDS_S),
        "unreachable_percent": round(unreachable_percent, 2),
        "legend": legend(),
        "image": image,
        "image_width": int(math.ceil(grid.heights.shape[1] / IMAGE_STEP)),
        "image_height": int(math.ceil(grid.heights.shape[0] / IMAGE_STEP)),
        "image_bytes": png_bytes,
        "image_alpha": IMAGE_ALPHA,
        # How the times were made. See the top of this file.
        "method": "cell-steepness",
        "settings": {
            "max_slope_deg": candidates.CANDIDATE_BY_ID["fastest"]["max_slope_deg"],
            "walk_speed_m_s": routing.WALK_SPEED_M_S,
            "suit_factor": routing.SUIT_FACTOR,
            "load_factor": routing.LOAD_FACTOR,
        },
        "compute_ms": round((time.perf_counter() - started) * 1000),
    }
