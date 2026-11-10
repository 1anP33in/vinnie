---
title: "Privacy and Local Processing"
description: "What data Vinnie keeps, and where it goes."
sidebar:
  order: 6
---
## Stays on your computer

| Data | Location |
| --- | --- |
| Conversations, settings, change history, project analysis, MCP configs, tool settings | `%APPDATA%\ai.vinnie.desktop\vinnie.db` |
| Skills | `%APPDATA%\ai.vinnie.desktop\skills\` |
| Logs (no message or file contents) | `%LOCALAPPDATA%\ai.vinnie.desktop\logs\` |
| MCP secrets | Windows Credential Manager |

Vinnie has no telemetry, analytics, or crash reporting, and no account.

## Leaves the app

| Destination | What | When |
| --- | --- | --- |
| Your Ollama endpoint | Prompts, conversation, project context, tool results | Every model request; normally `localhost` |
| MCP servers you add | Tool arguments | When a tool is called (usually after your approval) |
| Programs you run | Whatever the command does | Commands you or the agent run |

If you point Vinnie at an Ollama server on another machine, or connect a remote MCP server, data goes to that
machine or service.

## Project context

With **Include project context** on, chat requests include a short project summary, a shallow folder tree, the
file open in the editor, and matching file names, never the whole project. Files that may hold secrets are only
read after you approve.
