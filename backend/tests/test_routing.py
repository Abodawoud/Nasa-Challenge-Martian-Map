"""Tests for app/routing.py.

They use small synthetic grids. They never download or read the real DEM.
Run from the backend folder: python -m pytest tests
"""

import math

import numpy as np
import pytest
from affine import Affine
from skimage.graph import MCP_Geometric

from app import routing
from app.dem import MARS_RADIUS_M, DemGrid, horn_slope_deg

CELL = 20.0


def make_grid(heights: np.ndarray, middle_lat_deg: float = 0.0, left_m: float = 4_573_660.0) -> DemGrid:
    """A grid whose middle row sits on 'middle_lat_deg'. At latitude 0 a cell is 20 m by 20 m."""
    rows = heights.shape[0]
    top = MARS_RADIUS_M * math.radians(middle_lat_deg) + rows * CELL / 2.0
    return DemGrid(heights=heights.astype(np.float32), transform=Affine(CELL, 0.0, left_m, 0.0, -CELL, top))


def routes_for(grid: DemGrid, start, goal, **kwargs):
    slope = routing.slope_grid_deg(grid.heights, *reversed(routing.ground_cell_sizes(grid)))
    a, b = routing.plan_routes(grid, start, goal, slope_deg=slope, **kwargs)
    return a, b


def cells_of(grid: DemGrid, route) -> list[tuple[int, int]]:
    """Turn the lon/lat points of a route back into (row, col)."""
    cells = []
    for lon, lat, _h in route["points"]:
        col, row = (~grid.transform) * (MARS_RADIUS_M * math.radians(lon), MARS_RADIUS_M * math.radians(lat))
        cells.append((int(math.floor(row)), int(math.floor(col))))
    return cells


# --- skimage facts we rely on -------------------------------------------------


@pytest.mark.parametrize("blocked", [-1.0, np.inf])
def test_skimage_treats_negative_and_infinite_costs_as_walls(blocked):
    cost = np.ones((5, 7))
    cost[:, 3] = blocked
    mcp = MCP_Geometric(cost, fully_connected=True)
    totals, _ = mcp.find_costs([(2, 0)], [(2, 6)])
    assert math.isinf(totals[2, 6])
    # With one open cell in the wall the path goes through it.
    cost[0, 3] = 1.0
    assert routing.least_cost_path(cost, (2, 0), (2, 6), (1.0, 1.0)) is not None
    assert (0, 3) in routing.least_cost_path(cost, (2, 0), (2, 6), (1.0, 1.0))


def test_blocked_cost_gives_no_path():
    cost = np.ones((5, 7))
    cost[:, 3] = routing.BLOCKED_COST
    assert routing.least_cost_path(cost, (2, 0), (2, 6), (1.0, 1.0)) is None


def test_sampling_gives_real_step_lengths():
    cost = np.ones((4, 4))
    mcp = MCP_Geometric(cost, sampling=(20.0, 10.0), fully_connected=True)
    totals, _ = mcp.find_costs([(0, 0)])
    assert totals[0, 1] == pytest.approx(10.0)
    assert totals[1, 0] == pytest.approx(20.0)
    assert totals[1, 1] == pytest.approx(math.hypot(20.0, 10.0))


# --- slope grid ---------------------------------------------------------------


def test_slope_grid_matches_the_single_cell_function():
    rng = np.random.default_rng(1)
    heights = rng.uniform(0.0, 50.0, size=(6, 7))
    slope = routing.slope_grid_deg(heights, 19.0, 20.0)
    for r in range(1, 5):
        for c in range(1, 6):
            expected = horn_slope_deg(heights[r - 1 : r + 2, c - 1 : c + 2], 19.0, 20.0)
            assert slope[r, c] == pytest.approx(expected, rel=1e-5)


def test_slope_grid_border_and_missing_data_are_nan():
    heights = np.zeros((6, 6))
    heights[3, 3] = np.nan
    slope = routing.slope_grid_deg(heights, 20.0, 20.0)
    assert np.isnan(slope[0, :]).all() and np.isnan(slope[-1, :]).all()
    assert np.isnan(slope[:, 0]).all() and np.isnan(slope[:, -1]).all()
    assert np.isnan(slope[2:5, 2:5]).all()
    assert slope[1, 1] == 0.0


