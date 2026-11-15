"""Tests for app/terrain.py, app/candidates.py and app/reach.py.

They use small synthetic grids. They never download or read the real DEM.
Run from the backend folder: python -m pytest tests
"""

import base64
import io
import math
import re

import numpy as np
import pytest
from affine import Affine
from PIL import Image

from app import candidates, reach, routing, terrain
from app.dem import MARS_RADIUS_M, DemGrid

CELL = 20.0


def make_grid(heights: np.ndarray) -> DemGrid:
    """A grid whose middle row sits on latitude 0. There a cell is 20 m by 20 m."""
    rows = heights.shape[0]
    top = rows * CELL / 2.0
    return DemGrid(heights=heights.astype(np.float32), transform=Affine(CELL, 0.0, 4_573_660.0, 0.0, -CELL, top))


def lonlat_of(grid: DemGrid, row: float, col: float) -> tuple[float, float]:
    x, y = grid.transform * (col + 0.5, row + 0.5)
    return math.degrees(x / MARS_RADIUS_M), math.degrees(y / MARS_RADIUS_M)


def plan(grid: DemGrid, start, goal):
    return candidates.plan_candidates(grid, start, goal, facts=terrain.ground_facts(grid))


def by_id(answer) -> dict:
    return {r["id"]: r for r in answer["routes"]}


def ridge_grid() -> DemGrid:
    # A ridge across the top half. It rises 7 m per cell (19 degrees) for 3 cells and falls again.
    heights = np.zeros((34, 31))
    heights[:16, 12:19] = np.array([7.0, 14.0, 21.0, 28.0, 21.0, 14.0, 7.0])
    return make_grid(heights)


def two_gap_grid() -> DemGrid:
    # A wall from north to south with two gaps. The north gap is nearer to the two points.
    heights = np.zeros((60, 60))
    heights[:, 30] = 500.0
    heights[8:15, 30] = 0.0
    heights[44:51, 30] = 0.0
    return make_grid(heights)


# --- roughness ----------------------------------------------------------------


def test_roughness_is_zero_on_a_tilted_plane():
    rows, cols = np.mgrid[0:12, 0:16]
    rough = terrain.roughness_grid_m(3.0 * cols + 1.5 * rows - 2500.0)
    assert np.isnan(rough[0, :]).all() and np.isnan(rough[:, -1]).all()
    assert np.nanmax(rough) == pytest.approx(0.0, abs=1e-4)


def test_roughness_is_clearly_above_zero_on_a_bumpy_patch():
    rows, cols = np.mgrid[0:20, 0:20]
    heights = 2.0 * cols.astype(float)
    # A checkerboard of plus and minus 1 m in one corner.
    heights[2:8, 2:8] += np.where((rows[2:8, 2:8] + cols[2:8, 2:8]) % 2 == 0, 1.0, -1.0)
    rough = terrain.roughness_grid_m(heights)
    assert rough[4:6, 4:6].min() > 0.8
    assert rough[12:18, 12:18].max() == pytest.approx(0.0, abs=1e-4)


def test_roughness_of_one_bump_matches_the_hand_number():
    heights = np.zeros((5, 5))
    heights[2, 2] = 9.0
    # The window around the bump: mean 1, no tilt. Left over = 81 - 9 * 1 = 72. Root of 72 / 9 = 2.828.
    assert terrain.roughness_grid_m(heights)[2, 2] == pytest.approx(math.sqrt(8.0), rel=1e-5)


def test_roughness_next_to_missing_data_is_nan():
    heights = np.zeros((6, 6))
    heights[3, 3] = np.nan
    assert np.isnan(terrain.roughness_grid_m(heights)[2:5, 2:5]).all()


# --- pits ---------------------------------------------------------------------


def test_pits_are_found_in_a_bowl_and_not_on_a_plane():
    rows, cols = np.mgrid[0:30, 0:30]
    plane = 2.0 * cols.astype(float)
    assert terrain.pit_depth_grid_m(plane).max() == 0.0

    heights = np.full((30, 30), 100.0)
    bowl = np.hypot(rows - 15, cols - 15)
    heights[bowl <= 5] = 100.0 - 2.0 * (5 - bowl[bowl <= 5])  # 10 m deep in the middle
    depth = terrain.pit_depth_grid_m(heights)
    assert depth[15, 15] == pytest.approx(10.0)
    assert depth[2, 2] == 0.0
    facts = terrain.ground_facts(make_grid(heights))
    assert facts.pit[15, 15] and not facts.pit[2, 2]
    # The cells at the rim of the bowl are less than 2 m deep. They are not pit cells.
    assert not facts.pit[15, 20]
    assert not terrain.ground_facts(make_grid(plane)).pit.any()


