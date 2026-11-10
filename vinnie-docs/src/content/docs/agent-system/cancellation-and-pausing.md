---
title: "Cancellation and Pausing"
description: "Stop or pause the agent at any time."
sidebar:
  order: 10
---
## Stop

Press **Stop** in the agent panel or the square button in the message box. Stopping:

- cancels the current model request (the partial response is kept, marked interrupted);
- denies any open approval cards;
- stops commands this task started, including their child processes;
- cancels running MCP tool calls (the cancellation is sent to the server);
- ends the task as **cancelled**, with a task report if tools were used.

Changes already made **stay**. Review them, or use **Revert task**.

## Pause and resume

Press **Pause** in the agent panel, or the pause button next to Stop in the message box.

- Pausing takes effect **between steps**. A model reply or command that's already running finishes first.
  Use Stop to interrupt it.
- While paused, the status is *"Vinnie paused."*; nothing new starts.
- **Resume** continues where it left off.

While a task is running or paused, you can [edit the plan](/user-guide/task-planning/).

## Timeouts

Commands stop after the *Command timeout* (default 600 s). The whole task stops after the *Task timeout*
(default 30 min). MCP tools stop after their server's *Tool timeout* (default 60 s). See
[Settings](/user-guide/settings-and-preferences/#agent).
