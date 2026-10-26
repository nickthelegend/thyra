# Testing

## Final audit — Oct 27, 2026 (Asia/Kolkata)

**108 PASS / 0 FAIL / 19 UNTESTED** across the original 127 plan rows. This is the final local run, not the October 25 historical run. [AUDIT.md](AUDIT.md) preserves all expected cells and names each fix.

The gateway started directly with explicitly empty MODEL_API_KEY, `/tmp/thyra-t5-audit-runs`, and no env-file loader. Vite used the empty `/tmp/thyra-t5-empty-env` directory. Chrome for Testing used IWER Quest 3 hands and Meta VR Glasses gaze + pinch. No physical headset or successful Meta inference was available.

| Execution | Actual result | Evidence |
|---|---|---|
| Unit tests | 56/56; 0 failed/skipped; 9 files | [unit-results.json](audit/unit-results.json) |
| Root and XR typechecks | both exit 0; 0 diagnostics | [root-typecheck.txt](audit/unit/root-typecheck.txt) |
| Production bundle / custom rooms | both exit 0 | [build.txt](audit/unit/build.txt) |
| Quest 3 hands, four rooms, guards and paper wall | 56/56 | [quest-checks.json](audit/xr/quest-checks.json) |
| Hand/card/room/Step-in supplement | 24/24 | [supplement.json](audit/xr/supplement.json) |
| Uploads, geometry, microphone error and re-entry | 11/11 | [edges.json](audit/xr/edges.json) |
| Rendering, eight stencil tags and three distinct worlds | 32/32 | [render.json](audit/xr/render.json) |
| Genuine mid-hold interruptions and measured way back | 5/5 | [interrupt.json](audit/xr/interrupt.json) |
| Glasses gaze/pinch, card fit and re-entry | 7/7 | [glasses-checks.json](audit/xr/glasses-checks.json) |
| Real session with depth disabled | 3/3 | [no-depth.json](audit/xr/no-depth.json) |
| Landing/app and negative/reduced/static checks | 63/63 | [pages-checks.json](audit/app/pages-checks.json) |
| Gateway HTTP contract | 45/45 | [checks.json](audit/gateway/checks.json) |
| Gateway fetches in actual Chrome | 30/30 | [browser-checks.json](audit/gateway/browser-checks.json) |
| Persisted PATCH across gateway restart | 2/2 | [restart-checks.json](audit/gateway/restart-checks.json) |
| Stopped-gateway interruption and recovery | 4/4 | [offline.json](audit/xr/offline.json) |
| Real JSON/non-JSON errors and timeouts | 5/5 | [client.json](audit/xr/client.json) |
| Depth occlusion A/B pixels | PASS: foreground ΔRGB 33.30; clear opening 0.95 | [occlusion.json](audit/xr/occlusion.json) |

Four principal page captures cover landing and app at **375×812 and 1280×812**. The complete pages suite used **9 contexts** including empty/missing schedule, reduced motion, static build and native-user-agent exclusion. Native immersive AR remains UNTESTED. Each Google Fonts URL/status is in [fonts.json](audit/landing/fonts.json).

## Fresh per-room measurements

Hands-only run: `2026-10-26T20:31:52.793Z` → `2026-10-26T20:34:03.061Z` (**130.268 s**). Each row loads the actual committed misty-pines CC0 image, stamped **Sample, not generated**, plan **Setup required**.

| Room | Door | Release → world | Off-plane max, reported | Pixel ΔRGB inside/outside | Reach-through flood |
|---|---|---|---|---|---|
| `sunlit_living_room` | 1.20 × 2.05 m | 2.160 s | 0.00 mm | 243.10 / 7.30 | 1.216 s |
| `thyra_studio` | 1.10 × 2.00 m | 2.109 s | 0.00 mm | 94.09 / 7.08 | 1.200 s |
| `thyra_hall` | 1.00 × 1.95 m | 2.091 s | 0.00 mm | 117.72 / 6.92 | 1.216 s |
| `bedroom` | 0.90 × 1.90 m | 2.090 s | 0.00 mm | 115.82 / 11.40 | 1.215 s |

These timings include the deliberate 900 ms room-read hold and actual sample decode/upload; they are not Meta latency. Off-plane values are the harness’s rounded measurements. Proximity and actual emulated index-tip reach-through both ran in every room.

## Fresh three-door frame sample

**600 frames / 600 immersive frames**, head panning across three worlds. CPU p50/p95/max **1.70/2.10/2.70 ms**; draw calls p50/max **244/304**; triangles p50/max **84,756/84,876**. Renderer: `ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)`.

These are desktop CPU submission timings. **The Quest CPU/GPU p95 ≤13.9 ms at 72 Hz gate is unmeasured. Successful Meta model calls, schemas, image quality/latency, transcription and policy refusals are unmeasured.** The existing invalid-key test reached real api.meta.ai and asserted 401→502; it proves negative authentication, not inference.

The genuinely suspended gateway measured **4002.4 ms** for status timeout and **130003.7 ms** for ordinary-call timeout. No transport replacement or canned response was used.

## Recording, errors and cleanup

New test clip: `/tmp/thyra-t5-videos/thyra-01-tear-open.mp4` — **34.967 s, 720×692, 30/1 fps, 1049 encoded frames**, from 1295 actual variable-rate screencast frames. Emulator/CC0 test footage, not physical capture or a submitted demo. The video is not committed. [Metadata](audit/xr/recording.json).

No mocks, stubs, fabricated model results or unexpected errors occurred on tested flows. Expected negative evidence includes schedule 404, revoked-file URL, reduced-motion media cancellation, API validation/Setup errors, stopped/suspended gateway requests and a real static host’s missing API. After all assertions, owned gateway shutdown also produced one status HTTP 500 and its matching console entry. Both remain explicitly listed in [verification.json](audit/verification.json). Browser page errors were zero.

Final evidence has **12 JPEGs**, each ≤200 KB, about **6.94 MB** before the final indexes. Superseded screenshots were deleted. All owned processes stopped by recorded PID, configuration restored byte-for-byte, and `thyra-audit-reverify` released. [Process evidence](audit/processes.json). No push, deploy, commit, secret-file read or `.loom/` edit occurred; Loom owns commit/merge.

MODEL_API_KEY, a physical Quest/native AR browser and usable microphone/browser speech service remain required for UNTESTED rows. Phone/SAM mode, a Thyra MCP server, realtime ASR WebSocket proxy, persistent anchors and virtual keyboard remain absent. The landing’s dated October 25 schedule remains explicitly historical; its numbers were not reused as current measurements.

Re-ran `npm test`, `npm run typecheck`, `npm run xr:typecheck`, `npm run xr:build`, `npm --prefix packages/xr run rooms`, `bash e2e/audit-final.sh` (including `node e2e/run.ts` and `node e2e/glasses.ts`), `node e2e/audit-gateway-browser.mjs`, `node e2e/audit-interrupt.ts`, and `node e2e/audit-restart.mjs`.