# --- flat ground --------------------------------------------------------------


def test_flat_grid_gives_a_straight_path_with_the_right_length():
    grid = make_grid(np.zeros((12, 16)))
    a, b = routes_for(grid, (5, 2), (5, 12))
    for route in (a, b):
        assert route["found"] is True and route["reason"] is None
        assert cells_of(grid, route) == [(5, c) for c in range(2, 13)]
        assert route["stats"]["distance_m"] == pytest.approx(200.0, abs=0.05)
        assert route["stats"]["flat_distance_m"] == pytest.approx(200.0, abs=0.05)
        assert route["stats"]["climb_m"] == 0 and route["stats"]["descent_m"] == 0
        assert route["stats"]["steep_percent"] == 0
        assert route["warnings"] == []
        assert len(route["profile"]["distance_m"]) == len(route["points"]) == 11
        assert route["profile"]["distance_m"][0] == 0 and route["profile"]["distance_m"][-1] == 200.0
    assert (a["id"], a["name"], b["id"], b["name"]) == ("a", "Shortest", "b", "Lower-slope")


def test_flat_diagonal_path_length():
    grid = make_grid(np.zeros((12, 12)))
    a, _b = routes_for(grid, (2, 2), (8, 8))
    assert a["stats"]["distance_m"] == pytest.approx(6 * 20.0 * math.sqrt(2.0), abs=0.05)


def test_walk_time_on_flat_ground_is_distance_over_speed():
    grid = make_grid(np.zeros((12, 16)))
    a, _b = routes_for(grid, (5, 2), (5, 12))
    assert a["stats"]["walk_time_s"] == round(200.0 / (0.9 * 0.6))
    assert a["stats"]["rover_time_s"] == round(200.0 / (152.0 / 3600.0))


def test_east_west_cells_are_shorter_away_from_the_equator():
    # At latitude 60 a cell is 20 m north-south but only 10 m east-west.
    grid = make_grid(np.zeros((11, 16)), middle_lat_deg=60.0)
    a, _b = routes_for(grid, (5, 2), (5, 12))
    assert a["stats"]["distance_m"] == pytest.approx(100.0, abs=0.05)
    a, _b = routes_for(grid, (2, 5), (8, 5))
    assert a["stats"]["distance_m"] == pytest.approx(120.0, abs=0.05)


# --- tilted plane -------------------------------------------------------------


def test_stats_on_a_tilted_plane_match_hand_numbers():
    # The ground rises 2 m per 20 m cell to the east. Slope = atan(0.1) = 5.7106 degrees.
    heights = np.tile(np.arange(16) * 2.0, (12, 1))
    grid = make_grid(heights)
    a, _b = routes_for(grid, (5, 2), (5, 12))
    stats = a["stats"]
    step = math.hypot(20.0, 2.0)
    assert cells_of(grid, a) == [(5, c) for c in range(2, 13)]
    assert stats["distance_m"] == pytest.approx(10 * step, abs=0.05)  # 200.998
    assert stats["flat_distance_m"] == pytest.approx(200.0, abs=0.05)
    assert stats["climb_m"] == pytest.approx(20.0, abs=0.05)
    assert stats["descent_m"] == 0
    assert stats["max_slope_deg"] == pytest.approx(5.7, abs=0.05)
    assert stats["mean_slope_deg"] == pytest.approx(5.7, abs=0.05)
    assert stats["steep_percent"] == 0
    # Uphill with s = 0.1 the slope factor is exp(-3.5 * 0.15) / exp(-3.5 * 0.05) = exp(-0.35).
    assert stats["walk_time_s"] == round(10 * step / (0.9 * 0.6 * math.exp(-0.35)))
    assert a["profile"]["elevation_m"] == [c * 2.0 for c in range(2, 13)]
    assert a["profile"]["slope_deg"] == [5.7] * 11
    assert a["points"][0][2] == 4.0 and a["points"][-1][2] == 24.0

    # The other way it is all descent. Downhill with s = -0.1 the factor is exp(-0.175) / exp(-0.175) = 1.
    back, _b = routes_for(grid, (5, 12), (5, 2))
    assert back["stats"]["climb_m"] == 0
    assert back["stats"]["descent_m"] == pytest.approx(20.0, abs=0.05)
    assert back["stats"]["walk_time_s"] == round(10 * step / (0.9 * 0.6))