def test_a_dip_that_drains_over_the_border_or_into_missing_data_is_not_a_pit():
    heights = np.full((20, 20), 50.0)
    heights[8:12, 0:12] = 40.0  # a trench that is open to the west border
    assert terrain.pit_depth_grid_m(heights).max() == 0.0
    heights = np.full((20, 20), 50.0)
    heights[8:12, 8:12] = 40.0
    heights[10, 10] = np.nan
    depth = terrain.pit_depth_grid_m(heights)
    assert np.isnan(depth[10, 10]) and np.nanmax(depth) == 0.0


def test_a_wide_basin_is_not_a_pit():
    depth = np.zeros((40, 40), dtype=np.float32)
    depth[5:35, 5:35] = 5.0  # 900 cells
    assert terrain.pit_cells(depth, cell_area_m2=400.0).sum() == 900  # 0.36 km2
    assert terrain.pit_cells(depth, cell_area_m2=2000.0).sum() == 0  # 1.8 km2


# --- straightening ------------------------------------------------------------


def test_a_corner_to_corner_path_on_flat_ground_becomes_one_straight_line():
    grid = make_grid(np.zeros((40, 80)))
    facts = terrain.ground_facts(grid)
    start, goal = (2, 2), (37, 77)
    path, corners, _window = candidates.search_candidate(grid, facts, "shortest", start, goal)
    assert len(path) > 2 and corners == [start, goal]
    route = candidates.build_route(grid, facts, "shortest", corners)
    straight = math.hypot(35 * CELL, 75 * CELL)
    assert route["stats"]["distance_m"] == pytest.approx(straight, rel=0.01)
    # The points are about 20 m apart and the profile has one entry per point.
    steps = np.diff(route["profile"]["distance_m"])
    assert steps.min() > 15.0 and steps.max() < 25.0
    assert len(route["points"]) == len(route["profile"]["elevation_m"]) == len(route["profile"]["slope_deg"])
    assert route["profile"]["distance_m"][-1] == route["stats"]["distance_m"]


def test_straightening_does_not_cut_through_a_wall():
    grid = two_gap_grid()
    facts = terrain.ground_facts(grid)
    path, corners, _window = candidates.search_candidate(grid, facts, "shortest", (25, 10), (25, 50))
    assert len(corners) < len(path)
    rows, cols = candidates.resample(corners, routing.ground_cell_sizes(grid))
    on_wall = np.rint(cols).astype(int) == 30
    assert on_wall.any()
    assert all(8 <= r <= 14 for r in np.rint(rows[on_wall]).astype(int))
    assert facts.slope_deg[np.rint(rows).astype(int), np.rint(cols).astype(int)].max() <= 30.0


def test_heights_between_cells_are_bilinear():
    heights = np.array([[0.0, 10.0], [20.0, 30.0]], dtype=np.float32)
    values = candidates.heights_at(heights, np.array([0.0, 0.5, 1.0]), np.array([0.0, 0.5, 0.25]))
    assert values.tolist() == pytest.approx([0.0, 15.0, 22.5])
    heights[1, 1] = np.nan
    assert candidates.heights_at(heights, np.array([0.4]), np.array([0.4]))[0] == 0.0


# --- look-alikes and routes that are not better ---------------------------------


def test_identical_candidates_are_merged_into_also():
    answer = plan(make_grid(np.zeros((12, 16))), (5, 2), (5, 12))
    first = answer["routes"][0]
    assert first["id"] == "shortest"
    assert first["also"] == ["Fastest", "Lower-slope", "Flattest", "Smooth ground"]
    assert [r["id"] for r in answer["routes"]] == ["shortest"]
    # The two points are 200 m apart. Every way stays inside the 150 m corridor.
    assert answer["dropped"] == [
        {
            "id": "alternative",
            "name": "Another way",
            "reason": "No clearly different way was found. It is almost the same line as the Shortest route.",
        }
    ]
    assert answer["not_found"] == []


def fake_route(route_id: str, name: str, cells, **stats) -> dict:
    base = {"distance_m": 1000.0, "walk_time_s": 2000, "climb_m": 50.0, "max_slope_deg": 10.0,
            "steep_percent": 0.0, "rough_percent": 0.0, "pit_m": 0.0}
    base.update(stats)
    return {"id": route_id, "name": name, "also": [], "stats": base, "_cells": set(cells), "_merged": []}


