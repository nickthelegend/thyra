# Thyra (θύρα)

**Open a door in your own wall.** On a Quest 3/3S (WebXR mixed reality, Meta's Immersive Web SDK) you pinch a
real wall and drag a door frame open, then say where it should lead. Muse Spark reads your room (wall size,
ceiling height, furniture beside the door, your eye height) and writes a world that fits it, Muse Image paints
that world once as a panorama, and it appears behind the wall, locked to the edges you drew, with real
head-tracked parallax. Walk up to it and step through.

Meta Global AI Developer Hackathon 2026, Indie track. Spec: [`specs/thyra.md`](../../specs/thyra.md) in the
grokbot handoff folder. Licence: MIT.

> **Status (Oct 27, 2026):** the latest recorded run is the Oct 27 emulator audit in [TESTING.md](TESTING.md):
> **108 PASS / 0 FAIL / 19 UNTESTED**. The whole loop runs in the IWER emulator with emulated hands (Quest 3
> and Meta VR Glasses). There is no physical Quest session and no successful Meta model call. `MODEL_API_KEY`
> is absent, so every Meta step says **Setup required**, and worlds are CC0 samples stamped *Sample, not
> generated*. Desktop CPU timings are not the Quest 13.9 ms gate. The Oct 24 code versus Oct 26 build-window
> eligibility note stays unresolved: the spec says product code starts Oct 26; this code was written on Oct 24
> at Nick's request, so check the Official Rules' pre-existing-code clause before submitting.

## What you see

1. **Find a wall.** Detected walls get a faint lime hairline when your hand ray crosses them, with a reticle
   where it lands. No walls after 5 s: "No walls found. Run Space Setup, or pinch two points to place a paper
   wall" (the paper wall is labelled virtual).
2. **Draw the door.** Pinch and drag. The rectangle grows in the wall's own plane coordinates, clamped to the
   wall and snapped (5 cm) to its edges and the floor; minimum 0.40 × 0.60 m. A dimension line and door tag
   (P-01 …) sit above it, like an elevation drawing. Release and the wall tears open from a slit.
3. **Say where.** A door card floats beside it: destination chips, *Say it* (Muse Voice Transcribe through the
   gateway; browser speech only as a labelled fallback), *Close door*. Without the key the generate chip says
   *Setup required: MODEL_API_KEY*.
4. **The room is read.** The card shows the room summary (the exact JSON Muse Spark receives), then Spark's
   one-line rationale. While the world is made, the opening is sumi ink with a rising lime line (never a fake
   percentage).
5. **The world opens.** A painterly reveal; the panorama is centred on your eyes with its ground at your real
   floor, drawn only inside the door (stencil). Light spills onto the wall and floor in the plan's colour, motes
   hang behind the wall, particles drift out into the room, and real objects in front of the wall (a couch,
   your hand) still hide the door (depth occlusion).
6. **Step in.** Walk within 0.3 m or reach through: the world floods around you over 1.2 s, the real floor
   near your feet stays visible, and a lime door behind you shows your room: the way back. Move 0.5 m and
   you're back.
7. **More doors.** Up to three at once, on any walls; a fourth closes the oldest.

## Packages

| Package | What |
|---|---|
| [`packages/xr`](packages/xr) | IWSDK app: room read, pointer (hand ray, controller, gaze + pinch, mouse), door drawing, portal rendering (stencil, ground-projected sphere or cylinder, ink, trim, spill, particles, Step-in), door card, 2D page |
| [`packages/room`](packages/room) | pure TS: wall frames, ray picking, door rectangle clamping/snapping, the room summary, Step-in state machine, status → badges |
| [`packages/pano`](packages/pano) | pure TS: panorama checks (size, seam ΔE, horizon row, pole spread), `pano_mode` choice, seam fix |
| [`packages/gateway`](packages/gateway) | Node (built-ins only): the only holder of `MODEL_API_KEY`; Muse Spark/Wonder `compose_portal`, Muse Image, Muse Voice Transcribe, run records, per-IP rate limit, daily $ cap |
| [`packages/landing`](packages/landing) | static landing: a drawing sheet with the door schedule of real (emulator) runs |
| [`eval/rooms`](eval/rooms) | our emulator rooms (`thyra_studio`, `thyra_hall`) on IWER SEM's room kit |
| [`e2e`](e2e) | emulator e2e (hands only), glasses profile, page checks, clip recorder |

Deviations from the spec, on purpose: the gateway is TypeScript (one language, shares the room/pano code)
instead of FastAPI; the in-headset UI is Canvas-drawn panels in the brand fonts (one input path for walls and
UI) instead of UIKitML/MSDF; the draw snap is 5 cm instead of 2 cm (hand-ray jitter). Not built yet: phone clip
mode (SAM 3.1), the MCP server, the realtime ASR WebSocket proxy, persistent anchors, the virtual keyboard.

## Run it

```bash
# once
npm install                      # root: vitest, typescript
npm --prefix packages/xr install # IWSDK app (Node 22+)
npm --prefix packages/xr run rooms

# the gateway (reads MODEL_API_KEY from .env; without it everything says Setup required)
cp .env.example .env             # put the key in .env yourself; never commit it
npm run gateway                  # http://127.0.0.1:8430

# the app (managed Chromium with the IWER emulator)
cd packages/xr && npx iwsdk dev up     # https://localhost:8443/ and https://<your-mac-ip>:8443/
```

### Run it on a Quest (for Nick)

Three ways, easiest first. All need the gateway running on the Mac if you want Meta models (`npm run gateway`).

1. **Same Wi-Fi, local HTTPS dev URL.** Start the dev server (`cd packages/xr && npx iwsdk dev up --no-open`),
   read the network URL (`npx iwsdk dev status` → `runtimeUrls.network`, e.g. `https://192.168.0.6:8443/`), open
   it in the Quest Browser and accept the self-signed certificate warning once. The page's `/api` is proxied to
   the gateway on the Mac, so the key never leaves the Mac. Tap **Enter mixed reality**.
2. **USB + adb reverse (no certificate warning).** Plug the Quest in (developer mode), run
   `adb reverse tcp:8443 tcp:8443`, then open `https://localhost:8443/` in the Quest Browser. `localhost` is a
   secure context, so WebXR and the mic work. (IWSDK can also drive the real headset:
   `npx iwsdk dev up --native-xr-control`.)
3. **Deployed (not done yet).** `npm run xr:build` writes `packages/xr/dist/` (static; it injects the emulator
   only off-Quest). Host it on any HTTPS static host (GitHub Pages or Vercel) and run the gateway on a host Nick
   picks, with `THYRA_ALLOWED_ORIGINS=<that origin>` and a daily cap; point the app at it with
   `?gateway=https://…` or `VITE_THYRA_GATEWAY` at build time. Nothing is deployed and nothing is pushed.

Before you start: do **Space Setup** on the Quest (walls must be detected). Device checklist (record the
answers in TESTING.md): walls found after Space Setup, `_plane.semanticLabel` values, frame time, whether the
mic works in the Quest Browser.

### No headset

Open the app URL in desktop Chrome: it runs in the IWER emulator on a synthetic room, labelled
"Emulated room (IWER), not your room". In a session, drag on a wall with the mouse.

## Numbers (emulator only)

Latest recorded emulator run: the Oct 27, 2026 final audit in [TESTING.md](TESTING.md), **108 PASS / 0 FAIL /
19 UNTESTED**. These figures are desktop IWER runs on an Apple M4, not a Quest. There is no physical Quest
session and no successful Meta model call. `MODEL_API_KEY` is absent, so every Meta step says **Setup
required**, and worlds are CC0 samples stamped *Sample, not generated*. Desktop CPU timings are not the Quest
13.9 ms gate. The Oct 24 code versus Oct 26 build-window eligibility note stays unresolved.

| What | Recorded result | Evidence |
|---|---|---|
| Final audit | **108 PASS / 0 FAIL / 19 UNTESTED** | [TESTING.md](TESTING.md) |
| Unit tests | **56 / 56 passed**, 0 failed, 0 skipped; 9 files | [unit-results.json](audit/unit-results.json) |
| Root and XR TypeScript checks | Both exit 0; 0 diagnostics | [root-typecheck.txt](audit/unit/root-typecheck.txt), [xr-typecheck.txt](audit/unit/xr-typecheck.txt) |
| Emulator e2e, Quest 3 hands only, 4 rooms | **56 / 56 passed**, 0 failed; **130.268 s** (`2026-10-26T20:31:52.793Z` → `2026-10-26T20:34:03.061Z`) | [quest-checks.json](audit/xr/quest-checks.json) |
| Meta VR Glasses profile (gaze + pinch) | **7 / 7 passed**, 0 failed | [glasses-checks.json](audit/xr/glasses-checks.json) |
| Landing, app, and negative / reduced-motion / static checks | **63 / 63 passed**, 0 failed; captures at 375×812 and 1280×812 across 9 contexts | [pages-checks.json](audit/app/pages-checks.json) |
| Per-room time to world, sample path | **2.160 / 2.109 / 2.091 / 2.090 s*** (living room / studio / hall / bedroom) | [TESTING.md](TESTING.md), [quest-checks.json](audit/xr/quest-checks.json) |
| Three open doors, CPU p50 / p95 / max | **1.70 / 2.10 / 2.70 ms**, 600 frames / 600 immersive frames; desktop CPU, not the Quest 13.9 ms gate | [TESTING.md](TESTING.md), [quest-checks.json](audit/xr/quest-checks.json) |
| Three open doors, draw calls p50 / max; triangles p50 / max | **244 / 304** draws; **84,756 / 84,876** triangles | [TESTING.md](TESTING.md), [quest-checks.json](audit/xr/quest-checks.json) |

*No-key sample path: each room loads the committed misty-pines CC0 image, stamped *Sample, not generated*,
plan **Setup required**. The time includes the deliberate 900 ms room-read hold and actual sample
decode/upload. It is not Muse Spark or Muse Image latency. CPU figures are desktop submission timings on
`ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)`. The Quest CPU/GPU p95 ≤13.9 ms at 72 Hz
gate is unmeasured.

The latest hands-only run is that Oct 27 window in [quest-checks.json](audit/xr/quest-checks.json). The
October 25 files under `deployments/e2e/`, including `2026-10-25T11-04-22-665Z.json`,
`glasses-2026-10-25T11-06-53-722Z.json`, `pages-2026-10-25T04-51-34-608Z.json`, and the later same-day pages
files at 10:57 and 10:59 UTC, are the older historical run. They are not the latest hands-only, glasses, or
pages result.

Per-room geometry, pixel checks, glasses card angles, frame measurements and clips: [TESTING.md](TESTING.md).

## Privacy

| Data | Where it goes | Stored |
|---|---|---|
| Passthrough camera | nowhere (WebXR gives no pixels) | no |
| Room geometry (sizes, labels, distances) | gateway → Muse Spark | run record (summary only) |
| Your voice | gateway → Muse Voice Transcribe; or browser speech (labelled) | no audio stored |
| Destination, plan, panorama | Meta (Spark, Image) | gateway `deployments/runs/`; `DELETE /api/runs/{id}` |

No analytics, no third-party scripts in the app.

## Credits

Sample panoramas: Greg Zaal (and Rico Cilliers), Poly Haven, CC0; see [ASSETS.md](ASSETS.md). Built with Meta's
Immersive Web SDK, IWER and three.js.

License: MIT (see [LICENSE](LICENSE)).
