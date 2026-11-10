---
title: "Agent Execution Loop"
description: "What happens in each iteration of the agent loop."
sidebar:
  order: 2
---
Each pass through the loop is one **iteration** (shown as *Step n* in the agent panel).

## One iteration

1. **Gate**: if you paused the task, wait here until you resume or stop.
2. **Check limits**: stop safely if the iteration limit or task timeout is reached.
3. **Select tools** for this request (see [Tool calling](/agent-system/tool-calling/)).
4. **Call the model** with the current context. The response streams into the chat.
5. **Read tool calls** from the response. If the model wrote a tool call as plain text instead of a real call,
   and the reply consists only of tool calls, Vinnie recovers it. If tool calls are buried in prose, Vinnie
   tells the model they did **not** run.
6. **No tool calls?** The model thinks it's done:
   - if files changed and *Verify changes automatically* is on, [verify](/agent-system/verification-system/);
     on failure, send the failure back and loop (up to *Max retries* times);
   - if it's a task that changed nothing, or left plan steps unfinished, ask it once to continue or explain;
   - otherwise finish.
7. **Run each tool call** in order: check the tool-call limit, validate, authorize, execute, and record the
   result in the timeline, the activity feed, and the conversation.
8. **Check the changed-files limit**, then go back to step 1.

## Limits

Set under **Settings → Agent**:

| Limit | Default | When reached |
| --- | --- | --- |
| Max iterations | 25 | Task **stopped**: "Maximum iteration limit reached." |
| Max tool calls | 60 | Task **stopped**: "Maximum tool call limit reached." |
| Task timeout | 30 min | Task **stopped**: "Maximum task duration reached." |
| Max changed files | 20 | Task **stopped** once more distinct files than this have changed |
| Max retries | 2 | Bounds repair attempts after failed verification, and identical failing tool calls |

A stopped task keeps the changes already made. They're listed in the task report and can be reverted.

## How a task ends

| Status | Meaning |
| --- | --- |
| Completed | The model finished and verification passed, or there was nothing to verify |
| Failed | Verification kept failing, or the model request failed permanently |
| Stopped | A limit was reached |
| Cancelled | You pressed Stop |

See [Agent states](/agent-system/agent-states/).
