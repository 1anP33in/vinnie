---
title: "Performance Settings"
description: "The dragon's performance impact."
sidebar:
  order: 5
---
The current status indicator is a small SVG with a CSS animation and has no measurable performance cost. Use
**Reduce visual effects** to disable its animation on slow machines.

:::caution[Planned]
The planned 3D viewer is designed to load lazily, pause when hidden, respect reduced-motion preferences, and keep
a fixed rendering budget so it never slows down chat or the agent. Its performance settings will be documented
when it ships.
:::
