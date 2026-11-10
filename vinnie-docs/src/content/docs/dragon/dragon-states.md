---
title: "Dragon States"
description: "The nine states the dragon can show."
sidebar:
  order: 2
---
| State | Shown when | Indicator color |
| --- | --- | --- |
| `idle` | Nothing is happening | Faint |
| `thinking` | The model is thinking, planning, or retrying | Accent |
| `reading` | Reading, searching, or analyzing the project | Accent |
| `editing` | Writing or deleting files | Strong accent |
| `running` | Running commands, installs, or verification | Strong accent |
| `working` | Running other tools, such as MCP tools | Strong accent |
| `waiting` | Waiting for your approval, or paused | Warning |
| `error` | A tool, verification, or task failed | Danger |
| `success` | Verification passed or a task completed | Success |

`success` and `error` are shown for 3 seconds, then the indicator returns to `idle`. While busy, the dragon mark
pulses.
