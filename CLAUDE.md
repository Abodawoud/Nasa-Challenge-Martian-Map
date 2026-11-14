# Martian Map: notes for AI coding sessions

NASA Space Apps 2026 demo. One developer plus AI. Deadline Sunday 19:00.
**The plan, every decision and its trade-offs live in `README.md`. Read it before building.**
Do not change a decision in code without changing it in the README first.

## Stack (decided, see README section 4)

- `frontend/`: React + TypeScript + Vite + Tailwind (+ shadcn/ui) · **CesiumJS only** (one viewer, no second map engine) · Motion + GSAP.
- `backend/`: Python 3.12 + FastAPI · rasterio + numpy + scikit-image (`MCP_Geometric` least-cost path).
- `docker-compose.yml`: `fe` + `be` + a cache volume for the DEM. Run with `docker compose up`.
- **APIs only, no data in git.** The frontend streams Trek tiles and terrain directly. The backend downloads the USGS DEM from its public URL into the cache volume.
- No Cesium ion, no paid keys.

## Skills to load before you build

| When | Skill |
|---|---|
| Any code that touches Cesium, layers, coordinates, terrain, routes | `cesium-mars` (project) |
| Any animation, intro, transition, count-up | `demo-motion` (project), then `gsap-skills` plugin (`gsap-react`, `gsap-timeline`) |
| The look of the UI (**clean NASA website style**, see README section 9: white panels, NASA blue `#0B3D91`, NASA red `#FC3D21` for alerts only, Inter) | `taste-skill`. Do **not** use `brutalist-skill` (dark style was not chosen) |
| Any UI component, panel, button, form | `web-interface-guidelines` |
| README, UI text, warnings, demo script | `writing-style` (B1 English) |
| Long files that must be complete | `output-skill` |

## Working rules

- Build in milestone order (README section 11). Each milestone ends with something we can show.
- Small steps. After each step: run the app, check the result, then continue.
- Never commit data files (`.tif`, `.bin`, tiles) or `.env`.
- Commit after each working step with a clear message, so the history shows the progress.
- Never present fake data as real. If a number is an assumption, label it in the UI.
- Route B is "lower-slope", never "safest".
- Credit NASA/JPL Mars Trek and USGS in the app.
