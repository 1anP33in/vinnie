---
title: "Introduction to MCP"
description: "Extend Vinnie with MCP servers: what's supported and where to start."
sidebar:
  order: 1
---
Vinnie can connect to **MCP servers** to gain new tools, for example reading a documentation folder,
inspecting GitHub issues, or querying a database, without changing Vinnie itself.

## What you get

- **Two transports**: local servers that Vinnie launches (**stdio**), and remote servers by URL
  (**Streamable HTTP**).
- **Automatic tool discovery** when a server connects, refreshed when the server reports a change.
- **The same agent loop**: MCP tools run through Vinnie's normal executor, permissions, approvals, timeline, and
  task report. There's no separate "MCP mode".
- **Per-tool control**: enable or disable each tool and set its approval policy.
- **Secure credentials**: tokens and API keys are stored in Windows Credential Manager.
- **Health monitoring**: status, logs, and automatic reconnection.

Vinnie uses the **official MCP TypeScript SDK** (`@modelcontextprotocol/sdk` 1.32.1) for the protocol itself.

## What's supported

| MCP feature | Status |
| --- | --- |
| Tools (list, call, `listChanged` notifications) | Supported |
| stdio transport | Supported |
| Streamable HTTP transport (including SSE responses and sessions) | Supported |
| Static headers and secret headers (for example `Authorization: Bearer …`) | Supported |
| Resources, prompts, sampling, elicitation | Not supported yet |
| OAuth sign-in flows | Not supported yet; use a token in a secret header |
| Legacy HTTP+SSE transport | Not supported (deprecated in the MCP specification) |

## Where to go next

1. [What is MCP?](/mcp/what-is-mcp/): the protocol in two minutes.
2. [Adding MCP servers](/mcp/adding-mcp-servers/): step-by-step.
3. [MCP permissions](/mcp/mcp-permissions/): how Vinnie keeps external tools in check.
