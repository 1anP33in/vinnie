---
title: "Task Memory"
description: "Short facts the agent keeps for the rest of a task."
sidebar:
  order: 6
---
Task memory is a short list of facts that survives [context compression](/agent-system/context-management/),
so the agent doesn't forget important details in long tasks.

## What goes into memory

Vinnie adds facts automatically:

| Event | Example fact |
| --- | --- |
| A file is read | `Read server.js.` |
| A file changes | `Changed server.js (modify).` |
| A tool fails | `read_file failed (FILE_NOT_FOUND): missing.lua was not found.` |
| You approve | `User approved: run "npm test" (for this task).` |
| You deny | `User denied: delete src/old.ts. Do not retry it.` |

The model can add its own facts with the `remember` tool, for example where something lives or a decision you
made:

```json
{ "function": { "name": "remember", "arguments": { "fact": "Routes are registered in src/routes/index.ts" } } }
```

## Limits

- At most **30 facts**; the oldest are dropped first.
- Duplicate facts are kept once.

## Where you can see it

Memory is part of the system prompt on every step of a task. To inspect it, turn on
**Settings → Agent → Task debug view** and open the **Task** tab in the bottom panel.

Memory belongs to a single task. A new request starts with empty memory; earlier tasks are visible to the model
only through the conversation history.
