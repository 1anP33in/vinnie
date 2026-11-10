---
title: "Permissions and Approvals"
description: "Control what Vinnie may do and when it asks."
sidebar:
  order: 11
---
Permissions are set under **Settings → Assistant permissions**. They're enforced by the application and the
Rust backend; the model can't change them.

## Permission levels

| Permission | Covers | Default |
| --- | --- | --- |
| **Read files** | Searching and reading project files | Allowed |
| **Change files** | Creating, editing, moving, and deleting files | Ask me |
| **Run commands** | Commands that aren't on the low-risk list | Ask me |
| **Install dependencies** | `npm install`, `pip install`, `cargo add`, and similar | Ask me |

Each can be **Allowed**, **Ask me**, or **Never**.

## Always asks, regardless of settings

- **Deleting** a file.
- **Reading files that may hold secrets**: `.env` and `.env.*` (except `.env.example`, `.env.sample`, and
  `.env.template`), `*.pem`, `*.key`, `*.pfx`, `*.p12`, `id_rsa`, `id_ed25519`, `.npmrc`, `.pypirc`,
  `credentials.json`, `secrets.json`, and `server.cfg`. Their contents would be sent to the model.
- **Destructive MCP tools**, which also need a confirmation checkbox.
- **Everything**, in [Assist mode](/user-guide/agent-modes/).

## Approval scopes

When an approval card appears, you choose how long the approval lasts:

| Choice | Lasts | Offered for |
| --- | --- | --- |
| **Allow once** / **Approve** | This action only | All |
| **Allow for this task** / **Approve all for this task** | Until the current agent task ends | Commands, file changes, MCP tools |
| **This session** / **Allow for session** | Until Vinnie restarts | Commands, MCP tools |
| **Always allow** | Stored for this project | Commands only (the exact command) |
| **Deny** | Refused | All |

Deletions and secret-file reads are never remembered. Task grants are removed when the task ends.

## Example: a command approval

```text
Vinnie wants to run:
  npm install express
Workspace   C:\Projects\my-app
Reason      Install the dependency required by the new route.
Risk        Installs packages (high) — Changes the project's installed dependencies.
[Allow once] [Allow for this task] [This session] [Always allow] [Deny]
```

If the package manager is ambiguous, the card lets you pick it before allowing.

## Command permissions and the policy

*Run commands* only matters for commands that **need approval**. Low-risk commands always run, and blocked
commands never run, whatever this setting says. See [Command execution security](/security/command-execution-security/).

## MCP tool policies

MCP tools have their own policy (*Ask every time*, *Allow without asking*, *Never allow*) per server and per
tool. See [MCP permissions](/mcp/mcp-permissions/).
