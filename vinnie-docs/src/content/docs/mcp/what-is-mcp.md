---
title: "What is MCP?"
description: "The Model Context Protocol in brief, and how Vinnie uses it."
sidebar:
  order: 2
---
The [Model Context Protocol](https://modelcontextprotocol.io) (MCP) is an open protocol for connecting AI
applications to tools and data. An **MCP server** offers capabilities; an **MCP client**, here Vinnie, connects
to it and uses them.

## The pieces

| Term | In Vinnie |
| --- | --- |
| **Server** | A program or web service you configure in the MCP manager, for example the official filesystem server |
| **Transport** | How client and server talk: *stdio* (Vinnie starts the program and talks over its input and output) or *Streamable HTTP* (requests to a URL) |
| **Tool** | A named action with a JSON Schema for its arguments, for example `list_issues` with `{ "repo": "string" }` |
| **Session** | A connection that starts with an `initialize` handshake |

Messages are JSON-RPC 2.0. For example, Vinnie asks for the list of tools:

```json
{ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }
```

and calls one:

```json
{ "jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": { "name": "list_issues", "arguments": { "label": "bug" } } }
```

## How Vinnie uses MCP

1. When a server connects, Vinnie lists its tools, validates each one, and registers it as a Vinnie tool
   named `<server>__<tool>`, for example `github__list_issues`.
2. When you send a request, Vinnie offers the model a few **relevant** MCP tools alongside its native tools.
3. When the model calls an MCP tool, Vinnie validates the arguments, checks permissions (usually asking you),
   and sends `tools/call` to the server.
4. The result comes back to the model, clearly labeled as external data.

## Trust

MCP servers are separate programs written by other people. Vinnie treats every server as **untrusted**: it
decides each tool's risk itself, asks before external actions, and keeps your secrets away from the model.
See [MCP security](/security/mcp-security/).