def test_lookalike_rules():
    line = [(5, c) for c in range(100)]
    beside = [(6, c) for c in range(100)]
    far = [(40, c) for c in range(100)]
    a = fake_route("shortest", "Shortest", line)
    # Rule 1: a line one cell beside the other shares its cells.
    assert candidates.are_lookalikes(fake_route("fastest", "Fastest", beside, walk_time_s=3000), a)
    # Rule 2: far away, but all four numbers within 2%.
    assert candidates.are_lookalikes(fake_route("fastest", "Fastest", far, walk_time_s=2030), a)
    # Far away and 10% slower: not a look-alike.
    assert not candidates.are_lookalikes(fake_route("fastest", "Fastest", far, walk_time_s=2200), a)
    # 80 of 100 cells shared is under the 85% limit.
    mostly = line[:80] + [(40, c) for c in range(80, 100)]
    assert not candidates.are_lookalikes(fake_route("fastest", "Fastest", mostly, walk_time_s=2200), a)


def test_a_route_that_is_not_better_on_any_measure_is_dropped():
    line = [(5, c) for c in range(100)]
    far = [(40, c) for c in range(100)]
    good = fake_route("fastest", "Fastest", line)
    worse = fake_route("flattest", "Flattest", far, distance_m=1200.0, walk_time_s=2400, climb_m=60.0)
    trade = fake_route("lower_slope", "Lower-slope", far, distance_m=1200.0, walk_time_s=2400, climb_m=20.0)
    dropped: list = []
    kept = candidates.drop_not_better([good, worse, trade], dropped)
    assert sorted(r["id"] for r in kept) == ["fastest", "lower_slope"]
    assert dropped == [
        {"id": "flattest", "name": "Flattest", "reason": "Not better than the Lower-slope route on any measure."}
    ]


def test_another_way_is_kept_only_when_it_is_truly_different():
    line = [(5, c) for c in range(100)]
    far = [(40, c) for c in range(100)]
    half = line[:60] + [(40, c) for c in range(60, 100)]
    good = fake_route("fastest", "Fastest", line)
    dropped: list = []
    different = fake_route("alternative", "Another way", far, distance_m=1300.0, walk_time_s=2600)
    assert len(candidates.drop_not_better([good, different], dropped)) == 2 and dropped == []
    alike = fake_route("alternative", "Another way", half, distance_m=1300.0, walk_time_s=2600)
    assert [r["id"] for r in candidates.drop_not_better([good, alike], dropped)] == ["fastest"]
    assert dropped[0]["id"] == "alternative"


# --- score and rank -----------------------------------------------------------


def test_weights_add_up_to_one():
    assert sum(candidates.SCORE_WEIGHTS.values()) == pytest.approx(1.0)
    assert set(candidates.SCORE_WEIGHTS) == {"time", "steep", "climb", "rough"}


def test_scores_and_ranks_on_a_ridge():
    answer = plan(ridge_grid(), (5, 5), (5, 25))
    routes = answer["routes"]
    assert len(routes) >= 2
    quickest = min(routes, key=lambda r: r["stats"]["walk_time_s"])
    assert quickest["score_parts"]["time"] == 100
    assert "time" in quickest["best_at"]
    for route in routes:
        assert set(route["score_parts"]) == {"time", "steep", "climb", "rough"}
        assert all(0 <= part <= 100 for part in route["score_parts"].values())
        expected = sum(candidates.SCORE_WEIGHTS[k] * route["score_parts"][k] for k in route["score_parts"])
        assert route["score"] == pytest.approx(expected, abs=1.0)
    scores = [r["score"] for r in routes]
    assert scores == sorted(scores, reverse=True)
    assert [r["rank"] for r in routes] == list(range(1, len(routes) + 1))
    assert [r["recommended"] for r in routes] == [True] + [False] * (len(routes) - 1)
    assert answer["recommendation"]["id"] == routes[0]["id"]
    # Every measure has at least one route that is best at it.
    for measure in ("distance", "time", "steepness", "climb", "smooth"):
        assert any(measure in r["best_at"] for r in routes)
    # The route over the ridge is the shortest. A route around it has no steep ground.
    found = by_id(answer)
    assert "distance" in found["shortest"]["best_at"]
    assert found["shortest"]["stats"]["steep_percent"] > 0
    assert any(r["stats"]["steep_percent"] == 0 and "steepness" in r["best_at"] for r in routes)


