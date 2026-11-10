---
title: "Architecture Overview"
description: "How Vinnie's desktop app is put together."
sidebar:
  order: 1
---
Vinnie is a [Tauri 2](https://tauri.app) desktop application: a **React + TypeScript** frontend running in
WebView2, and a **Rust** backend that owns everything touching the operating system.

```text
Vinnie Desktop App (React + TypeScript, WebView2)
├── UI: chat, explorer, editor (Monaco), search, changes, terminal, activity,
│       agent panel, MCP manager, skills manager, tool explorer
├── Stores (Zustand): chat orchestration, agent tasks, approvals, workspace, …
├── Agent runtime: AgentRuntime loop · planner · context manager · tool executor
│       · permission manager · verification engine · task memory · events
├── Tool registry: native tools + MCP tools (one interface)
├── MCP manager: official MCP SDK Client per server · discovery · health
├── Skills: selection · lazy loading
└── Services (interfaces) ── typed IPC ──▶ Tauri commands
                                            │
Rust backend                                ▼
├── workspace/   project boundary · files · search
├── changes      snapshots · diffs · revert
├── process/     command policy · process runner
├── permissions  READ / WRITE / EXECUTE / INSTALL_DEPENDENCIES
├── ollama/      streaming client · launcher
├── mcp/         configs · secrets · stdio relay · HTTP relay · logs
├── skills       skill folders · built-ins
├── db/          SQLite · migrations
└── analyzer, deps, git, settings, tool_settings
```

## Design rules

- **The model is untrusted.** It proposes tool calls; the frontend runtime authorizes them, and the Rust backend
  enforces boundaries and policies a second time.
- **The backend owns side effects.** File I/O, processes, network access to MCP servers, and secrets live in Rust.
  The webview can only call Vinnie's own registered commands (Tauri capabilities), and no Tauri plugin APIs are
  exposed to it.
- **Services are interfaces.** UI and runtime code depend on service interfaces (`src/services/index.ts`), so
  tests swap in fakes.
- **Events, not polling.** Agent, MCP, skill, and dragon events feed the UI.

Continue with [Application structure](/developer/application-structure/).
