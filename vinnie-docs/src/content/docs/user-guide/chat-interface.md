---
title: "Chat Interface"
description: "Send messages, read responses, and control generation."
sidebar:
  order: 2
---
## Sending a message

Type in the message box at the bottom and press <kbd>Enter</kbd>. Use <kbd>Shift</kbd>+<kbd>Enter</kbd> for a
new line. The box grows as you type.

On an empty conversation, the welcome screen offers suggestions. With a project open, they're project tasks
such as *"Give me an overview of this project."* or *"Run the tests and explain any failures."* Click one to
put it in the message box.

## While Vinnie responds

- The response **streams** in as it's generated.
- Models that think first (such as `qwen3`) show a collapsible **reasoning** panel. Turn it off under
  **Settings → Appearance → Show model reasoning**.
- The **Stop** button (square) replaces the send button. Stopping keeps the partial response, marked as
  interrupted.
- During agent tasks, a **Pause** button appears next to Stop.

## Buttons next to the message box

| Button | When it shows | What it does |
| --- | --- | --- |
| Send | Idle | Sends the message |
| Stop | While generating | Stops generation, denies pending approvals, and stops commands the task started |
| Pause / Resume | During agent tasks | Pauses between steps; see [Cancellation and pausing](/agent-system/cancellation-and-pausing/) |
| Skills (book) | When skills are installed | Turns skills on or off for this session; see [Managing skills](/skills/managing-skills/) |

## How responses are rendered

Responses are Markdown with syntax-highlighted code blocks and copy buttons. For safety, raw HTML in a
response is never rendered, code is never executed, and remote images are never loaded.

## When something goes wrong

Errors appear above the message box with a short explanation and, where it helps, a command to run, for
example `ollama pull qwen3:8b` when a model is missing. If a response fails partway, the partial text is kept
and **Retry** generates a new response to your last message. See
[Common error messages](/troubleshooting/common-error-messages/).

## Tools in chat

When **Settings → Assistant permissions → Let Vinnie use project tools** is on and a project is open, every
message can use tools. Tool activity appears inline in the conversation and in the Activity feed. Without a
project, only [MCP tools](/mcp/introduction/) and the agent's own planning tools are available.
