---
title: "Core Services"
description: "The service interfaces between the UI and the backend."
sidebar:
  order: 3
---
All backend access goes through `getServices()` (`src/services/index.ts`). Tests replace services with
`setServices`.

| Service | Responsibility |
| --- | --- |
| `provider` | The model provider (Ollama): connection checks, model list, streaming chat, model details |
| `conversations` | Conversation and message storage |
| `project` | The selected project folder |
| `settings` | Load and save settings |
| `system` | App info, opening URLs and the log folder, clipboard, **Launch Ollama** |
| `tools` | The [tool registry](/developer/tool-registry/) |
| `workspace` | Listing, tree, reading, and stat of project files |
| `search` | Project search with cancellation |
| `changes` | Preview, apply, list, diff, and revert changes |
| `process` | Assess and run commands, cancel runs, the per-project allowlist |
| `analysis` | Project analysis, Git status, package-manager detection, install commands |
| `mcp` | MCP server configs, stdio relay, HTTP relay, server logs |
| `toolSettings` | Per-tool enable switches, policies, and run counters |
| `skills` | Skill CRUD, references, import and export |
| `dialogs` | Native save and open dialogs for small text files |

Each service method wraps a Tauri command in `src/lib/ipc/commands.ts`. Errors are converted to `VinnieError`
with a `kind` (see [Error handling](/developer/error-handling/)).