def test_equal_scores_are_ranked_by_time():
    line = [(5, c) for c in range(100)]
    slow = fake_route("shortest", "Shortest", line, walk_time_s=2001)
    quick = fake_route("fastest", "Fastest", line, walk_time_s=2000)
    routes = [slow, quick]
    candidates.score_routes(routes)
    assert slow["score"] == quick["score"]
    assert [r["id"] for r in routes] == ["fastest", "shortest"]


def test_the_recommendation_uses_only_numbers_from_the_stats():
    for grid, start, goal in ((ridge_grid(), (5, 5), (5, 25)), (two_gap_grid(), (25, 10), (25, 50))):
        answer = plan(grid, start, goal)
        why = answer["recommendation"]["why"]
        allowed = {str(len(answer["routes"])), f"{routing.STEEP_DEG:g}", "1"}  # "1" is in "less than 1%"
        for route in answer["routes"]:
            stats = route["stats"]
            allowed.update(re.findall(r"\d+", candidates.format_duration(stats["walk_time_s"])))
            for key in ("steep_percent", "rough_percent", "climb_m", "pit_m", "max_slope_deg"):
                allowed.add(f"{stats[key]:.0f}")
        numbers = re.findall(r"\d+(?:\.\d+)?", why)
        assert numbers, why
        assert set(numbers) <= allowed, why
        assert "safe" not in why.lower()


def test_no_text_says_safe():
    for definition in candidates.CANDIDATES:
        assert "safe" not in (definition["name"] + definition["idea"]).lower()


def test_format_duration():
    assert candidates.format_duration(29520) == "8 h 12 min"
    assert candidates.format_duration(2700) == "45 min"
    assert candidates.format_duration(7200) == "2 h 0 min"


# --- candidates ---------------------------------------------------------------


def test_another_way_leaves_the_corridor_when_a_second_way_exists():
    grid = two_gap_grid()
    answer = plan(grid, (25, 10), (25, 50))
    found = by_id(answer)
    assert "alternative" in found

    def rows_on_the_wall(route) -> list[int]:
        rows = []
        for lon, lat, _h in route["points"]:
            col, row = (~grid.transform) * (MARS_RADIUS_M * math.radians(lon), MARS_RADIUS_M * math.radians(lat))
            if int(math.floor(col)) == 30:
                rows.append(int(math.floor(row)))
        return rows

    best = next(r for r in answer["routes"] if r["id"] != "alternative")
    assert all(8 <= r <= 14 for r in rows_on_the_wall(best))
    assert all(44 <= r <= 50 for r in rows_on_the_wall(found["alternative"]))
    assert found["alternative"]["stats"]["distance_m"] > best["stats"]["distance_m"]


def test_corridor_mask_is_a_band_around_the_cells():
    mask = candidates.corridor_mask((40, 40), {(20, c) for c in range(10, 30)}, (20.0, 20.0), 60.0)
    assert mask[17:24, 15].all() and not mask[16, 15] and not mask[24, 15]
    assert mask[20, 7] and not mask[20, 6]


def test_smooth_ground_goes_around_a_bumpy_patch():
    rows, cols = np.mgrid[0:40, 0:60]
    heights = np.zeros((40, 60))
    patch = (rows >= 10) & (rows < 30) & (cols >= 25) & (cols < 35)
    heights[patch] = np.where((rows[patch] + cols[patch]) % 2 == 0, 1.5, -1.5)
    grid = make_grid(heights)
    facts = terrain.ground_facts(grid)
    assert facts.rough[20, 30]
    straight = candidates.build_route(
        grid, facts, "shortest", candidates.search_candidate(grid, facts, "shortest", (20, 5), (20, 55))[1]
    )
    smooth = candidates.build_route(
        grid, facts, "smooth_ground", candidates.search_candidate(grid, facts, "smooth_ground", (20, 5), (20, 55))[1]
    )
    assert straight["stats"]["rough_percent"] > 10.0
    assert "% of this route is on bumpy ground." in " ".join(straight["warnings"])
    assert smooth["stats"]["rough_percent"] < straight["stats"]["rough_percent"]
    assert smooth["stats"]["distance_m"] > straight["stats"]["distance_m"]


