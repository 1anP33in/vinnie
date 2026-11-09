# Vinnie

Vinnie is a local-first AI developer assistant for Windows. It chats with models running in
[Ollama](https://ollama.com) on your own machine, and it can work inside a project folder: browse,
search, and read files, propose edits as reviewable diffs, run development commands, and install
dependencies. In Agent mode it plans and carries out multi-step tasks, then verifies the result
itself. You can extend it with MCP servers (GitHub, filesystems, databases, and more) and with
skills, without changing its code. Every action needs your approval or permission, and every
change to your project can be reverted. Nothing leaves your computer unless you connect a remote
MCP server.

| Phase | Status | Scope |
| --- | --- | --- |
| 1. Desktop foundation | Done | Chat with Ollama, streaming, conversations, settings, project selection |
| 2. Project intelligence and developer tools | Done | Explorer, editor, search, diffs, change history, terminal, dependency management, tool use |
| 3. Autonomous agent engine | Done | Agent loop, plans, scoped permissions, recovery, verification, task timeline |
| 4. MCP and skills | Done | MCP servers (stdio and Streamable HTTP), tool permissions, skills, Tool Explorer |
| 5. Ice dragon viewer | Planned | Animated 3D dragon driven by real agent events |

## Features

### Chat (Phase 1)
- Token-by-token streaming from Ollama, with Stop and Retry.
- Clear errors for an unreachable server, timeouts, missing models, and dropped connections.
- Conversations persisted in SQLite: grouped by date, searchable, renamable, deletable (with confirmation).
- Safe Markdown rendering with highlighted code blocks. Raw HTML is never rendered, code is never
  executed, and remote images are never loaded.
- A collapsible reasoning panel for thinking models such as `qwen3`.

### Workspace (Phase 2)
- **Project explorer**: lazily loaded tree, file icons, git decorations (M/U), and ignored folders
  shown dimmed. You can create, rename, and delete files and folders; deletion asks for confirmation.
- **Project analysis** (runs in the background when a project is selected) detects:
  - project types (FiveM resource, Node.js, React, Python, C#, Rust, Go, static site), languages,
    and frameworks;
  - package managers, entry points, config files, the README, and instruction files
    (`AGENTS.md`, `CLAUDE.md`, ...);
  - Git branch and changes;
  - for FiveM: `fxmanifest.lua` / `__resource.lua` scripts, `ui_page`, and files.
- **Code editor** (Monaco): tabs, syntax highlighting, line numbers, find (Ctrl+F), copy, reload, and
  save (Ctrl+S). Each tab shows its status: *Saved*, *Modified*, or *External modification detected*.
  If a file changes on disk while you have unsaved edits, Vinnie never overwrites them. You can
  compare the two versions, use the disk version, or deliberately overwrite.
- **Search**: by file name or text, with case-sensitive, regex, and file-type filters. It respects
  `.gitignore` and the ignored folders. Clicking a result opens the file at that line.
- **Change manager**: every edit made through Vinnie (by you or the assistant) is snapshotted. You can
  view any change as a diff, revert one change, revert all changes from one assistant task, or browse a
  file's previous versions. A revert refuses to discard edits made after the change unless you confirm.
- **Terminal**: runs commands in the project folder and streams stdout and stderr. Each run shows the
  start time, status, exit code, and duration, and supports Stop, a timeout, Clear, and command
  history. When a command fails, Vinnie explains the likely cause (for example *Cannot find module
  'express'*, a port already in use, or a missing tool) and keeps the raw output behind a toggle.
- **Dependencies**: Vinnie detects npm, pnpm, yarn, bun, pip, uv, poetry, pipenv, cargo, dotnet, and
  go. When the evidence conflicts or is missing (for example, several lockfiles), it says so and lets
  you choose.
- **Tool use in chat**: the model can call `get_project_structure`, `search_files`, `read_file`,
  `create_file`, `write_file`, `delete_file`, `move_file`, `run_command`, and `install_dependency`.
  - The app executes each call according to your permissions and approvals, returns the result to the
    model, and the model answers.
  - This is a bounded cycle (at most 8 tool rounds per message), not an autonomous loop.
  - Tool calls, results, and approvals appear in the chat and in the activity feed.
- **Project context**: each request carries a compact summary instead of the whole project: detected
  metadata, a shallow tree, the file open in the editor, and file names that match your message.
- **Activity feed**: lists real operations only (searches, reads, edits, commands, analysis,
  approvals), each with a timestamp, status, duration, and details.
- **Dragon events**: `dragon.idle`, `thinking`, `reading`, `editing`, `running`, `waiting`, `error`,
  and `success`. They drive the status indicator now and will drive the Phase 5 dragon later.

### Agent (Phase 3)
- **Agent loop** (`src/agent/runtime/`): observe → ask the model for the next action → validate →
  authorize → execute → record → feed the result back → repeat. It stops when the work is done, the
  user stops it, or a limit is reached (iterations, tool calls, task time, changed files). It never
  loops forever.
- **Modes**: *Ask* (read-only), *Assist* (asks before every change and command), *Agent* (the
  default; asks only where your permission rules say so). *Full Auto* is reserved for later and is
  not implemented.
- **Plans**: for tasks (not simple questions), the model keeps a visible plan through `update_plan`.
  You can edit or remove steps while it runs.
- **Agent panel** above the composer: live status ("Vinnie is reading files…"), current step, plan,
  tool calls, files changed (+/−), retries, verification, elapsed time, and Pause / Resume / Stop.
  After the task: the verification checks, per-file View / Revert, *View changes*, *Revert task*,
  and *Accept changes*.
- **Task timeline and debug view** (bottom panel → *Task*): every real runtime event. Optionally
  (Settings → Agent → *Task debug view*) also task id, model, prompt version, tool arguments and
  results with secrets redacted, durations, token usage, retries, and the task memory.
- **Scoped approvals**: *Allow once*, *Allow for this task*, *This session*, or *Always allow* (this
  project, commands only). Task grants expire when the task ends.
- **Independent verification**: after changes, Vinnie checks that each file has the content it wrote,
  parses changed JSON, checks FiveM manifest references, and runs the project's own
  typecheck / lint / test / build scripts (or `cargo check`, `go build`, `dotnet build`, `pytest`).
  If a check fails, the failure is fed back for a bounded number of repair attempts. The task outcome
  comes from these checks, never from the model's claims.
- **Recovery**: failures are classified (`FILE_NOT_FOUND`, `COMMAND_FAILED`, `PERMISSION_DENIED`,
  `INVALID_ARGUMENT`, `DEPENDENCY_FAILURE`, `MODEL_FAILURE`, …) with a recovery hint. An identical
  failing call is refused after `maxRetries`. Transient model errors (dropped connection, timeout,
  unparseable tool call) are retried before any output is shown.
- **Honest reporting**: every task that used tools ends with an app-written **Task report** (status,
  files changed, verification checks). If the model writes tool calls as text, Vinnie tells it they
  did not run. A task that changed nothing is reported as "no files were changed".
- **Context and tokens**: a token budget (Auto, 4K, 8K, 16K, or 32K; Auto uses the model's context
  size, capped at 16K). Ollama's `num_ctx` is set to match. Older tool results are compressed first,
  older conversation turns are condensed into a digest, and a short task memory keeps key facts.
- **Launch Ollama**: when Vinnie can't reach a local Ollama server, a button with the Ollama icon
  starts `ollama serve` in the background (no console window) and reconnects when it answers.

### MCP and skills (Phase 4)

**MCP servers** (left rail → plug icon). Connect any [Model Context Protocol](https://modelcontextprotocol.io)
server:

- **Local (stdio)**: Vinnie launches the program you configure, for example command `npx` with
  arguments `-y`, `@modelcontextprotocol/server-filesystem`, `C:\Docs`.
- **Remote (Streamable HTTP)**: a server URL (`https://…`; plain `http://` only for localhost),
  optional headers, and secret headers such as `Authorization: Bearer …`.

For each server you can add, edit, remove, enable or disable it, connect, disconnect, restart, and
test the connection. You also see its status (CONNECTED, CONNECTING, DISCONNECTED, ERROR,
DISABLED), server version, last connection, failures, logs, and discovered tools. Configurations
can be exported and imported **without secrets**; imported servers start disabled.

- Tools are discovered when a server connects and refreshed when the server reports a change.
  They appear to the model as `<server>__<tool>` (shown as `server.tool`), so identical names from
  different servers never collide.
- Each tool has an enable switch and an approval policy (*ask*, *allow*, *never*), with a
  per-server default. Destructive tools always ask and need an explicit confirmation.
- Connections are monitored (pings every 30 s). A dropped server is reconnected up to three times;
  its tools are marked unavailable and refused while it is down.

**Skills** (left rail → book icon) are folders of instructions that guide Vinnie for a kind of work.
Ten are built in: FiveM, Lua, Web, TypeScript, Python, C#, Git, Debugging, Database, and
Documentation. For each request Vinnie picks at most three relevant skills, based on your words,
the project's languages and type, and the FiveM manifest, and loads only their instructions.
You can force a skill on or off for the session (book button next to the message box), create
and edit your own skills, add reference files, disable or delete skills, and import or export
them as `.vinnie-skill.json` files. The task panel shows which skills were used and why.

**Tool Explorer** (left rail → wrench icon): every native and MCP tool, searchable and grouped
(native, MCP, development, filesystem, terminal, external services). For each tool it shows the
source, permission, enable switch, approval policy, last run, and run count.

## Security model

All enforcement happens in the Rust backend. Neither the model nor the UI can bypass it.

- **Workspace boundary**: every path is relative to the project root.
  - Absolute paths, drive letters, `..`, alternate data streams, and reserved device names are rejected.
  - Paths are resolved to their real location (following symlinks and junctions), so links cannot
    escape the project.
- **Command policy**: commands run without a shell (no pipes, redirects, `&&`, or variables). Each
  command falls into one of three levels:
  - **Low risk**, runs directly: `npm test`, `npm run build/lint/test`, `git status/diff/log`,
    `cargo test`, version checks, and similar.
  - **Approval required**: installs, `git checkout/reset/commit/push`, unknown programs, and anything
    else not on the low-risk list.
  - **Blocked**: `rm`, `del`, `rmdir`, `format`, `diskpart`, `shutdown`, `reg`, `git clean`, and
    shells such as `cmd`, `powershell`, or `bash` (which would bypass the policy). The resolved
    executable is checked again after `PATH` lookup.

  Programs are found through `PATH` only, never the project folder, so a planted `git.exe` cannot
  hijack a command.
- **Permissions** (Settings): READ = allowed, WRITE = ask, EXECUTE = ask, INSTALL_DEPENDENCIES = ask
  by default. Each can be set to *Allowed*, *Ask me*, or *Never*.
  - Deleting files always asks.
  - Reading likely-secret files (`.env`, keys, `server.cfg`) always asks.
  - "Always allow" stores the exact command per project, separately from conversations.
- **Frontend capabilities**: the window can call only Vinnie's own commands. Dialog, link-opening, and
  clipboard plugins are not exposed to it.
- **Logging**: logs record events, tool use, commands, and errors, never message or file contents.
  Settings → *Open log folder*.
- **Agent permissions**: the model is untrusted. It can only *request* tools.
  - The `PermissionManager` decides each request from the mode, your settings, and grants that only
    you can create from approval cards.
  - The backend still enforces boundaries, the command policy, and denials on its own.
  - Tools not offered for the current mode or request are refused. Unknown tools are refused.
    Arguments are schema-validated before anything runs.
  - Deletions and secret-file reads always ask, even with a session grant.
  - Stop cancels the model request, denies pending approvals, and stops the commands the task started.
- **MCP servers are untrusted programs.**
  - Vinnie classifies every tool itself from its name (READ, WRITE, DELETE, EXECUTE, NETWORK,
    EXTERNAL_ACTION). Unknown tools count as external actions, and a server's hints can only make
    a tool *more* sensitive.
  - Every call goes through the same permission manager as native tools: a policy per tool and
    per server, scoped grants that only you create, Ask mode limited to read tools, Assist mode
    asking every time, and destructive tools always asking with a confirmation.
  - Tool arguments are validated against the tool's JSON schema before you're asked. Tools with
    invalid schemas are rejected.
  - Tool descriptions are sanitized and length-limited. Results are size-limited and labeled as
    untrusted data. A server's `instructions` are ignored. Neither a server nor a skill can change
    Vinnie's system prompt rules, permissions, or approvals.
  - **Secrets** (environment variables and headers) are stored in **Windows Credential Manager**,
    never in Vinnie's database or exports. Only the Rust backend reads them, when it launches a
    server or sends a request. The webview and the model never see them, and they are redacted
    from server logs.
  - **stdio servers** run only the stored command (never through a shell, arguments passed
    separately), with a minimal environment (system basics plus the server's own variables), no
    console window, and inside a Windows job object. The job kills them, and anything they
    started, when they are stopped or when Vinnie exits, even after a crash. Output lines are
    capped at 8 MB.
  - **HTTP servers**: requests may only go to the configured origin, redirects are not followed,
    credentials can't be injected from the webview, and responses are capped at 16 MB.
- **Skills are guidance, not permissions.** Their instructions are framed as guidance in the
  prompt, size-limited, and treated as untrusted when imported. Skill ids and reference file names
  are validated before any path is built, so a skill can't read or write outside its own folder.
- **Note**: approvals are made in Vinnie's own UI, and the backend requires an explicit approval flag
  for gated operations. The model has no direct access to commands, so it cannot set that flag.

## Requirements

| Tool | Version used | Notes |
| --- | --- | --- |
| Windows | 10/11 x64 | WebView2 runtime (preinstalled on Windows 11) |
| Node.js | 20.19+ (tested on 24.19) | |
| pnpm | 12.15 (pinned via `packageManager`) | `corepack enable pnpm` |
| Rust | stable, 1.85+ (tested on 1.99.1) | [rustup](https://rustup.rs), MSVC toolchain |
| Visual Studio C++ Build Tools | 2022 or newer | "Desktop development with C++" workload |
| Ollama | any recent version (tested on 0.35.1) | must be running for chat |
| Git | optional | enables Git status in the explorer |

If `corepack enable` fails with a permissions error, install the shim into your user npm folder:

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

Install at least one model with tool support, for example:

```bash
ollama pull qwen3:8b
```

Then choose a project folder (Explorer → *Choose folder…*) and ask something like *"Which files handle
the duty command?"* or *"Run the tests and explain any failures."*

### Production build

```bash
pnpm app:build
```

This produces `src-tauri/target/release/vinnie.exe` and an installer at
`src-tauri/target/release/bundle/nsis/Vinnie_0.1.0_x64-setup.exe`.

## Checks

| Command | What it runs |
| --- | --- |
| `pnpm test` | Vitest + React Testing Library (270 tests; Ollama, Tauri, and Monaco mocked; MCP tests use real MCP servers from the official SDK over its in-memory transport) |
| `pnpm typecheck` | TypeScript, strict mode |
| `pnpm lint` | ESLint |
| `pnpm build` | Production frontend build |
| `pnpm rust:test` | Rust tests (161), including real MCP server processes, Windows Credential Manager, a mock Ollama server, real file I/O, junction escapes, and process timeouts |
| `pnpm rust:clippy` | Clippy with warnings as errors |
| `pnpm check` | All of the above |

## Architecture

```text
Vinnie Desktop App (React + TypeScript)
├── Chat UI ─────────────┐   Explorer · Editor (Monaco) · Diff viewer
├── Terminal · Activity  │   Search · Changes · Approval cards · Dragon status
│                        ▼
├── Stores (Zustand): chat orchestration, editor, workspace, search, terminal,
│                     changes, approvals, activity, dragon
├── Agent runtime: AgentRuntime loop · Planner · ContextManager · TokenManager ·
│                ToolExecutor + RetryGuard · PermissionManager · VerificationEngine ·
│                TaskMemory · agent.* event bus (→ agent store, activity feed, dragon)
├── Agent layer: ToolRegistry (enable switches, availability) + 13 native VinnieTools,
│                project context, text tool-call recovery
├── MCP manager: official MCP SDK Client per server · server registry · discovery ·
│                tool adapter (→ VinnieTool) · health monitor + reconnection ·
│                transports: stdio and Streamable HTTP, both relayed by the backend
├── Skills: skill store · selection (request + project) · lazy instruction loading
└── Services (interfaces) ── typed IPC ──▶ Tauri commands (validated, permission-checked)
                                            │
Rust backend                                ▼
├── workspace/   path boundary · file service · search service (ignore + regex)
├── changes      snapshots · diffs (similar) · revert · history (SQLite)
├── process/     command policy · process runner (streaming, timeout, cancel, kill tree)
├── permissions  READ / WRITE / EXECUTE / INSTALL_DEPENDENCIES
├── deps         package-manager detection · install commands
├── analyzer     project types · languages · FiveM manifest · entry points
├── git          read-only status
├── db/          SQLite migrations · conversations · settings
├── ollama/      streaming client · tool calls · launcher
├── mcp/         server configs · secrets (Credential Manager) · stdio relay + job object ·
│                HTTP relay (origin-locked) · per-server logs
├── skills       skill folders · built-in skills · validation · import/export
└── tool_settings  per-tool switches, policies, usage counters
```

```text
src/
  agent/          tool interface, registry, tools/, context builder, events
  agent/runtime/  agent loop, planner, permissions, context/tokens, verification, recovery, memory
  components/agent/  agent panel, plan view, task timeline, task/debug panel
  components/     chat, editor, explorer, search, changes, terminal, activity, layout, settings
  components/integrations/  MCP manager, skills manager, tool explorer
  mcp/            MCP manager, transports, tool adapter, permission classification, config
  skills/         skill selection and validation
  services/       one interface per backend service (swapped for fakes in tests)
  state/          Zustand stores
  lib/ipc/        the only code that calls Tauri
src-tauri/src/
  commands/       IPC handlers: app, chat, conversations, project, settings,
                  workspace, changes, process, analysis, mcp, skills, tools
  workspace/ changes.rs process/ permissions.rs deps.rs analyzer.rs git.rs db/ ollama/
  mcp/ skills.rs tool_settings.rs
src-tauri/skills/ built-in skills (compiled in, installed to the data folder on first run)
```

### New dependencies in Phase 2

- **Frontend:** `monaco-editor` 0.55.1, `@monaco-editor/react` 4.7.0, `react-resizable-panels` 3.0.6,
  `zod` 4.6.7.
- **Rust:** `ignore`, `globset`, `regex`, `similar`, `sha2`, `dunce`, `which`, and
  `tauri-plugin-clipboard-manager`.

### Dependencies in Phase 3

None. The agent engine uses only what Phases 1 and 2 already brought in.

### New dependencies in Phase 4

- **Frontend:** `@modelcontextprotocol/sdk` 1.32.1 (the official MCP TypeScript SDK) and `ajv`
  8.20.0 (JSON Schema validation of tool inputs, drafts 2020-12 and 07).
- **Rust:** `windows-sys` 0.61 (Credential Manager and job objects; already in the dependency tree
  through Tauri).

### Data locations

- Database: `%APPDATA%\ai.vinnie.desktop\vinnie.db` (conversations, settings, change snapshots,
  allowed commands, project metadata, MCP server configs without secrets, tool settings)
- Skills: `%APPDATA%\ai.vinnie.desktop\skills\<id>\` (`skill.json`, `instructions.md`, `references\`)
- MCP secrets: Windows Credential Manager, entries named `Vinnie/mcp/<server>/<key>`
- Logs: `%LOCALAPPDATA%\ai.vinnie.desktop\logs\vinnie.log`

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| Enter / Shift+Enter | Send message / new line |
| Ctrl+N | New conversation |
| Ctrl+S | Save file |
| Ctrl+F | Find in file |
| Ctrl+` | Toggle terminal and activity panel |
| Ctrl+Shift+E / Ctrl+Shift+F | Explorer / Search |
| Ctrl+, | Settings |

## Known limitations

- Commands are not interactive (stdin is closed). Commands that prompt for input wait until they
  time out or you stop them.
- Only files and empty folders can be deleted. Snapshots are limited to 10 MB per file, and the
  editor opens files up to 2 MB.
- The editor checks for external changes every 3 seconds and when the window gains focus. There is no
  file watcher yet.
- Small local models vary in how reliably they call tools and finish multi-step tasks. `qwen3:8b` is
  the most reliable model tested. `qwen2.5-coder:7b` often writes tool calls as text: Vinnie recovers
  a reply made only of calls, and otherwise tells the model they did not run. It may still stop
  early, and the task report then says that nothing changed.
- Verification runs the project's own scripts. It cannot test behavior that has no script (for
  example, a FiveM resource in-game), and it says so.
- Pause takes effect between steps. A command or model reply that is already running finishes first
  (Stop interrupts it).
- `ollama serve` started from a `pnpm tauri dev` session exits when the dev app restarts. In the
  installed app it keeps running after Vinnie closes.
- Project detection relies on file names and manifests. It describes evidence; it does not fully
  understand the project.
- Change history is a local snapshot store. Git-backed history is not implemented yet.
- MCP: tools, the protocol's main feature, are supported. MCP resources, prompts, sampling,
  elicitation, and OAuth sign-in are not yet (use a token in a secret header instead).
- At most 8 external tools are offered per request, chosen by relevance. A tool whose name and
  description share no words with your request isn't offered; mention the server (e.g. "on
  GitHub") to bring its tools in.
- Tool categories are inferred from tool names. Unknown names count as external actions, which
  is safe but may ask more often than needed; set a tool's policy to *allow* if you trust it.
- Ollama scans your GPU once when it starts. On systems where Windows Terminal is the default
  console, that scan briefly opens terminal windows; Ollama's own tray app does the same. Starting
  Ollama from Vinnie no longer opens windows for every model load (Phase 4 fix).

## Recommended Phase 5 plan (ice dragon viewer)

1. **Event contract first**: freeze the dragon state machine on the existing event buses
   (`agent.*`, `mcp.*`, `skill.*`, and the dragon states idle, thinking, reading, editing,
   running, waiting, working, error, success) and add a small replay log, so animations can be
   built and tested without a model.
2. **Renderer**: a lazily loaded Three.js (or Babylon.js) canvas in its own panel, with a glTF ice
   dragon model, a fixed animation budget, and `prefers-reduced-motion` support. It must not slow
   down chat or the agent loop; pause it when hidden.
3. **State-to-animation mapping**: idle breathing; thinking glow; reading (eyes scanning); editing
   (frost forming); running commands (wing beats); waiting for approval (looking at the user);
   errors and success with short one-shot animations, debounced so rapid events don't flicker.
4. **Integration cues**: subtle effects for MCP connections and skill activations, driven only by
   real events and never invented ones.
5. **Settings and tests**: on/off, quality level, and size; visual regression snapshots of each
   state; a performance test that keeps frame time and CPU use bounded during long agent tasks.
