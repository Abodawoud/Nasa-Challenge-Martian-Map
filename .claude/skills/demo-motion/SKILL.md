---
name: demo-motion
description: How this project animates - Motion for UI components, GSAP for choreographed timelines (intro titles, HUD that assembles itself, numbers that count up, route draw-on), and Cesium's camera for anything that moves the map. Load before adding any animation, transition, intro sequence or count-up. Load the gsap-skills plugin skills (gsap-react, gsap-timeline) before the first useGSAP().
---

# Motion in this demo

The demo has to feel alive in the first 10 seconds and stay calm while someone works the map.

## Who owns what

| Moves | Owner | Why |
|---|---|---|
| The **camera** (intro fly-in, fly to a site, tour) | **Cesium** `camera.flyTo` / `flyToBoundingSphere` with `complete` callbacks | Only Cesium knows the globe. Never animate the camera with GSAP |
| **UI components** appearing, hover, press, panels opening, lists | **Motion** (`npm i motion`, `motion/react`) | Built for the React tree |
| **Choreographed sequences** (title cards over the intro, HUD assembling, stats counting up, route reveal timing) | **GSAP** (`npm i gsap @gsap/react`, `useGSAP()`) | Timelines with exact order |

**Never Motion and GSAP on the same element.** They fight over `transform`.

## Motion patterns

| Pattern | For |
|---|---|
| `AnimatePresence` | Panels, toasts, warnings that appear or disappear |
| `layoutId` | A route card that grows into the full comparison panel |
| `whileHover` / `whileTap` | Every button and layer chip |
| `staggerChildren` | Layer list, stats rows |

## GSAP moments (the only ones we need)

1. **Intro title cards** synced to the Cesium fly-in: "MARS" → "JEZERO CRATER · 18.4°N 77.5°E" →
   "MARSWALK PLANNER". Start each step from the camera `flyTo` `complete` callback, not from timers.
2. **HUD assembles**: panels slide in from the edges with a short stagger after the intro ends.
3. **Numbers count up**: distance, climb, time in the route comparison (`gsap.to(obj, { val, snap })`).
4. **Route reveal**: Route A then Route B appear in order (animate a Cesium polyline by growing its
   positions with a `CallbackProperty`, timed by a GSAP tween on a progress value).

## Rules

- `prefers-reduced-motion`: skip the intro (jump the camera), no count-ups, instant panels.
- **No Lenis / smooth scroll.** This is a map app. The mouse wheel belongs to Cesium zoom.
- Durations: UI 150–300 ms. Intro total 5–10 s, always skippable (Skip button + Esc).
- Clean up: `useGSAP` handles its own revert. Kill Cesium `CallbackProperty` animations on unmount.
- Keep `scene.requestRenderMode` in mind: call `scene.requestRender()` during custom animations.
