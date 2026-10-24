# Testing

Every number here comes from a run file in this repo. **Emulator** = IWSDK 1.1.0-rc.2 agent mode (headless
Playwright Chromium 1248 + IWER with SEM synthetic rooms) on an Apple M4 Mac, ANGLE Metal. **No device run
yet** and **no Meta model run yet** (`MODEL_API_KEY` not set). Zero skipped tests.

## Summary (Oct 24, 2026)

| Suite | Command | Result | Run file |
|---|---|---|---|
| Unit (Vitest) | `npm test` | **44 / 44** passed (6 files: room 26, pano 7, gateway 11) | console |
| Emulator e2e, Quest 3 profile, hands only | `node e2e/run.ts` | **56 / 56** checks passed in 2 min 6 s | [`deployments/e2e/2026-10-24T01-29-31-552Z.json`](deployments/e2e/2026-10-24T01-29-31-552Z.json) |
| Emulator e2e, Meta VR Glasses profile (gaze + pinch) | `node e2e/glasses.ts` | **5 / 5** | [`deployments/e2e/glasses-2026-10-24T01-22-25-493Z.json`](deployments/e2e/glasses-2026-10-24T01-22-25-493Z.json) |
| Landing + app 2D page at 375 / 1280 px | `node e2e/landing.ts https://localhost:8443/` | **12 / 12** | [`deployments/e2e/pages-2026-10-24T01-31-59-656Z.json`](deployments/e2e/pages-2026-10-24T01-31-59-656Z.json) |
| Typecheck | `npm run typecheck`, `npm run xr:typecheck` | clean | |
| Production build | `npm run xr:build` | builds (11 MB `dist/`, emulator injected off-Quest) | |

Earlier run files in `deployments/e2e/` are kept as history; their failures were harness bugs fixed since
(a room that was already loaded, a 200-line log limit, a GLTS window with sheers that didn't fit, a card
visibility rule that was reverted).

## Unit tests (Vitest, no mocks)

- `packages/room`: wall frames (axes, bounds, normal flipped toward the viewer, side walls), plane round trips,
  ray/wall hits and nearest-wall picking, polygon area, door rectangle (both drag directions, clamping, edge and
  floor snapping, the 0.40 × 0.60 m minimum), the room summary (spec shape, object sides and distances, nulls
  when the floor is unknown), the Step-in state machine (proximity, reach-through, 1.2 s flood, 0.5 m exit,
  re-arm), status → badges.
- `packages/pano`: sRGB → Lab, the CC0 samples read as `equirect`, a cropped copy → `equirect+seamfix`, a copy
  rolled 20 % down → `cylinder`, aspect check, seam fix (seam ΔE drops below 2, pole spread drops).
- `packages/gateway`: without the key every model reports Setup required and plan/panorama/transcribe answer
  503 `setup_required`; no-key run records are stamped, patched, listed and deleted; bad JSON / sources / rooms
  are rejected; **a live call to api.meta.ai with an invalid key** returns the real 401 as a readable 502 that
  never contains the key (also checked in the stored run record); per-IP rate limit; the daily cap refuses calls
  without touching the network; `compose_portal` schema (unknown fields, bad hex, palette size, missing fields,
  range); the panorama contract is always appended; JPEG header size of the committed sample.

## Emulator e2e (hands only)

Four rooms in one session, switched at runtime through IWER SEM: `sunlit_living_room`, `bedroom` (built-in),
and ours, `thyra_studio` and `thyra_hall` ([eval/rooms](eval/rooms)). Per room: wall picked, door drawn by
pinch-drag with the right hand ray, a destination pinched on the door card, the world opened, a pixel check,
Step-in by walking to the door, exit by walking back, *Close door*.

