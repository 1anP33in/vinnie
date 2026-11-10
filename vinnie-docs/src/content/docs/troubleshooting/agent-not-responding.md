---
title: "Agent Not Responding"
description: "What to check when a task seems stuck."
sidebar:
  order: 4
---
## Check the status first

The agent panel and status bar say what Vinnie is doing:

| Status | What to do |
| --- | --- |
| *Vinnie is waiting for your permission…* | An approval card is open above the message box; approve or deny it |
| *Vinnie paused.* | Click **Resume** |
| *Vinnie is thinking…* for a long time | The model is generating or loading; see below |
| *Vinnie is running a command…* | A command is running; check the **Terminal** tab. It stops after the command timeout |
| *Vinnie is verifying…* | Project checks are running; see the Terminal |

## The model is slow

- Look at the **Terminal & activity** panel for progress.
- Check `ollama ps`: a model split between CPU and GPU is slow. See [Performance problems](/troubleshooting/performance-problems/).
- Reasoning models (such as `qwen3`) think before answering; with **Show model reasoning** on you can watch it.

## A command waits for input

Commands can't receive keyboard input (stdin is closed). A command that prompts ("Are you sure? (y/n)") waits
until the timeout. Stop it with the stop button in the Terminal, or press **Stop**.

## The task ended without doing anything

Read the task report. *"No files were changed."* or *"Plan steps not marked done"* means the model stopped early
(Vinnie already asked it once to continue). Try rephrasing the request more specifically, or use `qwen3:8b`.

## Limits

A task that stops with *"Maximum iteration limit reached."* or *"Maximum tool call limit reached."* hit the
limits under **Settings → Agent**. Raise them for long tasks.

## Stop always works

**Stop** cancels the model request, denies open approvals, and kills commands the task started.
