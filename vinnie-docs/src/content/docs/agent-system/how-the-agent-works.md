---
title: "How the Agent Works"
description: "The big picture: the model proposes, the application decides."
sidebar:
  order: 1
---
Vinnie's agent is a **controlled loop** around a language model. The model decides *what it would like to do
next*; the application decides *whether it may*, does it, and judges the result.

## Responsibilities

| The model… | The application… |
| --- | --- |
| reads your request and the context it's given | chooses which tools to offer, based on the mode, request type, and relevance |
| writes a plan and asks for tool calls | validates every call's arguments against the tool's schema |
| decides when it's done | checks permissions, asks you when needed, and runs the tool in the backend |
| | enforces limits (iterations, tool calls, time, changed files) |
| | verifies changes independently and writes the task report |

The model **can't** approve its own actions, raise its limits, run shell syntax, read or write outside the
project, or declare its own success. Text from tools, MCP servers, and skills is treated as data, not
instructions.

## One request, start to finish

1. **Classify** the request as a *question* or a *task*. See [Planning and reasoning](/agent-system/planning-and-reasoning/).
2. **Pick skills** that fit the request and the project, if any. See [Skills](/skills/introduction/).
3. **Build the context**: system prompt, project summary, relevant history, plan, and task memory, within
   the token budget. See [Context management](/agent-system/context-management/).
4. **Loop**: ask the model → run the tool calls it requests → feed the results back. See
   [Agent execution loop](/agent-system/agent-execution-loop/).
5. **Verify** any changes. See [Verification system](/agent-system/verification-system/).
6. **Report**: a task report written by the application.

## Where it lives

The runtime is in `src/agent/runtime/` in the Vinnie repository, with the `AgentRuntime` class in
`runtime.ts`. There is **one** agent loop; MCP tools and native tools run through the same loop. See
[Agent runtime](/developer/agent-runtime/) in the developer docs.
