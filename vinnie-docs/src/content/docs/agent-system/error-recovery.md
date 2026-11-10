---
title: "Error Recovery"
description: "How failures are classified, retried, and reported."
sidebar:
  order: 8
---
## Failure codes

Every failed tool call gets a code and a recovery hint that's sent to the model:

| Code | Typical cause |
| --- | --- |
| `FILE_NOT_FOUND` | The path doesn't exist |
| `PERMISSION_DENIED` | You denied it, your settings forbid it, or the command policy blocked it |
| `INVALID_ARGUMENT` | Bad arguments, or a path outside the project |
| `COMMAND_FAILED` | A command exited with a non-zero code |
| `COMMAND_TIMEOUT` | A command or MCP tool took too long |
| `DEPENDENCY_FAILURE` | An install failed |
| `NETWORK_FAILURE` | A connection failed (for example an MCP server went away) |
| `MODEL_FAILURE` | The model request failed |
| `TOOL_FAILURE` | The tool itself failed (for example an MCP tool reported an error) |
| `VALIDATION_FAILURE` | Verification failed |
| `CANCELLED` | You stopped the task |

Failed command results include a **diagnosis** where Vinnie recognizes the error, for example
*"Likely cause: Cannot find module 'express'."*

## No endless retries

- An **identical** failing tool call (same tool, same arguments) may be retried at most *Max retries* times.
  After that it's refused with *"this exact call has already failed N times. Change your approach instead
  of repeating it."* A different call, or a success, resets this.
- Denied and cancelled calls don't count as failures, but the model is told not to retry denials.
- Verification repair attempts are bounded by *Max retries*.

## Model failures

| Situation | What Vinnie does |
| --- | --- |
| Connection dropped, timeout, or unparseable tool call **before** any output | Retries, with 1 s, 2 s… backoff, up to *Max retries* |
| Failure **after** output was shown | Keeps the partial response (marked interrupted) and reports the error |
| The model doesn't support tools | Continues **without tools** and shows a notice |
| Model not installed | Stops with *"Model not installed"* and suggests `ollama pull <model>` |

## Honest outcomes

- If the model stops early, Vinnie asks it **once** to continue or explain.
- If tool calls appear inside prose, Vinnie tells the model they didn't run.
- The task report states what really happened: *"No files were changed."*, *"Plan steps not marked done: …"*,
  or the failing checks.
