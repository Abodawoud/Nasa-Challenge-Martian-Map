"""Tests for the pure maths in app/dem.py.

They use small synthetic arrays. They never download or read the real DEM.
Run from the backend folder: python -m pytest tests
"""

import math

import numpy as np
import pytest
from affine import Affine

from app.dem import (
    MARS_RADIUS_M,
    DemGrid,
    bilinear,
    horn_slope_deg,
    lonlat_to_rowcol,
    lonlat_to_xy,
    xy_to_lonlat,
    xy_to_rowcol,
)

CELL = 20.0
# Top-left corner of a synthetic raster, in map metres. Close to the real file.
LEFT = 4_573_660.0
TOP = 1_109_700.0
TRANSFORM = Affine(CELL, 0.0, LEFT, 0.0, -CELL, TOP)


def test_lonlat_to_xy_uses_the_mars_sphere():
    x, y = lonlat_to_xy(90.0, 45.0)
    assert x == pytest.approx(MARS_RADIUS_M * math.pi / 2)
    assert y == pytest.approx(MARS_RADIUS_M * math.pi / 4)
    # One degree on Mars is about 59,274.7 m.
    assert lonlat_to_xy(1.0, 0.0)[0] == pytest.approx(59_274.7, abs=0.05)


def test_west_and_south_are_negative():
    x, y = lonlat_to_xy(-10.0, -5.0)
    assert x < 0 and y < 0


def test_xy_lonlat_round_trip():
    lon, lat = xy_to_lonlat(*lonlat_to_xy(77.4509, 18.4446))
    assert lon == pytest.approx(77.4509)
    assert lat == pytest.approx(18.4446)


def test_rowcol_of_the_top_left_cell_centre():
    row, col = xy_to_rowcol(LEFT + CELL / 2, TOP - CELL / 2, TRANSFORM)
    assert row == pytest.approx(0.0)
    assert col == pytest.approx(0.0)


def test_rowcol_of_the_top_left_corner():
    row, col = xy_to_rowcol(LEFT, TOP, TRANSFORM)
    assert row == pytest.approx(-0.5)
    assert col == pytest.approx(-0.5)


def test_rows_grow_to_the_south_and_columns_to_the_east():
    # Centre of the cell in row 3, column 7.
    x = LEFT + 7.5 * CELL
    y = TOP - 3.5 * CELL
    row, col = xy_to_rowcol(x, y, TRANSFORM)
    assert row == pytest.approx(3.0)
    assert col == pytest.approx(7.0)

    lon, lat = xy_to_lonlat(x, y)
    row2, col2 = lonlat_to_rowcol(lon, lat, TRANSFORM)
    assert row2 == pytest.approx(3.0, abs=1e-6)
    assert col2 == pytest.approx(7.0, abs=1e-6)

    # A point further north has a smaller row. A point further east has a larger column.
    row_n, _ = lonlat_to_rowcol(lon, lat + 0.001, TRANSFORM)
    _, col_e = lonlat_to_rowcol(lon + 0.001, lat, TRANSFORM)
    assert row_n < row2
    assert col_e > col2


def test_bilinear_on_cell_centres_and_between_them():
    grid = np.array([[10.0, 20.0], [30.0, 40.0]])
    assert bilinear(grid, 0.0, 0.0) == pytest.approx(10.0)
    assert bilinear(grid, 0.0, 1.0) == pytest.approx(20.0)
    assert bilinear(grid, 1.0, 0.0) == pytest.approx(30.0)
    assert bilinear(grid, 0.5, 0.5) == pytest.approx(25.0)
    assert bilinear(grid, 0.0, 0.25) == pytest.approx(12.5)
    assert bilinear(grid, 0.75, 0.0) == pytest.approx(25.0)


def test_bilinear_is_exact_on_a_plane():
    rows, cols = np.mgrid[0:6, 0:8]
    grid = 100.0 + 3.0 * cols - 2.0 * rows
    assert bilinear(grid, 2.3, 4.7) == pytest.approx(100.0 + 3.0 * 4.7 - 2.0 * 2.3)
    # Last row and last column still work.
    assert bilinear(grid, 5.0, 7.0) == pytest.approx(100.0 + 21.0 - 10.0)


