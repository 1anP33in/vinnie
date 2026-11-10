---
title: "Permission Architecture"
description: "The layers that decide what Vinnie may do."
sidebar:
  order: 1
---
Vinnie assumes the language model can be wrong or manipulated, for example by text in a file it reads or a
result from an MCP server. Safety therefore doesn't depend on the model behaving.

## Layers

| Layer | Where | Enforces |
| --- | --- | --- |
| Tool selection | Agent runtime | Only tools allowed by the mode and request are offered; disabled and unavailable tools never are |
| Tool validation | Tool registry | Unknown tools and invalid arguments are refused before anything runs |
| Permission manager | Agent runtime | Mode, your permission levels, scoped grants; asks you through approval cards |
| Approval UI | Desktop app | Only you can approve; the model can't answer an approval card |
| Backend checks | Rust | The permission level again, the explicit approval flag, the project boundary, the command policy |
| Verification | Agent runtime | The outcome is judged by the app, not by the model |

A request has to pass **every** layer. For example, even if a bug let a write tool be offered in Ask mode, the
permission manager would refuse it, and the backend would still require an approval for a gated operation.

## What the model can't do

- approve its own actions or change permissions, limits, or modes;
- read or write outside the project folder;
- run shell syntax, blocked programs, or chained commands;
- see MCP secrets;
- mark a task successful.

See [Permissions and approvals](/user-guide/permissions-and-approvals/) for the user-facing settings.
