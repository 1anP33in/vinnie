---
title: "Logging"
description: "Where Vinnie logs and what it records."
sidebar:
  order: 12
---
The backend logs with `tauri-plugin-log`:

| Setting | Value |
| --- | --- |
| File | `%LOCALAPPDATA%\ai.vinnie.desktop\logs\vinnie.log` |
| Also | Standard output (visible in `pnpm app:dev`) |
| Level | Info |
| Rotation | 5 MB per file; one older file kept |

Open the folder from **Settings → About & diagnostics → Open log folder**.

## What's logged

Startup, database location, project changes, tool and command activity (names, exit codes), MCP server starts,
exits, and saves (with the number of secrets changed), skill installation, and errors.

## What's never logged

Message contents, file contents, and secret values. MCP server stderr is shown in the server's **Logs** panel,
with known secret values replaced by `[redacted]`; it's kept in memory (last 500 entries per server), not
written to the log file.
