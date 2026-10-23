# Third-party assets

| Asset | Where | Source | Licence |
|---|---|---|---|
| Misty Pines (panorama) | `packages/xr/public/panoramas/misty_pines.jpg`, test copy in `packages/pano/test/fixtures/` | Greg Zaal, [Poly Haven](https://polyhaven.com/a/misty_pines) (tonemapped JPG, downscaled to 4096×2048) | [CC0](https://polyhaven.com/license) |
| The Sky Is On Fire (panorama) | `packages/xr/public/panoramas/the_sky_is_on_fire.jpg`, test copy in fixtures | Greg Zaal, Rico Cilliers (backplates), [Poly Haven](https://polyhaven.com/a/the_sky_is_on_fire) | CC0 |
| Satara Night (panorama) | `packages/xr/public/panoramas/satara_night.jpg` | Greg Zaal, [Poly Haven](https://polyhaven.com/a/satara_night) | CC0 |
| Host Grotesk, Ubuntu Sans Mono | npm `@fontsource/*` (app), Google Fonts (landing) | Fontsource / Google Fonts | SIL OFL 1.1 |
| IWER SEM room kit | not in this repo: `eval/rooms/build.mjs` reads it from the installed `@iwsdk/vite-plugin-dev` at build time | Meta, Immersive Web Emulation Runtime | MIT |

These panoramas are **stand-ins, not generated**: the app stamps them "Sample, not generated" on the door card
and in the run record. Muse Image output is only ever shown with `source: muse-image-1.0`.
