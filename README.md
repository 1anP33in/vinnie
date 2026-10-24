# Vinnie

Vinnie is a local-first AI desktop application for Windows. It chats with models running in
[Ollama](https://ollama.com) on your own machine and keeps your conversations in a local SQLite
database. No cloud services or API keys are involved.

This is **Phase 1: Desktop Foundation**: a polished, reliable chat application with clean extension
points for the agent features planned in later phases (project indexing, tools, MCP, and an animated
ice-dragon viewer). None of those future features is simulated in the UI.

## Features

- **Local chat with Ollama**: token-by-token streaming, stop generation, retry, and friendly errors
  for an unreachable server, timeouts, missing models, malformed responses, and dropped connections.
- **Reasoning models**: the "thinking" output of models such as `qwen3` is shown in a collapsible
  panel (can be turned off).
- **Model management**: discovers installed models, lets you pick one, refreshes the list, and
  explains how to install one when none exist. Vinnie never downloads models itself.
- **Conversations**: persisted in SQLite, grouped by date, searchable (titles and content), with
  rename and delete (with confirmation), automatic titles, and restored after restart.
- **Safe rendering**: Markdown (GFM tables and lists), syntax-highlighted code blocks with copy
  buttons. Raw HTML is never rendered, code is never executed, remote images are never loaded,
  and links open in your browser only if they are `http(s)`.
- **Project folder**: pick a folder with the native dialog. The choice persists, and moved or
  deleted folders are detected. Phase 1 never reads or modifies the folder's contents.
- **Settings**: Ollama endpoint (validated) with a connection test, default model, theme
  (dark/light/system), reduced visual effects, show reasoning, startup behavior, delete all
  conversations, and diagnostics.
- **Resilience**: automatic reconnect while Ollama is offline, partial responses kept when a
  generation is stopped or fails, and a message is only shown as saved once SQLite confirms it.

## Requirements

| Tool | Version used | Notes |
| --- | --- | --- |
| Windows | 10/11 x64 | WebView2 runtime (preinstalled on Windows 11) |
| Node.js | 20.19+ (tested on 24.19) | |
| pnpm | 12.15 (pinned via `packageManager`) | `corepack enable pnpm` |
| Rust | stable, 1.85+ (tested on 1.99.1) | install with [rustup](https://rustup.rs), MSVC toolchain |
| Visual Studio C++ Build Tools | 2022 or newer | "Desktop development with C++" workload |
| Ollama | any recent version (tested on 0.35.1) | must be running for chat |

If `corepack enable` fails with a permissions error (it writes to `Program Files`), install the
shim into your user npm folder instead:

```bash
corepack enable pnpm --install-directory "%APPDATA%\npm"
```

## Setup and launch

```bash
pnpm install
```

```bash
pnpm app:dev
```

`pnpm app:dev` starts Vite and the Tauri shell with hot reload. The first Rust build takes a few
minutes.

Install at least one model in Ollama, for example:

```bash
ollama pull qwen3:8b
```

### Production build

```bash
pnpm app:build
```

This produces `src-tauri/target/release/vinnie.exe` and an NSIS installer under
`src-tauri/target/release/bundle/nsis/`. On first use, the Tauri bundler downloads NSIS.

## Checks

| Command | What it runs |
| --- | --- |
| `pnpm test` | Vitest + React Testing Library (Ollama and Tauri fully mocked) |
| `pnpm typecheck` | TypeScript, strict mode |
| `pnpm lint` | ESLint (typescript-eslint, react-hooks) |
| `pnpm build` | Production frontend build |
| `pnpm rust:test` | Rust unit tests, including a scripted mock Ollama HTTP server |
| `pnpm rust:clippy` | Clippy with warnings as errors |
| `pnpm check` | All of the above |

No test needs a running Ollama.

## Architecture

```
src-tauri/                     Rust backend (Tauri 2)
  build.rs                     registers app commands -> generated allow-* permissions
  capabilities/default.json    the only permissions granted to the window
  src/
    lib.rs                     app setup, plugins, command registration
    commands/                  thin IPC handlers: validate input, delegate
      app.rs chat.rs conversations.rs project.rs settings.rs
    ollama/                    Ollama provider
      client.rs                HTTP client, timeouts, cancellation, error mapping
      stream.rs                incremental NDJSON decoder
      types.rs                 wire + UI types
      test_server.rs           scripted mock server (tests only)
    db/                        SQLite: migrations, conversation repository, key/value
    settings.rs                settings model + validation
    project.rs                 active project folder (metadata only)
    generation.rs              cancellation registry for in-flight generations
    error.rs                   typed errors serialized as { kind, message }

src/                           React + TypeScript frontend
  lib/ipc/                     the only code that calls Tauri (typed commands + DTOs)
  providers/                   AIProvider interface + Ollama implementation
  repositories/                ConversationRepository interface + Tauri implementation
  project/                     ProjectProvider + Phase 2 WorkspaceProvider types
  agent/                       ToolRegistry + AgentEvent types (empty registry in Phase 1)
  services/                    service locator (swapped for fakes in tests)
  state/                       Zustand stores; chatStore orchestrates send/stream/persist
  components/                  layout, sidebar, chat, settings, common UI
  settings/validation.ts       client-side mirror of backend validation
  test/fakes.ts                in-memory fakes for every service
```

### Key design decisions

- **Privileged work stays in Rust.** All network, filesystem, and dialog access runs in the
  backend. The window has no plugin permissions at all: it can only call Vinnie's own commands
  (`capabilities/default.json`). The folder picker, link opening, and clipboard writes are
  commands that validate their inputs. There is no shell execution.
- **Streaming** uses a Tauri `Channel`. The backend decodes Ollama's NDJSON incrementally (handling
  lines and UTF-8 characters split across network chunks) and forwards `content` and `thinking`
  events. The frontend batches tokens into React state every 40 ms to stay responsive.
- **Cancellation**: each generation registers a `CancellationToken`. Stopping drops the HTTP
  response, which tells Ollama to stop generating. Timeouts: 5 s to connect, 5 minutes for the first
  response (model loading), and 2 minutes of silence between chunks.
- **Persistence honesty**: the user message is saved before generation starts. If that fails, the
  draft is restored and nothing is sent. Assistant replies are saved as `complete`, or as
  `interrupted` (stopped or failed partway) with the partial text. If saving fails, the reply stays
  on screen marked "Not saved" with a retry button.
- **Provider abstraction**: the chat UI depends only on `AIProvider`
  (`checkConnection`, `listModels`, `streamChat`), so another provider can be added without
  touching the chat interface.
- **Logging** goes to the app log folder (shown in Settings) and records events and errors,
  never message contents.

### Data locations

- Database: `%APPDATA%\ai.vinnie.desktop\vinnie.db`
- Logs: `%LOCALAPPDATA%\ai.vinnie.desktop\logs\vinnie.log`

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| Enter | Send message |
| Shift+Enter | New line |
| Ctrl+N | New conversation |
| Ctrl+, | Settings |

## Known limitations (Phase 1)

- Vinnie does not read project files yet; the project folder is only remembered.
- No system prompt or per-model generation options (temperature, context length) yet; Ollama
  defaults apply.
- The whole conversation history is sent on every turn; very long conversations are limited by the
  model's context window.
- Search uses SQL `LIKE`, which is case-insensitive for ASCII only.
- Conversations cannot be exported yet.
