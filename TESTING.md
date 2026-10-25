# Testing

## Latest recorded verification (Oct 25, 2026)

These are recorded emulator runs on an Apple M4. No device run and no Meta model run has been completed.
The latest recorded hands-only run is the 11:04 UTC file below; it was not executed as part of this documentation restore.

| What | Recorded result | Evidence |
|---|---|---|
| Unit tests | **46 / 46 passed**, last recorded full run | commit `7a346bb` |
| Root TypeScript check | Passed; 0 diagnostics | recorded check, Oct 25, 2026 |
| XR TypeScript check | Passed; 0 diagnostics | recorded check, Oct 25, 2026 |
| Emulator e2e, hands only, 4 rooms | **56 / 56 passed**, 0 failed; **128.253 s** | [hands-only JSON](deployments/e2e/2026-10-25T11-04-22-665Z.json) |
| Meta VR Glasses profile (gaze + pinch) | **5 / 5 passed**, 0 failed | [glasses JSON](deployments/e2e/glasses-2026-10-25T11-06-53-722Z.json) |
| Landing + app 2D page at 375 / 1280 px | **12 / 12 passed**, 0 failed | [full pages JSON](deployments/e2e/pages-2026-10-25T04-51-34-608Z.json) |
| Per-room time to world, sample path | **2.10 / 2.04 / 2.01 / 2.13 s*** (living room / studio / hall / bedroom) | hands-only JSON above |
| Three open doors, CPU p50 / p95 / max | **2.50 / 3.00 / 3.40 ms** (rounded to two decimals), 600 frames | hands-only JSON above |
| Three open doors, draw calls p50 / max; triangles p50 | **244 / 304** draws; **84,756** triangles | hands-only JSON above |

The hands-only duration is computed from `started` (`2026-10-25T11:04:22.665Z`) and `finished`
(`2026-10-25T11:06:30.918Z`). Unit tests are the last recorded full run at `7a346bb`.

The later page files [10:57 UTC](deployments/e2e/pages-2026-10-25T10-57-54-442Z.json) and
[10:59 UTC](deployments/e2e/pages-2026-10-25T10-59-46-291Z.json) each passed **6 / 6 landing-only checks**.
They do not cover the app 2D page; the 04:51 UTC file above is the latest recorded full 12-check pages run.

## Per-room measurements

All values below come from the latest recorded [hands-only run](deployments/e2e/2026-10-25T11-04-22-665Z.json).
Door sizes and release-to-world times come from `metrics.doors`; geometry, pixel ΔRGB and off-plane values
come from the check names. A dash means the file has no corresponding geometry check.

| Room | Door | To world* | Wall width (truth) | Ceiling (truth) | Floor area (truth) | Pixel ΔRGB inside / outside | Off-plane max |
|---|---|---|---|---|---|---|---|
| `sunlit_living_room` | 1.20 × 2.05 m | 2.10 s | 5.004 m (5 m) | 2.700 m (2.7 m) | 29.00 m² (29 m²) | 243.7 / 7.4 | 0.00 mm |
| `thyra_studio` | 1.10 × 2.00 m | 2.04 s | 3.604 m (3.6 m) | 2.400 m (2.4 m) | 15.12 m² (15.12 m²) | 98.0 / 7.1 | 0.00 mm |
| `thyra_hall` | 1.00 × 1.95 m | 2.01 s | 6.004 m (6 m) | 2.100 m (2.1 m) | 9.00 m² (9 m²) | 119.5 / 4.8 | 0.00 mm |
| `bedroom` | 0.90 × 1.90 m | 2.13 s | — | — | — | 125.7 / 6.2 | 0.00 mm |

*No-key sample path: includes a deliberate 0.9 s hold on the room read plus sample decoding and GPU upload.
These times are not Muse Spark + Muse Image latency. Every door is stamped *Sample, not generated*;
plan status is *Setup required*. `packages/landing/data/schedule.json` cites this same hands-only file,
with these four rounded times and summary `local_time` 16:34.

## Three-door frame measurements

From `metrics.perf_three_doors` in the same hands-only file:

| Metric | Recorded value |
|---|---|
| Frames / XR frames | 600 / 600 |
| CPU p50 / p95 / max | 2.50 / 3.00 / 3.40 ms (rounded to two decimals) |
| Draw calls p50 / max | 244 / 304 |
| Triangles p50 | 84,756 |

`window.__thyraPerf` samples CPU milliseconds from the ECS update start through `renderer.render` while
three doors are open and the head pans across them. This is desktop headless Chromium on an Apple M4,
not Quest CPU/GPU timing. The Quest target (p95 ≤ 13.9 ms at 72 Hz) remains unmeasured.

## Emulator coverage and measurement method

The hands-only suite uses IWER (IWSDK's browser-based immersive emulator) with SEM synthetic rooms and the
Quest 3 profile. It switches between `sunlit_living_room`, `thyra_studio`, `thyra_hall` and `bedroom`. Per room:
pick a wall, pinch-drag a door with the right hand ray, pinch a destination on the door card, open the sample
world, compare pixels inside and outside the frame, step in by walking toward the door, exit and close it.
It also checks the minimum door size, three-door limit and oldest-door replacement, no-wall paper placement,
Setup required badges, and console errors. Emulated exact rays cannot establish real-hand registration quality.

The glasses suite selects `metaVRGlasses`, checks that `gaze-tracking` is granted, draws a door using gaze
and hand pinch, measures the door card's corner angles against the narrower glasses view, opens a sample
world by gazing at a destination and pinching, and checks console errors. Its recorded card-angle check is:

> door card inside the glasses view (max |h| 17.7°, v -30.1…-6.5°)

The full pages suite checks the landing and app 2D page at 375 and 1280 px: horizontal scroll,
rendered schedule/status badges, and console errors (12 checks total).

## Unit test coverage (Vitest, no mocks)

- `packages/room`: wall frames (axes, bounds, normal flipped toward the viewer, side walls), plane round trips,
  ray/wall hits and nearest-wall picking, polygon area, door rectangle (both drag directions, clamping, edge and
  floor snapping, the 0.40 × 0.60 m minimum, doors that overlap vs stand side by side), the room summary (spec shape, object sides and distances, nulls
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

## Historical emulator clips (test recordings, not the demo video)

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
