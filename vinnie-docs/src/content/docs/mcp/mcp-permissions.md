---
title: "MCP Permissions"
description: "How Vinnie classifies and approves external tools."
sidebar:
  order: 8
---
MCP tools aren't trusted automatically. Every call goes through Vinnie's permission manager, the same one that
guards file changes and commands.

## Vinnie's own classification

Vinnie decides each tool's category **from the tool's name**, not from the server's description:

| Category | Name words (examples) | Example tools |
| --- | --- | --- |
| **Read** | get, list, search, read, find, query, describe, show, view, inspect, status | `search_repositories`, `get_file_contents` |
| **Network** | fetch, http, request, download, browse, navigate, url | `fetch_url` |
| **Write** | create, update, edit, write, add, upload, move, rename, commit, push, merge | `create_issue` |
| **Execute** | exec, execute, run, shell, command, eval, script | `execute_query` |
| **External action** | send, post, publish, notify, message, email, invite, comment | `send_message` |
| **Delete** | delete, remove, drop, destroy, purge, erase, truncate, ban, kick, revoke | `delete_repository` |

- The most sensitive word wins: `list_and_delete` is **Delete**.
- A name with no known word is an **External action** (safe by default).
- A server's `destructiveHint` annotation can make a tool **more** sensitive, never less. Its `readOnlyHint` is
  ignored.

## Approval policies

Each tool has a policy, set in the server details or the Tool Explorer:

| Policy | Effect |
| --- | --- |
| **Ask every time** (default) | An approval card for each call (unless you allowed it for the task or session) |
| **Allow without asking** | Runs without a card |
| **Never allow** | Always refused |
| **Server default** | Uses the server's *Default approval* |

## Rules that always apply

- **Delete** tools always ask, even when set to *Allow*. The card requires a confirmation checkbox, and
  approval can't be remembered for the task or session.
- **Ask mode**: only Read and Network tools may run.
- **Assist mode**: every MCP call asks.
- Arguments are validated against the tool's schema **before** you're asked.

## The approval card

```text
Vinnie wants to use GitHub:
  Server     GitHub
  Tool       create_issue
  repo       MyOrganization/MyProject
  title      Fix authentication bug
  Risk       Write — acts outside your project
  This runs on an external MCP server. Vinnie can't undo it from the Changes panel.
[Allow once] [Allow for this task] [Allow for session] [Deny]
```

Argument values that look like secrets are shown as `[redacted]`. Long values are shortened.
