---
title: "Performance Settings"
description: "Graphics quality and the dragon's resource use."
sidebar:
  order: 5
---
The viewer is built to stay out of the agent's way:

- three.js and the model load only when the dragon is shown. With the dragon off, none of it is loaded.
- Rendering runs at a capped frame rate, and at about two-thirds of it while the dragon is resting.
- Rendering stops while the panel is hidden, scrolled out of view, or the window is minimized.
- Hiding the panel frees its graphics resources. The model stays in memory, so showing it again is quick.
- Rendering runs separately from the agent and never waits for it.

## Graphics quality

| | Low | Medium (default) | High |
| --- | --- | --- | --- |
| Frame-rate cap | 30 fps | 45 fps | 60 fps |
| Resolution | 1× | up to 1.25× | up to 2× (screen) |
| Anti-aliasing | Off | On | On |
| Shadows | Off | 1024 px | 2048 px |
| Snow particles | 120 | 380 | 900 |
| Ice sparkles | 6 | 14 | 28 |
| Floor reflection | — | — | Mirror reflection |
| Ice crystals | Translucent | Translucent | Glass-like (transmission) |

On a slow computer, choose **Low** and turn off **Lighting effects**, or hide the dragon.

## The model

The dragon is a 12 MB glTF file (`public/models/vinnie_dragon.glb`) with about 90,000 triangles, a 70-bone rig,
and baked textures. Its source project lives in `vinnie-blender-model/vinnie-dragon/`.
