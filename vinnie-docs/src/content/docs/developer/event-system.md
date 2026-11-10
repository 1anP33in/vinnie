---
title: "Event System"
description: "The event buses that connect the runtime and the UI."
sidebar:
  order: 11
---
Vinnie has four small in-process event buses. All events come from real operations; nothing is simulated.

| Bus | File | Events | Consumers |
| --- | --- | --- | --- |
| Agent | `src/agent/runtime/events.ts` | `agent.*` (21 types, see [Agent states](/agent-system/agent-states/)) | Agent store, activity bridge, dragon bridge, tool usage counters |
| MCP and skills | `src/mcp/events.ts` | `mcp.server_connecting`, `mcp.server_connected`, `mcp.server_disconnected`, `mcp.server_error`, `mcp.tool_discovered`, `mcp.tool_rejected`, `mcp.tool_started`, `mcp.tool_completed`, `mcp.tool_failed`, `skill.discovered`, `skill.activated`, `skill.deactivated`, `skill.loaded`, `skill.failed` | Activity feed |
| Dragon | `src/agent/events.ts` | `dragon.<state>` for 9 states | Dragon store → status indicator |
| Activity | `src/state/activityStore.ts` | Activity entries (start/finish) | Activity panel, dragon |

## Subscribing

```ts
import { onAgentEvent } from "@/agent/runtime/events";

const unsubscribe = onAgentEvent((e) => {
  if (e.type === "agent.tool_completed") console.log(e.label, e.data?.tool);
});
```

A subscriber that throws never breaks the emitter. Payloads carry names, counts, and short labels, never
credentials or tool arguments.
