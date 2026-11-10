---
title: "Tool Execution Failures"
description: "Understand why a tool call failed."
sidebar:
  order: 5
---
Failed tool calls appear in the task timeline (red mark) and the Activity feed, with a failure code and message.
The model sees the same message plus a recovery hint and usually tries something else.

| Message | Cause |
| --- | --- |
| *Vinnie requested an unknown tool: X. The operation was not executed.* | The model invented a tool name |
| *The X tool is not available for this task (mode or request type)* | For example a write tool in Ask mode, or for a question |
| *Invalid input for X: …* | Arguments didn't match the tool's schema |
| *The X tool is disabled in Tools settings* | You disabled it in the Tool Explorer |
| *… is unavailable because its server is not connected* | The MCP server is down |
| *Not executed: this exact X call has already failed N times* | Retry guard: the model must change its approach |
| *… was not found* (`FILE_NOT_FOUND`) | Wrong path |
| `INVALID_ARGUMENT` with *outside the project folder* | A path outside the project was refused |
| *Result: FAILED* with *Likely cause: …* | A command exited with an error; the diagnosis names the likely cause |
| *TIMED OUT* | The command exceeded the command timeout |

## Commands that fail only in Vinnie

Commands run without a shell: pipes, `&&`, redirects, and variables are refused. Run one command at a time.
Programs are found on `PATH` only, not in the project folder.

## Seeing the details

Turn on **Settings → Agent → Task debug view** and open **Task** in the bottom panel to see each call's arguments
and full result (secrets redacted).
