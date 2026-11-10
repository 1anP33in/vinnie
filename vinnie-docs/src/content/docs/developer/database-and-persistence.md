---
title: "Database and Persistence"
description: "Vinnie's SQLite database and what it stores."
sidebar:
  order: 10
---
Vinnie uses one SQLite database (rusqlite, bundled SQLite) at `%APPDATA%\ai.vinnie.desktop\vinnie.db`, in WAL
mode, with foreign keys on. Every query uses bound parameters.

## Migrations

Migrations are forward-only and tracked with `PRAGMA user_version` (`src-tauri/src/db/migrations.rs`):

| Version | Adds |
| --- | --- |
| 1 | `conversations`, `messages`, `settings` (key/value) |
| 2 | Tool messages (rebuilt `messages`), `changes`, `command_allowlist`, `project_metadata` |
| 3 | `mcp_servers`, `tool_settings`, `skill_settings` |

Never edit a released migration; append a new one.

## Tables

| Table | Contents |
| --- | --- |
| `conversations` | Id, title, model, timestamps |
| `messages` | Role, content, reasoning, status, model, error, tool calls, tool name |
| `settings` | Key/value: `app_settings` (JSON), `project_path`, last conversation, built-in skills |
| `changes` | Change history with before/after snapshots and hashes |
| `command_allowlist` | Always-allowed commands per project |
| `project_metadata` | Cached project analysis |
| `mcp_servers` | MCP server configs as JSON (secret names only) |
| `tool_settings` | Enabled flag, policy, run count, last run, last outcome |
| `skill_settings` | Enabled flag per skill |

:::caution
Inspect the database while Vinnie is closed, or through the app. Tools reading the file directly may miss data
that's still in the write-ahead log (`vinnie.db-wal`).
:::

Corrupt or missing settings fall back to defaults instead of failing.
