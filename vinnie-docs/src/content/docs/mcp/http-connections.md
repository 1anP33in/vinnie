---
title: "HTTP Connections"
description: "Connect to a remote MCP server over Streamable HTTP."
sidebar:
  order: 5
---
With the **Remote (Streamable HTTP)** transport, Vinnie sends MCP messages as HTTP requests to a URL and reads
JSON or server-sent-event (SSE) responses. Sessions (`Mcp-Session-Id`) and reconnection of the event stream
are handled by the MCP SDK.

## Fields

| Field | Notes |
| --- | --- |
| **URL** | The server's MCP endpoint, for example `https://mcp.example.com/mcp`. Remote servers must use `https://`; plain `http://` is only allowed for `localhost`, `127.0.0.1`, and `::1` |
| **Headers** | `Name: value` lines that aren't secret, for example `X-Workspace: my-team` |
| **Secrets** | `header` secrets, for example `header:Authorization` = `Bearer <token>` |

Don't put credentials in the URL (`https://user:password@…`); Vinnie rejects that. Headers that the transport
manages itself (`Host`, `Content-Type`, `Accept`, `Mcp-Session-Id`, `Mcp-Protocol-Version`, and others) can't
be set.

## How requests are sent

HTTP requests are made by Vinnie's Rust backend, not the webview:

- Requests may only go to the **configured origin** (same scheme, host, and port).
- **Redirects aren't followed**, so a server can't bounce your token to another site.
- Authorization and cookies are **only** taken from your configured headers and secrets.
- Responses larger than 16 MB are cut off with an error.
- The first response must arrive within 60 seconds.

## Authentication

Use a token in a secret header. OAuth sign-in flows aren't supported yet. If the server answers 401, Vinnie
shows *"The server rejected the credentials (401). Check the server's secrets."* Edit the server and replace
the secret value.

## Testing a server

**Test connection** connects if needed and reports the number of tools, or the error. The server's **Logs**
show the HTTP status of failed requests.
