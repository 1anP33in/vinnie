---
title: "Agent Activity Visualization"
description: "How real events become dragon states."
sidebar:
  order: 3
---
Dragon states come from two sources, both emitted only by real operations:

| Source | Mapping |
| --- | --- |
| Agent events | `agent.started`/`thinking`/`planning`/`retrying` → thinking; `agent.tool_started` → reading (read, search, project tools), editing (write, delete), running (commands, installs), or working (others); `agent.permission_requested`/`paused` → waiting; `agent.verifying` → running; failures → error; `agent.verification_passed`/`completed` → success; `agent.cancelled`/`stopped` → idle |
| Activity feed | searches, reads, and analysis → reading; edits → editing; commands and installs → running |

Each change is a `dragon.<state>` event with a label, for example `dragon.reading` "Reading server.js". The label
is what the status bar shows. See [Event system](/developer/event-system/).
