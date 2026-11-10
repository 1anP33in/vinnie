---
title: "Application Structure"
description: "Where things live in the repository."
sidebar:
  order: 2
---
```text
vinnie/
├── src/                      frontend (React + TypeScript)
│   ├── agent/                tool interface, registry, tools/, project context, text tool-call recovery
│   │   ├── runtime/          agent loop, planner, permissions, context/tokens, verification, recovery, memory, events
│   │   └── tools/            native tools (read, file, command, agent)
│   ├── mcp/                  MCP manager, transports, tool adapter, classification, config
│   ├── skills/               skill selection and validation
│   ├── components/           UI: chat, agent, integrations, editor, explorer, search, changes, terminal, …
│   ├── state/                Zustand stores
│   ├── services/             service interfaces and default (Tauri) implementations
│   ├── providers/            model provider interface and the Ollama provider
│   ├── lib/ipc/              the only code that calls Tauri (commands.ts, types.ts)
│   └── test/                 fakes and test setup
├── src-tauri/                backend (Rust)
│   ├── src/commands/         IPC handlers: app, chat, conversations, project, settings, workspace,
│   │                         changes, process, analysis, mcp, skills, tools
│   ├── src/                  domain modules (workspace, changes, process, mcp, skills, ollama, db, …)
│   ├── skills/               built-in skills (compiled in)
│   ├── capabilities/         default.json: the commands the window may call
│   └── build.rs              registers commands for the capability system
├── vinnie-docs/              this documentation website (separate project)
└── package.json              scripts: app:dev, app:build, check, …
```

## Adding a backend command

1. Write the handler in `src-tauri/src/commands/<area>.rs` and add it to `generate_handler!` in `lib.rs`.
2. List it in `build.rs` and grant `allow-<command-name>` in `capabilities/default.json`; otherwise the window
   can't call it.
3. Add a typed wrapper in `src/lib/ipc/commands.ts` and expose it through a service in `src/services/index.ts`.
4. Add a fake in `src/test/fakes.ts` or `src/test/integrationFakes.ts`.
