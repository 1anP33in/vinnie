---
title: "Agent Modes"
description: "Ask, Assist, and Agent: what each mode allows."
sidebar:
  order: 5
---
The agent mode controls how much Vinnie may do on its own. Set it under **Settings → Agent → Mode**. The
default is **Agent**.

| Mode | What Vinnie may do | When it asks you |
| --- | --- | --- |
| **Ask** | Read and search the project, and use read-only MCP tools. It can't change files, install packages, or run commands. | Only for reads of secret-looking files and for MCP tools whose policy is *ask* |
| **Assist** | Everything Agent can do | Before **every** change, command, install, and MCP tool call, even ones your settings allow |
| **Agent** | Plan and work through tasks | Only where your [permission settings](/user-guide/permissions-and-approvals/) say *Ask me*, plus deletions, secret files, and destructive MCP tools, which always ask |

**Full Auto** appears in Settings as *coming later*. It isn't implemented.

## How modes are enforced

The mode is enforced by Vinnie's permission manager, **not** by the model:

- In **Ask** mode, write tools are never offered to the model. If the model asks for one anyway, the request
  is refused with *"Vinnie is in Ask mode (read-only)…"* and nothing runs.
- In **Assist** mode, every gated action shows an approval card, even if a permission is set to *Allowed*.
- In **Agent** mode, your permission levels apply. Grants you give for a task or session are remembered for
  that scope.

## Questions and tasks

Independently of the mode, Vinnie classifies each request:

- A **question** ("Where is the duty command registered?") gets read and search tools (and commands, for
  things like version checks) and is answered directly, without a plan.
- A **task** ("Add a /health endpoint") gets all tools allowed by the mode, a plan, and verification.

See [Planning and reasoning](/agent-system/planning-and-reasoning/).