def test_bilinear_outside_and_nodata():
    grid = np.array([[10.0, 20.0], [30.0, np.nan]])
    assert bilinear(grid, -0.6, 0.0) is None
    assert bilinear(grid, 0.0, 1.5) is None
    assert bilinear(grid, 0.5, 0.5) is None
    # In the half cell along the border the nearest centre is used.
    assert bilinear(grid, -0.4, -0.4) == pytest.approx(10.0)


@pytest.mark.parametrize("angle_deg", [0.0, 5.0, 15.0, 30.0, 45.0])
def test_horn_slope_on_a_plane_tilted_to_the_east(angle_deg):
    rise_per_cell = math.tan(math.radians(angle_deg)) * CELL
    _, cols = np.mgrid[0:3, 0:3]
    window = -2500.0 + rise_per_cell * cols
    assert horn_slope_deg(window, CELL, CELL) == pytest.approx(angle_deg, abs=1e-9)


def test_horn_slope_on_a_plane_tilted_to_the_north():
    rise_per_cell = math.tan(math.radians(20.0)) * CELL
    rows, _ = np.mgrid[0:3, 0:3]
    window = -2500.0 - rise_per_cell * rows
    assert horn_slope_deg(window, CELL, CELL) == pytest.approx(20.0, abs=1e-9)


def test_horn_slope_on_a_diagonal_plane():
    # 3 m up per cell to the east and 4 m up per cell to the south: gradient 5 m per 20 m.
    rows, cols = np.mgrid[0:3, 0:3]
    window = 3.0 * cols + 4.0 * rows
    expected = math.degrees(math.atan(5.0 / CELL))
    assert horn_slope_deg(window, CELL, CELL) == pytest.approx(expected, abs=1e-9)


def test_horn_slope_uses_the_cell_size():
    _, cols = np.mgrid[0:3, 0:3]
    window = 10.0 * cols
    assert horn_slope_deg(window, 10.0, 10.0) == pytest.approx(45.0)
    assert horn_slope_deg(window, 20.0, 20.0) == pytest.approx(math.degrees(math.atan(0.5)))


def test_horn_slope_with_nodata_or_wrong_shape():
    window = np.zeros((3, 3))
    window[0, 2] = np.nan
    assert horn_slope_deg(window, CELL, CELL) is None
    assert horn_slope_deg(np.zeros((2, 3)), CELL, CELL) is None


def test_grid_elevation_slope_and_bounds():
    # A plane that rises 2 m per cell to the east. 40 rows, 50 columns.
    rows, cols = np.mgrid[0:40, 0:50]
    heights = (-2600.0 + 2.0 * cols + 0.0 * rows).astype(np.float32)
    grid = DemGrid(heights=heights, transform=TRANSFORM)

    west, south, east, north = grid.bounds_deg()
    assert west == pytest.approx(math.degrees(LEFT / MARS_RADIUS_M))
    assert north == pytest.approx(math.degrees(TOP / MARS_RADIUS_M))
    assert east > west and north > south
    assert (east - west) == pytest.approx(math.degrees(50 * CELL / MARS_RADIUS_M))

    # Centre of row 10, column 20.
    lon, lat = xy_to_lonlat(LEFT + 20.5 * CELL, TOP - 10.5 * CELL)
    assert grid.elevation(lon, lat) == pytest.approx(-2560.0, abs=1e-3)

    # East-west ground distance is shorter than map distance by cos(lat).
    ground_x = CELL * math.cos(math.radians(lat))
    expected = math.degrees(math.atan(2.0 / ground_x))
    assert grid.slope(lon, lat) == pytest.approx(expected, abs=1e-4)

    # Outside the grid.
    assert grid.elevation(60.0, 10.0) is None
    assert grid.slope(60.0, 10.0) is None

    # On the border row the 3x3 window is not complete.
    lon_edge, lat_edge = xy_to_lonlat(LEFT + 20.5 * CELL, TOP - 0.5 * CELL)
    assert grid.elevation(lon_edge, lat_edge) is not None
    assert grid.slope(lon_edge, lat_edge) is None
