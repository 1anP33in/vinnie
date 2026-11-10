---
title: "Task Planning"
description: "Follow and edit the agent's plan, and read the task timeline."
sidebar:
  order: 6
---
For tasks with several steps, the model writes a visible **plan** with the `update_plan` tool, usually 3–8
short steps, and updates step statuses as it works.

## The plan in the agent panel

| Mark | Meaning |
| --- | --- |
| ✓ | Done |
| → | In progress |
| ○ | Pending |
| ⤼ | Skipped |

While the task runs, hover a step that isn't done to **edit** its text (pencil) or **remove** it (×). The plan
then shows *edited by you*, and the edited plan is part of what the model sees on its next step.

## When the plan isn't finished

If the model stops while plan steps are still pending, or without changing anything for a task, Vinnie asks
it **once** to continue or explain. If steps are still unfinished at the end, the task report says
*"Plan steps not marked done: …"* instead of claiming full success.

## The task timeline

Every agent task has a timeline of real runtime events: thinking, planning, tool calls (with results),
permission requests, retries, verification, pauses. Each entry has a time and a status mark.

- In the agent panel, click **Timeline (n)** to expand it.
- In the bottom panel's **Task** tab, pick any task from this session and see its full timeline.

## The debug view

Turn on **Settings → Agent → Task debug view**. The **Task** tab then offers a **Debug view** checkbox that
shows:

- task id, model, agent prompt version, mode, and request type;
- iterations, tool calls, retries, and token usage (prompt, completion, peak, and context budget);
- the task memory;
- every tool call with its arguments, result, and duration.

Values that look like secrets (API keys, tokens, passwords, `.env` lines) are replaced with `[redacted]`.
