---
title: "Ice Dragon Companion"
description: "Vinnie's 3D ice dragon and how it follows the agent."
sidebar:
  order: 1
---
The ice dragon is Vinnie's visual companion: a rigged 3D ice dragon in a panel beside the chat. It reacts to what
the agent is **actually** doing. Every posture and every line in its activity panel comes from the agent runtime's
own events. It's not a separate agent, it has no model of its own, and it never runs tools.

## Showing and hiding it

- The **snowflake** button in the toolbar shows or hides the dragon panel.
- **×** in the panel header hides it too. When it's hidden, the welcome screen offers **Show the ice dragon**.
- **Settings → Ice dragon → Show the ice dragon** turns it off completely. Then no 3D viewer is loaded at all; the
  dragon mark in the status bar still shows Vinnie's status.

## The panel

| Part | What it shows |
| --- | --- |
| Viewer | The dragon in a dark, icy scene. Drag to rotate the camera, scroll to zoom |
| Header | Vinnie's current state, plus **Reset camera**, **Pause/Resume idle animations**, **Viewer settings**, **Full screen**, and **Hide** |
| Activity | The current task, activity, tool, and agent state, and the most recent agent events |

The panel sits to the right of the chat and can be resized. Choose **Compact** layout (in the viewer settings or
under **Settings → Ice dragon**) to show a short strip above the chat instead. **Full screen** fills the window;
press <kbd>Esc</kbd> to leave it.

## If the dragon can't load

Vinnie works normally without it. The viewer shows what went wrong (for example a missing model file, or 3D
graphics not being available) and a **Retry** button. If the graphics driver resets, the viewer rebuilds itself.

See [Dragon states](/dragon/dragon-states/) for how it reacts, and
[Agent activity visualization](/dragon/agent-activity-visualization/) for where the information comes from.
