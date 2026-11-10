---
title: "Planning and Reasoning"
description: "How Vinnie decides between answering and planning."
sidebar:
  order: 3
---
## Questions versus tasks

Vinnie classifies every request before the first model call:

- It's a **task** if it contains an action word such as *add, create, make, build, fix, implement, write,
  update, change, refactor, rename, move, delete, remove, install, upgrade, run, test, migrate, configure,
  edit*, or *format*.
- It's a **question** if it starts like a question (*what, where, which, why, how, is, does, explain, show me,
  list, describe, summarize*…) or ends with `?`, and has no action word.

| | Question | Task |
| --- | --- | --- |
| Tools offered | Read, search, project info, and commands; read-only MCP tools | All tools the mode allows |
| Plan | No | Yes, for multi-step work |
| Verification | Only if files changed | Yes, if files changed |
| Task report | Only if tools were used | Yes |

## The system prompt

The agent system prompt is versioned (currently **4.0.0**, shown in the [debug view](/user-guide/task-planning/#the-debug-view)).
It tells the model to:

1. inspect before changing anything (`get_project_info`, `search_files`, `read_file`);
2. write a plan with `update_plan` for multi-step changes;
3. make the **smallest** change that fulfils the request, reading a file before modifying it;
4. check its work with the project's test, build, or lint command when one exists;
5. read error messages and recovery hints, and never repeat an identical failing call;
6. not retry denied actions;
7. use `remember` for facts it needs later;
8. finish by saying what changed and how it was checked.

It also contains mandatory honesty rules: never claim an action happened, or tests passed, unless a tool
result says so, and never invent files, commands, or results.

## Reasoning models

Models such as `qwen3` produce reasoning before their answer. Vinnie shows it in a collapsible panel (if
enabled) but doesn't treat it as instructions or as evidence. Only tool results count.
