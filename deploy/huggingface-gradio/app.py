"""Martian Map backend as a free Hugging Face Space (Gradio SDK).

A free Space must be a Gradio app. So this file starts our normal FastAPI backend
(the folder 'mapapi' beside this file is a copy of backend/app) and adds a small
Gradio page on the front address. The API answers under /api as always.

Hugging Face starts a Gradio Space with 'python app.py' and expects port 7860.
"""

import os

# A free Space keeps no disk. The height map is downloaded again at each start.
os.environ.setdefault("DEM_CACHE_DIR", "/tmp/dem")
# A free Space has little memory to spare. The direction-aware search needs about 200 bytes
# per cell, so it is only used for search areas up to this many cells (about 80 MB).
# Longer routes use the cell-steepness search instead. The answer says which one was used.
os.environ.setdefault("DIRECTION_AWARE_MAX_CELLS", "400000")

import gradio as gr  # noqa: E402
import uvicorn  # noqa: E402

from mapapi.main import app as api  # noqa: E402

try:
    # On "ZeroGPU" hardware the Space wants to see one function marked for the GPU.
    # We do not use a GPU. This empty function is only there so the Space starts.
    import spaces  # type: ignore

    @spaces.GPU
    def _not_used() -> None:
        return None

except Exception:  # noqa: BLE001 - not on ZeroGPU, or the package is missing: nothing to do
    pass

ABOUT = """
# Martian Map API

The backend of **Martian Map**, the entry of team Red Compass for the NASA Space Apps Challenge 2026.

It answers questions about the ground of Jezero Crater on Mars, from the USGS height map (20 m per pixel).

| Address | Answer |
|---|---|
| `/api/health` | The backend is running |
| `/api/dem/info` | The height map: ready or loading, its edges, its source |
| `/api/point?lon=77.4509&lat=18.4446` | Height and slope of one place |
| `/api/routes?from_lon=77.4509&from_lat=18.4446&to_lon=77.37&to_lat=18.502` | Several walking routes, scored and ranked |
| `/api/reach?lon=77.4509&lat=18.4446` | The walking time from a start to every place |

Code: <https://github.com/Abodawoud/Nasa-Challenge-Martian-Map>

It is a planning prototype. It is not a navigation system for a real mission.
"""

with gr.Blocks(title="Martian Map API") as page:
    gr.Markdown(ABOUT)

# The API routes were added first, so /api/... is answered by the backend.
# Everything else goes to the Gradio page.
app = gr.mount_gradio_app(api, page, path="/")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=7860)
