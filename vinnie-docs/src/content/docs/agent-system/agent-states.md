---
title: "Agent States"
description: "The statuses a task goes through."
sidebar:
  order: 9
---
Every agent task has a status, shown in the agent panel and the status bar.

| Status | Agent panel text | Meaning |
| --- | --- | --- |
| `idle` | Starting… | The task was created |
| `planning` | Vinnie is planning… | First step of a task, before a plan exists |
| `thinking` | Vinnie is thinking… | Waiting for the model |
| `executing` | Vinnie is working… / reading files… / searching the project… / preparing changes… / running a command… | Running tool calls |
| `waiting_for_permission` | Vinnie is waiting for your permission… | An approval card is open |
| `verifying` | Vinnie is verifying… | Running [verification](/agent-system/verification-system/) |
| `paused` | Vinnie paused. | You paused; it continues on Resume |
| `completed` | Task completed | Finished; any verification passed |
| `failed` | Task failed | Verification kept failing, or the model failed |
| `stopped` | Task stopped safely | A limit was reached |
| `cancelled` | Task cancelled | You pressed Stop |

A task that finished without changing anything is shown as *"Task finished — no files were changed"*.

## Transitions

```text
idle → planning | thinking
thinking ⇄ executing ⇄ waiting_for_permission
thinking → verifying → thinking (repair) | completed | failed
any running state → paused → previous state
any running state → completed | failed | stopped | cancelled
```

## Events

Each transition also emits an event on the agent event bus: `agent.started`, `agent.thinking`, `agent.planning`,
`agent.plan_updated`, `agent.tool_requested`, `agent.permission_requested`, `agent.permission_granted`,
`agent.permission_denied`, `agent.tool_started`, `agent.tool_completed`, `agent.tool_failed`,
`agent.retrying`, `agent.verifying`, `agent.verification_passed`, `agent.verification_failed`,
`agent.paused`, `agent.resumed`, `agent.completed`, `agent.failed`, `agent.stopped`, and `agent.cancelled`.

They drive the agent panel, the activity feed, and the [ice dragon](/dragon/dragon-states/) status. See
[Event system](/developer/event-system/).
