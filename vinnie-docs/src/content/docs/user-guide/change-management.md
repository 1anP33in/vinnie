---
title: "Change Management"
description: "Every change is recorded and can be reverted."
sidebar:
  order: 9
---
Vinnie keeps a **local history of changes** to project files, whether you made them in the editor or the
agent made them.

## What's recorded

For every create, modify, delete, or move:

- the file path (and new path for moves);
- who made it (you or the assistant) and, for the agent, which task;
- a snapshot of the content before and after (files up to 10 MB);
- the number of added and removed lines;
- the time, and whether it was later reverted.

The history is stored in Vinnie's database, separate from Git.

## The Changes panel

Open **Changes** from the activity rail to see the history for the current project, newest first.

- Click a change to open its **diff**.
- **Revert** restores the file to its state before that change. If the file changed again since, Vinnie
  warns you and lets you decide.
- **Refresh changes** reloads the list.

## Reverting an agent task

In the agent panel, after a task finishes:

| Action | Effect |
| --- | --- |
| **View** | Opens that file's diff |
| **Revert file** | Reverts this task's changes to one file |
| **Revert task** | Reverts every change the task made, newest first |
| **Accept changes** | Keeps the changes and hides the revert buttons for this task |

Reverting is itself safe: the current content is checked against the recorded snapshot first, so Vinnie
doesn't silently overwrite edits made after the task.

:::caution
Changes made through **MCP tools** (for example a GitHub issue, or a file written by an MCP filesystem server)
happen outside Vinnie's change history and can't be reverted from the Changes panel. Their approval cards say so.
:::
