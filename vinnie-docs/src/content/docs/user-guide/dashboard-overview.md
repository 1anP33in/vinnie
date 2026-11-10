---
title: "Dashboard Overview"
description: "A tour of Vinnie's main window."
sidebar:
  order: 1
---
Vinnie's window has five areas.

```text
┌──────┬──────────────┬───────────────────────────────────────────────┐
│ Rail │ Side panel   │ Toolbar: title · project · model · Ollama · ⚙ │
│      │              ├───────────────────────────────────────────────┤
│  💬  │ Conversations│                                               │
│  🗂  │ Explorer     │   Editor tabs (when files are open) │ Chat    │
│  🔍  │ Search       │                                               │
│  ⇄   │ Changes      ├───────────────────────────────────────────────┤
│ ──── │              │ Bottom panel: Terminal · Activity · Task      │
│  🔌  │              │                                               │
│  📖  │ Project      ├───────────────────────────────────────────────┤
│  🔧  │              │ Status bar: Vinnie · Ollama · Generation      │
└──────┴──────────────┴───────────────────────────────────────────────┘
```

## Activity rail (far left)

| Icon | Opens |
| --- | --- |
| Conversations | Your saved conversations and conversation search |
| Explorer (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd>) | The project's file tree and project information |
| Search (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd>) | Search across the project |
| Changes | The history of changes to project files |
| MCP servers | The [MCP manager](/mcp/managing-mcp-servers/) |
| Skills | The [skills manager](/skills/managing-skills/) |
| Tools | The [Tool Explorer](/mcp/discovering-tools/) |
| Terminal & activity (<kbd>Ctrl</kbd>+<kbd>`</kbd>) | Shows or hides the bottom panel |
| Settings (<kbd>Ctrl</kbd>+<kbd>,</kbd>) | [Settings](/user-guide/settings-and-preferences/) |

Clicking the active side-panel icon again collapses the side panel.

## Toolbar

The conversation title, the current project, the **model menu** (with model size), a refresh button for the
model list, and the Ollama connection indicator.

## Main area

The chat, with the editor beside it when files are open. The panels can be resized by dragging their
borders; Vinnie remembers the layout.

## Bottom panel

- **Terminal**: commands you and Vinnie run. See [Terminal integration](/user-guide/terminal-integration/).
- **Activity**: a feed of real operations (searches, reads, edits, commands, MCP connections, skills) with
  status and duration.
- **Task**: the full timeline of agent tasks and the optional debug view. See [Task planning](/user-guide/task-planning/).

## Status bar

Shows what Vinnie is doing (for example *Vinnie: Idle*), the Ollama connection with **Retry** and
**Launch Ollama** buttons when it's down, the current generation phase, and the number of installed models.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| <kbd>Enter</kbd> / <kbd>Shift</kbd>+<kbd>Enter</kbd> | Send message / new line |
| <kbd>Ctrl</kbd>+<kbd>N</kbd> | New conversation |
| <kbd>Ctrl</kbd>+<kbd>S</kbd> | Save the file in the editor |
| <kbd>Ctrl</kbd>+<kbd>F</kbd> | Find in the open file |
| <kbd>Ctrl</kbd>+<kbd>`</kbd> | Toggle the terminal and activity panel |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> | Explorer / Search |
| <kbd>Ctrl</kbd>+<kbd>,</kbd> | Settings |
