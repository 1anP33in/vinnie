---
title: "Settings and Preferences"
description: "Every setting in Vinnie, explained."
sidebar:
  order: 13
---
Open Settings with <kbd>Ctrl</kbd>+<kbd>,</kbd> or the gear icon. Changes take effect when you click
**Save changes**; invalid values are pointed out next to the field.

## Ollama connection

| Setting | Default | Notes |
| --- | --- | --- |
| Endpoint | `http://localhost:11434` | Must start with `http://` or `https://`. **Test connection** checks it before saving |

## Models

| Setting | Default | Notes |
| --- | --- | --- |
| Default model | none | Selected automatically at startup; must be installed in Ollama |

## Appearance

| Setting | Default | Notes |
| --- | --- | --- |
| Theme | Dark | Dark, Light, or System |
| Show model reasoning | On | Shows the reasoning panel for thinking models |
| Reduce visual effects | Off | Turns off glow, frost, and animations |

## Startup

| Setting | Default | Options |
| --- | --- | --- |
| Startup behavior | Start a new conversation | Start a new conversation · Reopen the last conversation |

## Assistant permissions

| Setting | Default |
| --- | --- |
| Let Vinnie use project tools | On |
| Include project context | On |
| Read files / Change files / Run commands / Install dependencies | Allowed / Ask me / Ask me / Ask me |
| Always-allowed commands in this project | (list you manage) |

See [Permissions and approvals](/user-guide/permissions-and-approvals/).

## Agent

| Setting | Default | Range |
| --- | --- | --- |
| Mode | Agent | Ask · Assist · Agent (Full Auto: coming later) |
| Max iterations | 25 | 1–200 |
| Max tool calls | 60 | 1–500 |
| Max retries | 2 | 0–10 |
| Command timeout (s) | 600 | 5–3,600 |
| Task timeout (min) | 30 | 1–240 |
| Max changed files | 20 | 1–500 |
| Context budget | Auto | Auto · 4K · 8K · 16K · 32K |
| Verify changes automatically | On | |
| Task debug view | Off | |

See [Agent states](/agent-system/agent-states/) and [Context management](/agent-system/context-management/).

## Ignored folders

**Folder names (comma or line separated)**: skipped by the explorer (shown dimmed), search, and analysis.
Default: `node_modules, .git, .vscode, .idea, bin, obj, dist, build, __pycache__, target`.

## Project folder and Conversations

Choose or forget the project folder, and delete all conversations.

## About & diagnostics

Shows the Vinnie and Tauri versions, system, Ollama status, and the data and log folders.
**Copy diagnostics** copies them for a bug report, and **Open log folder** opens the logs.

Settings are stored in the local database. Settings for [MCP servers](/mcp/managing-mcp-servers/),
[tools](/mcp/discovering-tools/), and [skills](/skills/managing-skills/) live on their own screens.
