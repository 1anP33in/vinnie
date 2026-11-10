---
title: "Key Features"
description: "An overview of what Vinnie can do today."
sidebar:
  order: 3
---
This page summarizes Vinnie's features. Each item links to the page that explains it in detail.

## Chat with local models

- Token-by-token streaming with **Stop** and **Retry**.
- A collapsible reasoning panel for models that think out loud, such as `qwen3`.
- Safe Markdown rendering: raw HTML isn't rendered, code isn't executed, and remote images aren't loaded.
- Conversations are saved locally, grouped by date, and searchable. See [Conversation history](/user-guide/conversation-history/).

## Work inside a project

- **Explorer** with file icons, Git markers, and ignored folders shown dimmed.
- **Editor** (Monaco) with tabs, find, and save.
- **Project search** across file contents or file names, with regular expressions and file-type filters.
- **Terminal** that runs one command at a time under a safety policy. See [Terminal integration](/user-guide/terminal-integration/).
- **Change history**: every change to a file is snapshotted, shown as a diff, and can be reverted.
  See [Change management](/user-guide/change-management/).
- **Project analysis** detects project types, languages, frameworks, package managers, entry points,
  and FiveM manifests.

## Autonomous agent

- Three modes: **Ask** (read-only), **Assist** (asks before every change), and **Agent** (works through tasks
  within your permission rules). See [Agent modes](/user-guide/agent-modes/).
- Visible plans you can edit while the agent runs.
- Pause, resume, and stop at any time.
- Limits on iterations, tool calls, time, and changed files.
- Independent verification and an honest task report.

## Extensibility

- **MCP servers**: connect local (stdio) or remote (Streamable HTTP) servers built on the
  [Model Context Protocol](https://modelcontextprotocol.io). See [MCP integration](/mcp/introduction/).
- **Skills**: reusable instructions for kinds of work, chosen automatically per request. See [Skills](/skills/introduction/).
- **Tool Explorer**: every tool Vinnie can use, with enable switches and usage counts.

## Safety

- Permissions for reading, changing files, running commands, and installing dependencies.
- A command policy that blocks destructive programs and shell syntax.
- Project-boundary enforcement in the backend.
- MCP secrets stored in Windows Credential Manager.

See [Security](/security/permission-architecture/) for details.
