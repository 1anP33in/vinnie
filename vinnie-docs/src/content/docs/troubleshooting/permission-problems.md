---
title: "Permission Problems"
description: "When Vinnie can't do something you expected."
sidebar:
  order: 6
---
| What you see | Why | Change it |
| --- | --- | --- |
| **Not permitted** — *Your permission settings do not allow Vinnie to …* | That permission is set to **Never** | **Settings → Assistant permissions** |
| *Vinnie is in Ask mode (read-only)…* | Ask mode refuses changes | **Settings → Agent → Mode** |
| An approval card for every step | Assist mode, or the permission is *Ask me* | Switch to Agent mode, or set the permission to *Allowed* |
| **Command blocked** | The command policy blocks it (destructive program, shell, or shell syntax) | Can't be allowed; run it yourself outside Vinnie if you really need it |
| **Outside the project** | A path resolves outside the project folder | Open the right project folder |
| **No project folder** | Project tools need a project | Choose a folder in the sidebar |
| A secret file always asks | `.env`, keys, and similar always ask before reading | By design |
| A delete always asks | Deletions always ask | By design |
| An MCP tool is refused | Its policy is *Never allow*, or the tool is disabled | MCP server details or the Tool Explorer |

## The agent was told "denied"

When you deny an action, the model is told and asked not to retry it. The task continues another way or explains
what it needs.

## Removing remembered approvals

- Task approvals end with the task; session approvals end when Vinnie restarts.
- **Always allow** commands are listed under **Settings → Assistant permissions → Always-allowed commands in this
  project**, where you can remove them.
