# Testing

## Latest verification attempt (Oct 25, 2026)

This worktree ran all three lightweight checks before requesting the shared heavy slot. The unit command
failed because this sandbox forbids binding a localhost server (`listen EPERM: operation not permitted
127.0.0.1`). Gateway setup timed out; this was an environment failure, not a passing full unit suite.

| Suite | Command | Fresh result | Evidence |
|---|---|---|---|
| Unit (Vitest) | `npm test` | **39 / 46 passed; 7 skipped** after setup failure; 5 files passed, 1 failed; 2 unhandled listener errors; **20.19 s** | command output |
| Root typecheck | `npm run typecheck` | **Passed; 0 diagnostics** | exit 0 |
| XR typecheck | `npm run xr:typecheck` | **Passed; 0 diagnostics** | exit 0 |
| Emulator e2e, Quest 3 profile, hands only | `node e2e/run.ts` via runner | Not started; no new run file | runner output |
| Emulator e2e, Meta VR Glasses profile | `node e2e/glasses.ts` via runner | Not started; no new run file | runner output |
| Landing + app 2D page at 375 / 1280 px | `node e2e/landing.ts https://localhost:8443/` via runner | Not started; no new 12-check run file | runner output |

`bash scripts/run-all-e2e.sh` stopped at **Acquiring heavy slot**, before its dev-server status or startup
steps. The slot remained held by `mebae`; the waiter was interrupted (exit 130) because this sandbox also
prevents the localhost listeners needed for verification. Its cleanup trap ran. Thyra never acquired the slot
and started no dev server or browser. The slot owner files were checked afterward: no line starts with
`thyra`; the other owner was left untouched. No fresh e2e duration, room timings, frame times or draw calls
are available. The runner did not reach `node scripts/landing-data.ts`.

The worktree initially had no dependencies. Registry DNS was unavailable (`ENOTFOUND registry.npmjs.org`),
so the existing dependency directories were copied from the main checkout after both lockfiles were checked
identical. No lockfile or product code was changed.

**No device run and no Meta model run.** `MODEL_API_KEY` is unset for emulator suites; the no-key path shows
Setup required and a CC0 sample stamped *Sample, not generated*. An Apple M4 emulator frame time is not a
Quest CPU or GPU frame time. The Quest target (p95 ≤ 13.9 ms at 72 Hz) remains unmeasured.

## Historical emulator evidence

The files in [`deployments/e2e/`](deployments/e2e/) are retained as history. They do not establish a fresh pass
of the merged landing. The previous per-room timing and frame-time tables have been removed because they
did not match their cited run; no guessed replacement metrics are reported.

- Hands-only schedule source: [`2026-10-25T11-04-22-665Z.json`](deployments/e2e/2026-10-25T11-04-22-665Z.json).
- Glasses: [`glasses-2026-10-25T11-06-53-722Z.json`](deployments/e2e/glasses-2026-10-25T11-06-53-722Z.json).
- Pages: [`pages-2026-10-25T10-59-46-291Z.json`](deployments/e2e/pages-2026-10-25T10-59-46-291Z.json).

`packages/landing/data/schedule.json` still cites the historical hands-only file above. Its four `to_world`
strings were checked against that file's `to_world_ms / 1000`, rounded to two decimal places, and all match.
It has not been regenerated or relabelled as a new run.

## Unit test coverage (Vitest, no mocks)

- `packages/room`: wall frames (axes, bounds, normal flipped toward the viewer, side walls), plane round trips,
  ray/wall hits and nearest-wall picking, polygon area, door rectangle (both drag directions, clamping, edge and
  floor snapping, the 0.40 × 0.60 m minimum, doors that overlap vs stand side by side), the room summary (spec shape, object sides and distances, nulls
  when the floor is unknown), the Step-in state machine (proximity, reach-through, 1.2 s flood, 0.5 m exit,
  re-arm), status → badges.
- `packages/pano`: sRGB → Lab, the CC0 samples read as `equirect`, a cropped copy → `equirect+seamfix`, a copy
  rolled 20 % down → `cylinder`, aspect check, seam fix (seam ΔE drops below 2, pole spread drops).
- `packages/gateway` (7 HTTP tests blocked in this attempt): without the key every model reports Setup required and plan/panorama/transcribe answer
  503 `setup_required`; no-key run records are stamped, patched, listed and deleted; bad JSON / sources / rooms
  are rejected; **a live call to api.meta.ai with an invalid key** returns the real 401 as a readable 502 that
  never contains the key (also checked in the stored run record); per-IP rate limit; the daily cap refuses calls
  without touching the network; `compose_portal` schema (unknown fields, bad hex, palette size, missing fields,
  range); the panorama contract is always appended; JPEG header size of the committed sample.

## Emulator coverage and measurement method

The hands-only suite uses IWER (IWSDK's browser-based immersive emulator) with SEM synthetic rooms and the
Quest 3 profile. It switches between `sunlit_living_room`, `thyra_studio`, `thyra_hall` and `bedroom`. Per room:
pick a wall, pinch-drag a door with the right hand ray, pinch a destination on the door card, open the sample
world, compare pixels inside and outside the frame, step in by walking toward the door, exit and close it.
It also checks the minimum door size, three-door limit and oldest-door replacement, no-wall paper placement,
Setup required badges, and console errors. Fresh passed/failed counts and duration remain unavailable.

Fresh per-room release-to-world seconds are unavailable for all four rooms. In the no-key path this measure
includes a deliberate 0.9 s hold on the room read plus sample decoding and GPU upload; it is not the Muse
Spark + Muse Image time to world. Emulated exact rays cannot establish real-hand registration quality.

The frame-time measurement samples 600 frames with three doors open while the head pans across them.
`window.__thyraPerf` records CPU milliseconds from the ECS update start through `renderer.render`, with
p50 / p95 / max, draw calls p50 / max and triangles p50. All fresh values are unavailable in this attempt.
Desktop headless Chromium on an Apple M4 cannot establish Quest performance or GPU timing.

The glasses suite selects `metaVRGlasses`, checks that `gaze-tracking` is granted, draws a door using gaze
and hand pinch, measures the door card's corner angles against the narrower glasses view, opens a sample
world by gazing at a destination and pinching, and checks console errors. Fresh card angles and counts are
unavailable. The pages suite must check both the landing and app 2D page at 375 and 1280 px: horizontal
scroll, rendered schedule/status badges, and console errors (12 checks total).

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
