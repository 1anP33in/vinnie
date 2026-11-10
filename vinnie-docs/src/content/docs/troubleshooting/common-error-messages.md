---
title: "Common Error Messages"
description: "A quick reference for messages you may see."
sidebar:
  order: 9
---
| Message | Where | Meaning and fix |
| --- | --- | --- |
| Can't reach Ollama | Chat, status bar | Ollama isn't running; click **Launch Ollama**. [More](/troubleshooting/ollama-connection-errors/) |
| Ollama is taking too long | Chat | Model loading; wait and retry |
| Model not installed | Chat | `ollama pull <model>` |
| This model can't use tools | Notice | Pick a tool-capable model |
| Response interrupted | Chat | Partial answer kept; **Retry** |
| Couldn't save to the local database | Anywhere | Check free disk space; retry |
| Please check your input | Forms | A field is invalid; the message says which |
| Already working | Chat | Wait for the current response or press **Stop** |
| Outside the project | Tools | A path left the project folder |
| Command blocked | Terminal, tools | The command policy forbids it |
| Not permitted | Tools | A permission is set to *Never* |
| Approval needed | Tools | An approval was required but not given |
| File changed elsewhere | Editor, revert | The file changed since it was read; reload or compare |
| No project folder | Tools | Choose a project folder |
| Task stopped safely. Reason: Maximum iteration limit reached. | Task report | Raise the limit in **Settings → Agent** |
| Verification still failed after N attempt(s). | Task report | The checks keep failing; read the listed checks |
| Plan steps not marked done: … | Task report | The model skipped steps; ask again |
| The server rejected the credentials (401) | MCP | Fix the server's secret |

If an error isn't listed, copy **Settings → About & diagnostics → Copy diagnostics** and check the log file
(`%LOCALAPPDATA%\ai.vinnie.desktop\logs\vinnie.log`).