def test_pit_metres_and_warning():
    rows, cols = np.mgrid[0:30, 0:60]
    heights = np.full((30, 60), 100.0)
    bowl = np.hypot(rows - 15, cols - 30)
    heights[bowl <= 8] = 100.0 - 1.0 * (8 - bowl[bowl <= 8])  # 8 m deep, gentle sides
    grid = make_grid(heights)
    facts = terrain.ground_facts(grid)
    line_rows, line_cols = candidates.resample([(15, 5), (15, 55)], routing.ground_cell_sizes(grid))
    route = candidates.measure_line(grid, facts, line_rows, line_cols, 30.0)
    # Cells deeper than 2 m on row 15 are columns 25 to 35: 11 cells of about 20 m.
    assert route["stats"]["pit_m"] == pytest.approx(11 * 20.0, abs=5.0)
    assert any(re.fullmatch(r"It crosses \d+ m of pits\.", w) for w in route["warnings"])


def test_fastest_is_not_slower_than_the_other_candidates():
    grid = ridge_grid()
    facts = terrain.ground_facts(grid)
    fastest, method = candidates.find_fastest(grid, facts, (5, 5), (5, 25), None)
    assert method in ("direction-aware", "cell-steepness")
    for candidate_id in ("shortest", "lower_slope", "flattest"):
        other = candidates.build_route(
            grid, facts, candidate_id, candidates.search_candidate(grid, facts, candidate_id, (5, 5), (5, 25))[1]
        )
        assert fastest["stats"]["walk_time_s"] <= other["stats"]["walk_time_s"] * 1.01


def test_direction_aware_search_prefers_the_gentle_downhill():
    # A plane that falls 1 m per 20 m cell to the east (s = -0.05, the fastest slope of the walking curve).
    # Walking east is quicker than on flat ground. Walking west is slower.
    heights = np.tile(-np.arange(40) * 1.0, (20, 1))
    grid = make_grid(heights)
    facts = terrain.ground_facts(grid)
    sampling = routing.ground_cell_sizes(grid)
    window = (0, 20, 0, 40)
    east_cells = [(10, c) for c in range(5, 36)]
    path, corners = candidates.direction_aware_path(grid, facts, (10, 5), (10, 35), window, east_cells)
    assert corners == [(10, 5), (10, 35)]
    rows, cols = np.array([p[0] for p in path]), np.array([p[1] for p in path])
    east_time = candidates.step_times_s(grid.heights, rows, cols, sampling).sum()
    west_time = candidates.step_times_s(grid.heights, rows[::-1], cols[::-1], sampling).sum()
    flat_time = 600.0 / candidates.base_walk_speed_m_s()
    assert east_time < flat_time < west_time


def test_a_wall_gives_not_found_for_every_candidate():
    heights = np.zeros((30, 30))
    heights[:, 15] = 500.0
    answer = plan(make_grid(heights), (5, 5), (5, 25))
    assert answer["routes"] == [] and answer["recommendation"] is None and answer["dropped"] == []
    assert [item["id"] for item in answer["not_found"]] == [c["id"] for c in candidates.CANDIDATES]
    assert "20°" in answer["not_found"][3]["reason"]


def test_start_and_goal_are_usable_on_ground_over_the_limit():
    heights = np.zeros((20, 30))
    heights[:, 10:] = 14.0
    heights[:, 11:] = 28.0
    heights[:, 12:] = 42.0
    grid = make_grid(heights)
    answer = plan(grid, (10, 11), (10, 25))
    assert answer["routes"]
    assert any("start point is on ground steeper than the limit" in w for w in answer["routes"][0]["warnings"])


# --- the whole request --------------------------------------------------------