def test_steep_percent_and_warnings_on_a_steep_plane():
    # 6 m per 20 m cell = 16.7 degrees. Steeper than 15, under both limits.
    heights = np.tile(np.arange(16) * 6.0, (12, 1))
    grid = make_grid(heights)
    a, _b = routes_for(grid, (5, 2), (5, 12))
    assert a["stats"]["steep_percent"] == 100.0
    assert a["warnings"] == ["100% of this route is steeper than 15°.", "The steepest part is 17°."]


# --- walls --------------------------------------------------------------------


def wall_grid(gap_rows: range | None) -> DemGrid:
    heights = np.zeros((30, 30))
    heights[:, 15] = 500.0
    if gap_rows is not None:
        heights[gap_rows.start : gap_rows.stop, 15] = 0.0
    return make_grid(heights)


def test_a_wall_with_a_gap_forces_a_detour():
    grid = wall_grid(range(20, 27))
    a, b = routes_for(grid, (5, 5), (5, 25))
    for route in (a, b):
        assert route["found"] is True
        cells = cells_of(grid, route)
        crossing = [r for r, c in cells if c == 15]
        assert crossing and all(21 <= r <= 25 for r in crossing)
        assert route["stats"]["flat_distance_m"] > 600.0  # the straight line is 400 m
        assert route["stats"]["max_slope_deg"] == 0


def test_a_wall_with_no_gap_gives_not_found():
    grid = wall_grid(None)
    a, b = routes_for(grid, (5, 5), (5, 25))
    for route, limit in ((a, "30°"), (b, "25°")):
        assert route["found"] is False
        assert limit in route["reason"]
        assert route["points"] == []
        assert route["profile"] == {"distance_m": [], "elevation_m": [], "slope_deg": []}
        assert route["stats"] is None
        assert route["warnings"] == []


def test_the_whole_grid_is_searched_when_the_cut_area_has_no_way():
    # The only gap is far from the two points. A margin of 2 cells does not reach it.
    grid = wall_grid(range(20, 27))
    slope = routing.slope_grid_deg(grid.heights, 20.0, 20.0)
    path, whole = routing.find_path(grid, slope, (5, 5), (5, 25), 30.0, False, margin_cells=2)
    assert path is not None and whole is True
    path, whole = routing.find_path(grid, slope, (5, 5), (5, 25), 30.0, False, margin_cells=20)
    assert path is not None and whole is False


def test_crop_window_margin():
    assert routing.crop_window((500, 500), (510, 520), (1596, 1512)) == (350, 661, 350, 671)
    # A long route gets half of its longer side as margin: 600 cells apart gives 300.
    assert routing.crop_window((100, 400), (700, 500), (1596, 1512)) == (0, 1001, 100, 801)


# --- Route B avoids a ramp ----------------------------------------------------


def ridge_grid() -> DemGrid:
    # A ridge across the top half. It rises 7 m per cell (19 degrees) for 3 cells and falls again.
    heights = np.zeros((34, 31))
    tent = np.array([7.0, 14.0, 21.0, 28.0, 21.0, 14.0, 7.0])
    heights[:16, 12:19] = tent
    return make_grid(heights)


def test_route_b_goes_around_a_ramp_that_route_a_crosses():
    grid = ridge_grid()
    a, b = routes_for(grid, (5, 5), (5, 25))
    assert a["found"] and b["found"]
    assert all(r == 5 for r, _c in cells_of(grid, a))
    assert a["stats"]["max_slope_deg"] > 15.0
    assert a["stats"]["climb_m"] == pytest.approx(28.0, abs=0.05)
    assert max(r for r, _c in cells_of(grid, b)) >= 17
    assert b["stats"]["max_slope_deg"] < a["stats"]["max_slope_deg"]
    assert b["stats"]["max_slope_deg"] < 10.0
    assert b["stats"]["distance_m"] > a["stats"]["distance_m"]
    assert b["stats"]["steep_percent"] == 0
    assert a["stats"]["steep_percent"] > 0


