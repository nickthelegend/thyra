# Tobira (扉)

**Any doorway, anywhere.** Point your phone at a doorway and say where it should lead. Muse Spark checks it
really is a doorway and plans the scene, Muse Image paints the destination once, SAM 3.1 (or SAM 2.1 locally)
tracks the opening through the video, and every frame is re-projected from the solved camera pose with depth
layers, so the place behind the door shifts with real perspective and parallax as you walk.

Meta Global AI Developer Hackathon 2026, Indie track. Status: **spec only**. Product code starts Oct 26, 2026
(event start). Without `MODEL_API_KEY` the app runs SAM 2.1 tracking with your own image as the destination,
clearly labelled, and shows "Setup required" for the Meta models.

Spec: [`specs/tobira.md`](../../specs/tobira.md) in the grokbot handoff folder.

License: MIT (see [LICENSE](LICENSE)).
