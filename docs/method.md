# Method

## Wall frames and door drawing (`packages/room`)

A WebXR plane is a pose (plane space → world, local +Y = surface normal) plus a polygon in local X/Z. For a
vertical plane Thyra builds a drawing frame: **N** = the normal flipped toward the viewer, **V** = world up
projected into the plane (gravity-aligned), **U** = V × N (to the viewer's right). The polygon's (u, v) bounds
are the drawable area. The hand ray is intersected with each facing wall; the nearest hit inside its bounds
wins. While the pinch is held, the ray is intersected with the *same* wall's infinite plane, so dragging past
an edge clamps instead of jumping walls. The rectangle is min/max of the two points, clamped to the bounds,
snapped to an edge within 5 cm and to the floor (V of the floor plane's height) within 5 cm; doors under
0.40 × 0.60 m are rejected.

## Room summary

Exactly what Muse Spark receives, built from planes and labelled meshes only:

```json
{
  "portal": {"w_m": 1.2, "h_m": 2.05, "bottom_m": 0.0, "wall": {"label": "wall", "w_m": 5.0, "h_m": 2.7}},
  "viewer": {"eye_height_m": 1.6, "distance_to_portal_m": 3.4},
  "room": {"ceiling_m": 2.7, "floor_area_m2": 29.0,
           "objects": [{"label": "couch", "dims_m": [2.3, 0.86, 0.94], "side": "in front", "distance_m": 0.52}]},
  "light": {"available": false},
  "local_time": "19:40",
  "destination_text": "a misty pine forest"
}
```

Floor = the plane labelled `floor`, else the lowest horizontal plane below the head; ceiling likewise above.
Objects: bounded meshes with a semantic label, as world AABBs; `side` is left/right along the wall, `in front`
(between wall and viewer) or `behind the wall` (dropped); distance is horizontal from the door's bottom centre;
the nearest 8 within 4 m are kept. Unknown values are `null`, never guessed.

## Panoramas (`packages/pano`)

Muse Image is asked for `size: "2048x1024"` and an equirectangular prompt (the gateway appends the panorama
contract to whatever Spark wrote). The decoded image is checked on a 512-px copy:

- **size**: the real returned W×H (also read from the file header on the gateway);
- **seam ΔE**: mean CIE76 ΔE between the first and last column, compared with the image's own typical
  neighbouring-column ΔE (threshold max(6, 3 × inner));
- **horizon row**: the split of the 20–80 % band that best separates rows above from below (two-segment
  least squares on row-mean Lab). It finds the sky/ground boundary, which can sit a few % off the geometric
  horizon (Satara Night reads 5.5 % off and falls back to `cylinder`).

`pano_mode`: aspect off 2:1 by > 0.15 or horizon off by > 5 % → `cylinder`; seam over threshold →
`equirect+seamfix` (64-px cross-fade across the seam at full res, 8 % pole caps); else `equirect`.

## Rendering (`packages/xr`)

- **Mask**: the door quad, 6 cm proud of the wall, writes stencil ref *k* (one per door) and nothing else. It
  carries IWSDK `DepthOccludable` (hard occlusion), so real objects in front of the wall (couch, hand) remove
  stencil pixels and the world never draws over them. 6 cm keeps wall-flush things and depth noise from cutting
  holes.
- **World**: three's `GroundedSkybox` geometry (radius 30 m, ground at the floor, projection centre at the eye
  height when the world opened) with a shader that tests stencil == *k*. The image's centre column faces the
  door. Because the projection centre is fixed in the room, moving your head changes what the door frames,
  including real parallax on the ground. `cylinder` mode: an open cylinder with sky/ground discs in the image's
  own top/bottom row colours.
- **Reveal**: a noise-thresholded dissolve with a lime edge (1.6 s); before it, sumi ink with a rising line.
- **Light**: additive glows on the wall around the door and on the floor in front of it (rgb added, destination
  alpha kept, so passthrough still shows); colour from the plan's `ambient_spill`, or the image's horizon band
  without a plan.
- **Step-in** (`stepIn` in `packages/room`): within 0.3 m of the door (head inside its rectangle) or an index tip
  behind the wall inside the door → flood over 1.2 s: a second copy of the world without the stencil, masked by
  angle from the door direction (a lime ring at the front), with rays that hit the floor within 1.6 m kept
  transparent. When inside, the windowed copy hides and a depth-only door the same size, 0.7 m behind you, keeps
  the passthrough room visible: the way back. Leaving the entry point by 0.5 m reverses it.
