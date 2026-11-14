---
title: "Agent Activity Visualization"
description: "Where the dragon's information comes from."
sidebar:
  order: 3
---
The dragon has a single source of truth: the agent runtime's event stream (`agent.*` events, see
[Agent states](/agent-system/agent-states/)). A small adapter (`src/dragon/eventAdapter.ts`) listens to those
events. It never emits events, calls the runtime, or schedules activity of its own.

For each event it records:

| Field | Taken from |
| --- | --- |
| State | The task's status in the event (for example `executing`, `waiting_for_permission`) |
| Task | The request you sent |
| Activity | The runtime's own label, for example *Reading src/app.ts*, *Waiting for your approval*, *Verifying changes* |
| Tool | The tool being run or awaiting approval, and its category (reading, searching, editing, running a command, installing dependencies, external MCP tool) |
| Recent | The last 8 events, such as *Task started*, *read_file succeeded*, *Approved*, *All 1 check passed* |

When a task finishes, the panel keeps a *Last task* line (for example *Last task: Completed · 2m*).

If the adapter can't connect to the event stream, the panel says so. The agent itself is unaffected.
