---
title: "MCP Architecture"
description: "How the MCP subsystem is built."
sidebar:
  order: 8
---
```text
McpManager (src/mcp/manager.ts)
 ├── one SDK Client per server (@modelcontextprotocol/sdk 1.32.1)
 │    ├── TauriStdioTransport ── mcp_stdio_start / send / stop ──▶ Rust stdio relay (mcp/stdio.rs)
 │    └── StreamableHTTPClientTransport(fetch = createTauriFetch) ── mcp_http_fetch / abort ──▶ Rust HTTP relay (mcp/http.rs)
 ├── discovery: listTools (paginated), listChanged → refresh
 ├── tool adapter (toolAdapter.ts): McpToolInfo → VinnieTool, registered in the ToolRegistry
 ├── health: ping every 30 s, 3 reconnect attempts (2 s, 5 s, 15 s)
 └── events: mcp.* (src/mcp/events.ts)
```

- The **SDK does the protocol**: initialization, sessions, SSE, request ids, timeouts, and cancellation
  (`notifications/cancelled`).
- The **backend does the I/O**: it reads the server's command or URL and secrets from its own store
  (`mcp/config.rs`, `mcp/secrets.rs`). The frontend only passes a server id.
- **Classification** (`classify.ts`) infers each tool's permission from its name.
- **Validation** uses ajv (2020-12 and draft-07) for input schemas; descriptions and results are sanitized and
  bounded.
- **Configuration** UI: `src/components/integrations/` (McpView, ServerEditor, ToolsView).

## Persistence

| Data | Where |
| --- | --- |
| Server configs (no secrets) | SQLite table `mcp_servers` |
| Secrets | Windows Credential Manager, `Vinnie/mcp/<id>/<key>` |
| Tool settings and counters | SQLite table `tool_settings` |
| Server logs | In memory, last 500 entries per server |
