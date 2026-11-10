---
title: "Troubleshooting MCP"
description: "Fix common MCP connection and tool problems."
sidebar:
  order: 9
---
Start with the server's **Logs** on the MCP servers screen. They combine Vinnie's connection events with the
server's own stderr output, with secrets redacted.

## The server shows ERROR right after adding it

| Message or log | Cause | Fix |
| --- | --- | --- |
| `` `npx` was not found `` | The program isn't on `PATH` | Install it (Node.js for `npx`, uv for `uvx`), restart Vinnie |
| *Use a program name on PATH… or a full absolute path* | A relative path with folders in **Command** | Use a name on `PATH` or a full path |
| *The working directory … does not exist* | Wrong **Working folder** | Fix or clear it |
| *The server rejected the credentials (401)* | Missing or wrong token | Edit the server and set the secret again |
| *The secret … is missing* | The secret was removed from Credential Manager | Edit the server and enter it again |
| *did not finish starting within 30 seconds* | Slow first start (for example `npx` downloading) | **Restart**; later starts are faster |
| *Remote servers must use https://* | An `http://` URL to another computer | Use `https://`, or run the server locally |

## Tools are listed under "Rejected tools"

The tool's input schema isn't valid JSON Schema, or isn't an object. The reason is shown next to the tool. This
needs a fix in the server.

## The server keeps disconnecting

Vinnie reconnects up to 3 times. Check the logs for crashes in the server's own output. A local server that exits
immediately often needs an argument or environment variable.

## The model doesn't use the server's tools

- Check that the server is **CONNECTED** and the tool is **enabled** in the Tool Explorer.
- Only the 8 most relevant MCP tools are offered per request. Mention the service ("on GitHub", "in the Tracker")
  so its tools are chosen.
- For questions and in Ask mode, only read and network tools are offered.
- Use a model with reliable tool calling (`qwen3:8b`).

## A tool call fails or times out

- *timed out*: raise the server's **Tool timeout** (5–600 seconds).
- *rejected the arguments*: the model sent wrong arguments; it receives the error and usually corrects itself.
- *The connection to … was lost*: see disconnecting above.

More: [MCP connection issues](/troubleshooting/mcp-connection-issues/).