| Metric | sunlit_living_room | thyra_studio | thyra_hall | bedroom |
|---|---|---|---|---|
| Room read vs ground truth: wall width | 5.004 m (5.0) | 3.604 m (3.6) | 6.004 m (6.0) | n/a |
| ceiling | 2.700 m (2.7) | 2.400 m (2.4) | 2.100 m (2.1) | n/a |
| floor area | 29.00 m² (29.0) | 15.12 m² (15.12) | 9.00 m² (9.0) | n/a |
| Door drawn | 1.20 × 2.05 m | 1.10 × 2.00 m | 1.00 × 1.95 m | 0.90 × 1.90 m |
| Corners off the wall plane (max) | 0.00 mm | 0.00 mm | 0.00 mm | 0.00 mm |
| Corner vs pinch point | 0.0 mm | 0.0 mm | 0.0 mm | 0.0 mm |
| Pixel check: ΔRGB inside the door vs a wall patch outside | 240.7 vs 7.7 | 95.6 vs 7.1 | 114.5 vs 12.9 | 110.8 vs 9.2 |
| `pano_mode` (CC0 sample) | equirect | equirect | equirect | equirect |
| Pinch release → world revealed* | 2.07 s | 2.04 s | 2.04 s | 2.11 s |

\* No key: this includes a deliberate 0.9 s hold on the room read plus decoding the 4096×2048 sample and the
GPU upload. It is **not** the Muse Spark + Muse Image time to world, which needs the key.

Wall widths read 4 mm wider than the room spec because SEM's walls overlap by a 4 mm seam. Registration reads
0.00 mm because emulated rays are exact; that says the plane math is right, not that a real hand is that steady.

Also in the run: a 0.25 m door is rejected with "Too small: a door needs at least 0.40 × 0.60 m"; three open
doors on three walls; a fourth closes the oldest; with no room (`none`) the paper-wall prompt appears, two floor
pinches place a 2.0 m paper wall labelled `paper wall (virtual)`, and a door opens on it; every Meta model
badge says Setup required; **0 console errors** during the run.

### Frame time (emulator, not device)

600 frames with three doors open while the head pans across them (`window.__thyraPerf`, CPU ms from the start
of the ECS update to the end of `renderer.render`):

| p50 | p95 | max | draw calls p50 / max | triangles p50 |
|---|---|---|---|---|
| 2.7 ms | 3.3 ms | 4.7 ms | 248 / 312 | 84,764 |

Headless Chromium on a desktop GPU says nothing about Quest 3 GPU time; the spec's device target (p95 ≤ 13.9 ms
at 72 Hz) is unmeasured. Draw calls are high (each door is ~17 meshes: mask, ink, world, trims, dimensions,
glows, two particle systems); merging the trim and dimension strips is the first optimisation if a device run
is slow.

Console warnings seen (not errors): gaze tracking not granted in the Quest 3 profile (expected; it's optional),
IWSDK notes that portal entities are parented under the level root by default, and a Canvas2D
`willReadFrequently` hint.

### Meta VR Glasses profile

`metaVRGlasses` with gaze + hand pinch: the session grants `gaze-tracking`; gazing at the wall while pinching
draws a 1.00 × 1.90 m door; the door card's corners sit at ±17.7° horizontally and −30.1°…−6.5° vertically
(the glasses show ±37°, +25°/−43°); gazing at a card button and pinching opens the world; 0 console errors.

## Emulator clips (test recordings, not the demo video)

CDP screencast of the managed page while `e2e/record.ts` runs a hands-only choreography (1280×692 after
cropping the workspace toolbar, 30 fps). In `grokbot/videos/thyra/`:

| Clip | Length | What |
|---|---|---|
| `thyra-01-tear-open.mp4` | 35.4 s | pinch-drag a door behind the couch, the tear, ink line, pick *a misty pine forest*, reveal, head sway |
| `thyra-02-parallax.mp4` | 39.0 s | strafing and stepping toward the open door: the view through it shifts like a window |
| `thyra-03-step-in.mp4` | 39.6 s | walk up, the world floods around you, look around, the lime door back to the room, walk out |
| `thyra-04-three-doors.mp4` | 40.0 s | doors on three walls (forest, night savanna, seafront sunset), panning across them |

## Not tested yet

- **Device**: planes after Space Setup and their `semanticLabel` values, frame time, depth occlusion quality,
  mic in the Quest Browser, comfort of Step-in. Checklist in README "Run it on a Quest".
- **Meta models**: plan schema on a real response, a 2:1 image (real W×H, seam, horizon), a transcription, a
  real 422 refusal. All written to the documented shapes; fields marked `UNVERIFIED` in
  `packages/gateway/src/meta.ts` / `prompt.ts`.
- Voice e2e with recorded WAVs (needs Nick's phrases), Spark vs Wonder bench, human room-fit rating.
