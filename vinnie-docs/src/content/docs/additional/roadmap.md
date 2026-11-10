---
title: "Roadmap"
description: "What's planned for Vinnie."
sidebar:
  order: 3
---
:::note
Items on this page are **planned**, not implemented. They may change.
:::

## Phase 5: Ice dragon viewer

An animated 3D ice dragon that reacts to Vinnie's real activity:

- built on the existing `agent.*`, `mcp.*`, `skill.*`, and dragon events, with a replay log for testing;
- loaded lazily, paused when hidden, with a fixed performance budget and reduced-motion support;
- animations for each [dragon state](/dragon/dragon-states/), debounced to avoid flicker;
- settings for on/off, size, and quality.

## Known gaps

From the current limitations:

- MCP resources, prompts, sampling, elicitation, and OAuth sign-in.
- **Full Auto** agent mode.
- Interactive commands (stdin) in the terminal.
- A file watcher (the editor checks for external changes every 3 seconds).
- Git-backed change history.
- Prebuilt installers and an automatic updater.
- Platforms other than Windows.

:::note[Requires documentation]
Timelines and priorities for these items aren't decided yet.
:::
