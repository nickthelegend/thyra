# Thyra (θύρα)

**Open a door in your own wall.** On a Quest 3/3S (WebXR mixed reality, Meta's Immersive Web SDK), pinch your
real wall and drag a door frame open, then say where it should lead. Muse Voice Transcribe hears you, Muse Spark
reads your room (wall size, ceiling height, furniture labels, your eye height) and writes a world that fits it,
and Muse Image paints that world once as a panorama. It appears behind the wall, locked to the edges you drew,
with real head-tracked parallax. Reach in and step through.

No headset? The same app runs in a desktop browser on an emulated room (IWER), and a phone mode turns a real
doorway in a phone clip into the portal (SAM 3.1 tracking).

Meta Global AI Developer Hackathon 2026, Indie track. Status: **spec only**. Product code starts Oct 26, 2026
(event start). Without `MODEL_API_KEY` the app still detects walls and draws portals, using your own image or a
CC0 sample panorama, clearly labelled "not generated", and shows "Setup required" for the Meta models.

Spec: [`specs/thyra.md`](../../specs/thyra.md) in the grokbot handoff folder.

License: MIT (see [LICENSE](LICENSE)).
