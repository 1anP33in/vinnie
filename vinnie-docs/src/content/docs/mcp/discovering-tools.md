---
title: "Discovering Tools"
description: "How MCP tools are found, validated, named, and shown."
sidebar:
  order: 7
---
## Discovery

When a server connects, Vinnie requests its tools (`tools/list`, following pagination). If the server
announces that its tools changed (`notifications/tools/list_changed`), Vinnie refreshes them automatically. You
can also click **Refresh tools**.

## Validation

Each tool is checked before it's registered:

- it must have a name (at most 128 characters), unique on that server;
- its input schema must be a JSON Schema object (`"type": "object"`) under 64 KB that compiles. Vinnie
  supports JSON Schema **2020-12** and **draft-07**.

Invalid tools are listed under **Rejected tools** with the reason and are never available to the model. If a
server's whole tool list violates the protocol, the server shows **ERROR**.

## Names

| Where | Example |
| --- | --- |
| On the server | `list_issues` |
| Shown to you | `github.list_issues` |
| Given to the model | `github__list_issues` |
| Settings key | `mcp:github:list_issues` |

Because names are prefixed with the server ID, two servers can both have a `list_issues` tool without
conflict.

## What the model sees

- The description is cleaned (control and invisible characters removed) and cut to 600 characters, and it's
  prefixed with `[External tool from the "GitHub" MCP server; read]`.
- Descriptions inside the schema are shortened as well; very large schemas are reduced to their property names
  and types.
- Only the **most relevant** MCP tools for your request are offered, at most 8, scored by your words, the server
  name, and active [skill](/skills/skill-configuration/) hints. Mentioning a server ("on GitHub") brings its tools
  in.

## The Tool Explorer

The **Tools** screen (wrench icon) lists every native and MCP tool. You can search it and filter by
*Native tools*, *MCP tools*, *Development*, *Filesystem*, *Terminal*, or *External services*. For each tool it
shows the source (or *offline* if its server is disconnected), the permission, the enable switch, the
approval policy for MCP tools, the last run, and the number of runs.

**Disabling a tool** removes it from what the model is offered and makes the registry refuse it, so it can't run
even if requested.