# --- start and goal -----------------------------------------------------------


def test_start_and_goal_are_usable_on_ground_over_the_limit():
    # A 3 cell wide band of 35 degree ground. Start in the middle of it.
    heights = np.zeros((20, 30))
    heights[:, 10:] = 14.0
    heights[:, 11:] = 28.0
    heights[:, 12:] = 42.0
    grid = make_grid(heights)
    slope = routing.slope_grid_deg(grid.heights, 20.0, 20.0)
    assert slope[10, 11] > 30.0
    a, _b = routes_for(grid, (10, 11), (10, 25))
    assert a["found"] is True
    assert "The start point is on ground steeper than the limit of this route." in a["warnings"]
    # A point on the far side of the band cannot be reached: the band is a wall.
    far, _b = routes_for(grid, (10, 3), (10, 25))
    assert far["found"] is False


# --- the whole request --------------------------------------------------------


def lonlat_of(grid: DemGrid, row: float, col: float) -> tuple[float, float]:
    x, y = grid.transform * (col + 0.5, row + 0.5)
    return math.degrees(x / MARS_RADIUS_M), math.degrees(y / MARS_RADIUS_M)


def test_compute_routes_answer_shape():
    grid = make_grid(np.tile(np.arange(16) * 2.0, (12, 1)))
    lon0, lat0 = lonlat_of(grid, 5, 2)
    lon1, lat1 = lonlat_of(grid, 5, 12)
    answer = routing.compute_routes(grid, lon0, lat0, lon1, lat1)
    assert answer["status"] == "ok"
    assert answer["start"] == {"lon": lon0, "lat": lat0, "elevation_m": 4.0}
    assert answer["goal"] == {"lon": lon1, "lat": lat1, "elevation_m": 24.0}
    assert answer["settings"] == {
        "resolution_m": 20,
        "route_a_max_slope_deg": 30,
        "route_b_max_slope_deg": 25,
        "slope_penalty_deg": 10,
        "steep_deg": 15,
        "walk_speed_m_s": 0.9,
        "suit_factor": 0.6,
        "load_factor": 1.0,
        "rover_speed_m_per_hour": 152,
    }
    assert [r["id"] for r in answer["routes"]] == ["a", "b"]
    assert isinstance(answer["compute_ms"], int)
    first = answer["routes"][0]["points"][0]
    assert first[0] == pytest.approx(lon0, abs=1e-6) and first[1] == pytest.approx(lat0, abs=1e-6)
    assert answer["routes"][0]["points"][-1][0] == pytest.approx(lon1, abs=1e-6)


def test_compute_routes_rejects_points_outside_or_on_no_data():
    heights = np.zeros((12, 16))
    heights[8, 8] = np.nan
    grid = make_grid(heights)
    inside = lonlat_of(grid, 3, 3)
    with pytest.raises(routing.RouteError) as info:
        routing.compute_routes(grid, inside[0], inside[1], inside[0] + 5.0, inside[1])
    assert info.value.code == "outside" and "end point" in info.value.detail
    assert "Jezero Crater only" in info.value.detail
    hole = lonlat_of(grid, 8, 8)
    with pytest.raises(routing.RouteError) as info:
        routing.compute_routes(grid, hole[0], hole[1], inside[0], inside[1])
    assert info.value.code == "outside" and "start point" in info.value.detail


def test_compute_routes_rejects_the_same_cell():
    grid = make_grid(np.zeros((12, 16)))
    lon, lat = lonlat_of(grid, 5, 5)
    with pytest.raises(routing.RouteError) as info:
        routing.compute_routes(grid, lon, lat, lon + 1e-5, lat)
    assert info.value.code == "same_point"