def test_compute_candidates_answer_shape():
    grid = ridge_grid()
    lon0, lat0 = lonlat_of(grid, 5, 5)
    lon1, lat1 = lonlat_of(grid, 5, 25)
    answer = candidates.compute_candidates(grid, lon0, lat0, lon1, lat1)
    assert set(answer) == {
        "status", "start", "goal", "settings", "weights", "routes", "not_found", "dropped", "recommendation", "compute_ms",
    }
    assert answer["status"] == "ok"
    assert answer["start"] == {"lon": lon0, "lat": lat0, "elevation_m": 0.0}
    assert answer["weights"] == {"time": 0.4, "steep": 0.3, "climb": 0.15, "rough": 0.15}
    settings = answer["settings"]
    for key, value in routing.settings(grid).items():
        assert settings[key] == value
    assert settings["rough_m"] == terrain.ROUGH_M and settings["pit_depth_m"] == terrain.PIT_DEPTH_M
    assert settings["corridor_m"] == 150
    assert settings["fastest_method"] in ("direction-aware", "cell-steepness")
    for route in answer["routes"]:
        assert set(route) == {
            "id", "name", "idea", "also", "points", "profile", "stats", "score", "score_parts",
            "rank", "recommended", "best_at", "warnings",
        }
        assert set(route["stats"]) == {
            "distance_m", "flat_distance_m", "climb_m", "descent_m", "max_slope_deg", "mean_slope_deg",
            "steep_percent", "rough_percent", "pit_m", "walk_time_s", "rover_time_s",
        }
        assert isinstance(route["score"], int)
        first, last = route["points"][0], route["points"][-1]
        assert first[0] == pytest.approx(lon0, abs=1e-6) and first[1] == pytest.approx(lat0, abs=1e-6)
        assert last[0] == pytest.approx(lon1, abs=1e-6) and last[1] == pytest.approx(lat1, abs=1e-6)
    assert set(answer["recommendation"]) == {"id", "why"}
    assert isinstance(answer["compute_ms"], int)


def test_compute_candidates_errors_are_those_of_api_route():
    grid = make_grid(np.zeros((12, 16)))
    lon, lat = lonlat_of(grid, 5, 5)
    with pytest.raises(routing.RouteError) as info:
        candidates.compute_candidates(grid, lon, lat, lon + 1e-5, lat)
    assert info.value.code == "same_point"
    with pytest.raises(routing.RouteError) as info:
        candidates.compute_candidates(grid, lon, lat, lon + 5.0, lat)
    assert info.value.code == "outside" and "end point" in info.value.detail


# --- the walking-time map -----------------------------------------------------


def test_reach_times_on_flat_ground_are_distance_over_speed():
    grid = make_grid(np.zeros((30, 40)))
    times = reach.time_grid_s(grid, terrain.ground_facts(grid), (15, 5))
    speed = candidates.base_walk_speed_m_s()
    assert times[15, 5] == 0.0
    assert times[15, 25] == pytest.approx(400.0 / speed)
    assert times[20, 10] == pytest.approx(5 * CELL * math.sqrt(2.0) / speed)


def test_reach_has_no_way_behind_a_wall():
    heights = np.zeros((30, 30))
    heights[:, 15] = 500.0
    grid = make_grid(heights)
    times = reach.time_grid_s(grid, terrain.ground_facts(grid), (15, 5))
    assert math.isfinite(times[15, 10]) and math.isinf(times[15, 25])


def test_reach_answer_and_image():
    heights = np.zeros((30, 30))
    heights[:, 15] = 500.0
    grid = make_grid(heights)
    lon, lat = lonlat_of(grid, 15, 5)
    answer = reach.compute_reach(grid, lon, lat)
    assert answer["bands_s"] == [1800, 3600, 7200, 14400, 28800]
    assert [item["label"] for item in answer["legend"]] == ["30 min", "1 h", "2 h", "4 h", "8 h", "More than 8 h"]
    assert all(re.fullmatch(r"#[0-9a-f]{6}", item["color"]) for item in answer["legend"])
    assert 40.0 < answer["unreachable_percent"] < 60.0
    assert answer["max_time_s"] > 0
    assert answer["image"].startswith("data:image/png;base64,")
    image = Image.open(io.BytesIO(base64.b64decode(answer["image"].split(",", 1)[1])))
    assert image.mode == "RGBA" and image.size == (15, 15) == (answer["image_width"], answer["image_height"])
    pixels = np.array(image)
    assert pixels[7, 2, 3] == 153 and tuple(pixels[7, 2, :3]) == (0xFF, 0xFF, 0xCC)  # reachable, first band
    assert pixels[7, 12, 3] == 0  # behind the wall: clear
    with pytest.raises(routing.RouteError):
        reach.compute_reach(grid, lon + 5.0, lat)


def test_reach_bands_have_clear_steps():
    times = np.array([[0.0, 1800.0, 1801.0, 3600.0, 20000.0, 28800.0, 30000.0, np.inf]] * 2).repeat(2, axis=1)
    image = reach.band_image(times)
    colors = [tuple(int(c[i : i + 2], 16) for i in (1, 3, 5)) for c in reach.BAND_COLORS]
    assert [tuple(image[0, k, :3]) for k in range(7)] == [
        colors[0], colors[0], colors[1], colors[1], colors[4], colors[4], colors[5],
    ]
    assert image[0, 7, 3] == 0 and image[0, 0, 3] == 153
