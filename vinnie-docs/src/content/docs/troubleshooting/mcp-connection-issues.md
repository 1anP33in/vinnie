---
title: "MCP Connection Issues"
description: "Fix MCP servers that won't connect or stay connected."
sidebar:
  order: 7
---
Open the server on the **MCP servers** screen and read its error and **Logs**.

| Error | Fix |
| --- | --- |
| *`npx` was not found…* | Install the program (Node.js for `npx`) and restart Vinnie |
| *Use a program name on PATH (like npx) or a full absolute path.* | Fix **Command** |
| *Enter only the program name or path; put arguments in Arguments.* | Move arguments out of **Command** |
| *The server rejected the credentials (401)…* | Set the token secret again (**Edit**) |
| *The secret … is missing. Edit the server and enter it again.* | Re-enter the secret |
| *The server did not finish starting within 30 seconds.* | **Restart**; a first `npx` run downloads the package |
| *Remote servers must use https://…* | Use HTTPS for remote URLs |
| *MCP requests may only go to the server's configured address.* | The server tried to send requests elsewhere; check the URL |
| *The MCP server did not respond within 60 seconds.* | Server down or overloaded |
| *… is disabled.* | Turn on **Enabled** |
| *The server wrote a line that is not a JSON-RPC message.* | The server prints logs to stdout instead of stderr; usually harmless |

## It connects, then drops

Vinnie reconnects up to three times. If it keeps failing, the server's stderr in **Logs** usually explains why
(missing configuration, crash).

## No tools, or rejected tools

See [Discovering tools](/mcp/discovering-tools/). Rejected tools have invalid schemas and need a fix in the server.

More: [Troubleshooting MCP](/mcp/troubleshooting-mcp/).
