---
title: "Error Handling"
description: "Error kinds and how they reach the user."
sidebar:
  order: 13
---
## Backend

`src-tauri/src/error.rs` defines `AppError { kind, message }`, serialized to the frontend. Kinds:

`validation`, `not_found`, `database`, `unreachable`, `timeout`, `http`, `model_not_found`, `malformed`,
`interrupted`, `busy`, `io`, `internal`, `forbidden`, `blocked`, `permission_denied`, `approval_required`,
`conflict`, `tools_unsupported`, `no_workspace`.

Messages are written for users ("Could not connect to Ollama at …"), not stack traces.

## Frontend

`src/lib/errors.ts` converts anything thrown into `VinnieError` (`toVinnieError`) and describes it for the UI
(`describeError`) with a title, detail, optional hint, and optional command:

| Kind | Title shown |
| --- | --- |
| `unreachable` | Can't reach Ollama |
| `timeout` | Ollama is taking too long |
| `model_not_found` | Model not installed (with `ollama pull <model>`) |
| `malformed` | Unexpected response |
| `interrupted` | Response interrupted |
| `database` | Couldn't save to the local database |
| `forbidden` | Outside the project |
| `blocked` | Command blocked |
| `permission_denied` | Not permitted |
| `approval_required` | Approval needed |
| `conflict` | File changed elsewhere |
| `tools_unsupported` | This model can't use tools |
| `no_workspace` | No project folder |

In the agent, errors become [failure codes](/agent-system/error-recovery/) with recovery hints, so the model can
react.
