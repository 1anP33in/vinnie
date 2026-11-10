---
title: "STDIO Connections"
description: "Run a local MCP server that Vinnie launches and manages."
sidebar:
  order: 4
---
With the **Local process (stdio)** transport, Vinnie starts the server program itself and exchanges
newline-delimited JSON-RPC messages over its standard input and output.

## Fields

| Field | Notes |
| --- | --- |
| **Command** | A program on your `PATH` (such as `npx`, `uvx`, `node`, `python`) or a full absolute path. Relative paths with folders aren't allowed |
| **Arguments** | One per line. Each line is passed as a separate argument, with no shell parsing or quoting needed |
| **Environment** | `KEY=value` lines, for variables that aren't secret |
| **Working folder** | Optional; defaults to your user folder |
| **Secrets** | `env` secrets become environment variables, for example `env:GITHUB_TOKEN` |

## How Vinnie runs the process

- **No shell.** The command runs directly; characters such as `&`, `|`, `>`, or `%` in the Command field are
  rejected. Put arguments in **Arguments**.
- **Minimal environment.** The process gets only Windows basics (such as `PATH`, `SYSTEMROOT`, `TEMP`,
  `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`) plus the server's own variables and secrets. Other variables in
  Vinnie's environment, such as tokens you've set for other tools, aren't passed on.
- **No console window.**
- **Cleaned up.** Each server runs inside a Windows job object. When you disconnect or remove the server, or
  when Vinnie exits for any reason (even a crash), the server and everything it started are terminated.
- **Bounded output.** Messages larger than 8 MB are dropped and reported. Lines that aren't JSON-RPC (such as
  a stray log line on stdout) are ignored and reported.
- **stderr** (the server's log output) appears in the server's **Logs**, with secret values replaced by
  `[redacted]`.

## Example: a Python server via uv

| Field | Value |
| --- | --- |
| Command | `uvx` |
| Arguments | `my-mcp-server` |
| Secret | `env:MY_SERVICE_API_KEY` = your key |

## Exported form

When you **Export** servers, a stdio server looks like this. Secret names are listed, but values never are:

```json
{
  "format": "vinnie-mcp-servers",
  "version": 1,
  "servers": [
    {
      "server": {
        "id": "docs",
        "name": "Docs",
        "description": "Read-only access to the docs folder",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\Docs"],
        "env": {},
        "cwd": null,
        "url": null,
        "headers": {},
        "enabled": true,
        "autoConnect": true,
        "toolTimeoutSecs": 60,
        "defaultPolicy": "ask"
      },
      "requiredSecrets": []
    }
  ]
}
```
