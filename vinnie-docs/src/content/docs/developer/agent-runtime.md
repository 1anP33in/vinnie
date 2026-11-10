---
title: "Agent Runtime"
description: "The AgentRuntime class and its collaborators."
sidebar:
  order: 4
---
`src/agent/runtime/runtime.ts` defines `AgentRuntime`. The chat store creates one per request, with its
dependencies (`RuntimeDeps`) and input (`RunInput`).

## Collaborators

| Module | Role |
| --- | --- |
| `planner.ts` | Question/task classification, tool selection (including external-tool relevance), plan updates |
| `contextManager.ts`, `tokens.ts` | Context building, compression, token estimates, budget resolution |
| `toolExecutor.ts`, `recovery.ts` | Execution with retry guard, failure codes, recovery hints |
| `permissionManager.ts` | Mode, settings, and scoped grants → allow, ask, or refuse |
| `verification.ts` | File, JSON, manifest, and command checks |
| `memory.ts` | Task memory (30 facts) |
| `systemPrompt.ts` | The versioned agent prompt (4.0.0), skills section |
| `events.ts` | `agent.*` events and the dragon mapping |
| `redact.ts` | Secret redaction for the debug view |

## Public surface

```ts
const runtime = new AgentRuntime(deps, input);
const task = await runtime.run(); // resolves when the task ends
runtime.pause();
runtime.resume();
runtime.cancel();
runtime.editPlanStep(stepId, "New title");
runtime.removePlanStep(stepId);
runtime.task; // live AgentTask: status, plan, steps, changes, skills, usage, result
```

`deps.onUpdate(task)` is called on every change; the agent store mirrors it for the UI. The runtime persists
assistant and tool messages through `deps.persist` and writes the task report at the end.

## Tests

`runtime.test.ts`, `modules.test.ts`, and `integration.test.ts` drive the runtime with a scripted fake provider,
and real MCP servers from the official SDK over an in-memory transport.
