# Submission form draft: Meta Global AI Developer Hackathon 2026 (Indie track)

Status: **draft**. Nothing here is submitted. Numbers come from `deployments/e2e/*.json` (emulator) and are
labelled as such; Meta model numbers wait for `MODEL_API_KEY`.

- **Project name:** Thyra (θύρα, Greek "door")
- **Track:** Indie, "Push the Frontier"
- **One line:** Pinch your real wall, drag a door open, say where it leads: Muse Spark reads your room's measurements and Muse Image paints the world behind the wall, with real head-tracked parallax.
- **Repository:** _(Nick creates the GitHub repo and pushes)_
- **Demo video (≤ 3 min):** _(to record; emulator clips in `grokbot/videos/thyra/` are test recordings, not the demo)_
- **Try it:** _(hosted URL once Nick picks hosting; local instructions in README "Run it on a Quest")_

## What it does

On a Quest 3/3S (WebXR `immersive-ar`, Meta's Immersive Web SDK) you pinch a detected wall and drag a door
frame open; it stays locked to the wall's real edges and snaps to the floor. You say or pick where it leads.
Thyra builds a **room summary** (door size and sill, wall size, your eye height and distance, ceiling, floor
area, labelled furniture beside the door; no pixels) and Muse Spark turns it into a `compose_portal` plan; Muse
Image paints the destination once as a 2:1 panorama. The panorama is checked (returned size, seam ΔE, horizon
row) and mapped as a sphere, seam-fixed sphere or cylinder. It's drawn through a stencil window centred on your
eyes with the ground at your floor, so the view through the door shifts like a real window as you move; real
objects in front of the wall still hide it (depth sensing). Walk up to it and the world floods around you, with
the floor near your feet kept real and a lime door behind you leading back.

## Meta models used

| Model | Use | Status |
|---|---|---|
| `muse-spark-1.3` | room summary → `compose_portal` plan (strict schema) | client written to the documented Chat Completions shape; **Setup required** until the key exists |
| `muse-image-1.0` | the destination panorama (`size: 2048x1024`) | same |
| `muse-voice-transcribe-1.0` | spoken destination (WAV via the gateway) | same; browser speech is the labelled fallback |
| `muse-wonder-1.0` | A/B planner | gateway accepts it; not benchmarked yet |

## How it's built

TypeScript monorepo: `packages/xr` (IWSDK app), `packages/room` (pure geometry + room summary + Step-in),
`packages/pano` (panorama checks), `packages/gateway` (the only holder of the key; rate limit, daily cap, run
records), `packages/landing`. Emulator e2e on IWER + SEM synthetic rooms with emulated hands only.

## Honest limits

- No headset session yet: plane labels, frame time on device, anchors and real parallax feel are unverified on
  hardware. Every number in the README says emulator or device.
- Muse Image isn't documented to make panoramas; Thyra asks for one and checks what comes back.
- No light estimation on Quest (assumed); the summary says `light: {available: false}`.
- Phone clip mode (SAM 3.1) from the spec is not built.

## Team

Nivesh Gajengi (solo). MIT licence.
