---
title: "Credential Storage"
description: "Where secrets live and who can read them."
sidebar:
  order: 5
---
## MCP secrets

Secret environment variables and headers for MCP servers are stored in **Windows Credential Manager** as generic
credentials for your Windows user:

```text
Vinnie/mcp/<server-id>/env:GITHUB_TOKEN
Vinnie/mcp/<server-id>/header:Authorization
```

- Only the Rust backend reads them, when it starts a server or sends a request.
- They're **never** stored in Vinnie's database, shown again in the editor, included in exports, sent to the
  model, or written to logs. Known secret values are redacted from server log output.
- A secret can be at most 2,560 bytes (a Credential Manager limit).
- Removing a server deletes its secrets.

You can see them in Windows under **Control Panel → Credential Manager → Windows Credentials**, or with:

```powershell
cmdkey /list | Select-String "Vinnie/mcp"
```

## Other credentials

Vinnie has no account system and no API keys of its own. Ollama needs no credentials when it runs locally.

## Debug view redaction

The [task debug view](/user-guide/task-planning/#the-debug-view) replaces values that look like secrets (keys
named token/secret/password/api key, `sk-…` and GitHub tokens, JWTs, `.env`-style lines) with `[redacted]`.
