// DragonEventAdapter: subscribes to the agent runtime's event stream and turns
// each real event into companion state. It never emits events, never calls
// the runtime, and never schedules activity of its own; the only timer is the
// one that returns the dragon to rest some seconds after a task ends.

import { onAgentEvent, type AgentEvent, type AgentEventType } from "@/agent/runtime/events";
import {
  activityForCategory,
  behaviorForStatus,
  BEHAVIOR_LABEL,
  TERMINAL_BEHAVIORS,
  TERMINAL_HOLD_MS,
} from "./behavior";
import {
  INITIAL_COMPANION_STATE,
  MAX_RECENT_EVENTS,
  useCompanionStore,
  type CompanionState,
  type EventTone,
} from "./companionStore";

const TONE: Partial<Record<AgentEventType, EventTone>> = {
  "agent.started": "active",
  "agent.tool_started": "active",
  "agent.tool_completed": "success",
  "agent.tool_failed": "error",
  "agent.permission_requested": "warning",
  "agent.permission_granted": "success",
  "agent.permission_denied": "warning",
  "agent.verifying": "active",
  "agent.verification_passed": "success",
  "agent.verification_failed": "error",
  "agent.paused": "warning",
  "agent.completed": "success",
  "agent.failed": "error",
  "agent.stopped": "error",
  "agent.cancelled": "warning",
};

/** Events too frequent or internal to be worth a line in the recent list. */
const QUIET: ReadonlySet<AgentEventType> = new Set(["agent.thinking", "agent.tool_requested"]);

let nextEventId = 1;

/** Pure reducer: the companion state after one agent event. */
export function reduceAgentEvent(state: CompanionState, event: AgentEvent): CompanionState {
  const behavior = behaviorForStatus(event.task.status);
  const toolName = typeof event.data?.tool === "string" ? event.data.tool : null;
  const category = typeof event.data?.category === "string" ? event.data.category : null;
  const next: CompanionState = {
    ...state,
    behavior,
    agentStatus: event.task.status,
    taskId: event.taskId,
    task: event.task.userRequest,
  };

  switch (event.type) {
    case "agent.started":
      next.activity = "Starting the task";
      next.tool = null;
      next.reaction = { kind: "task_started", at: event.at };
      break;
    case "agent.thinking":
    case "agent.planning":
    case "agent.retrying":
      next.activity = event.label;
      next.tool = null;
      break;
    case "agent.tool_requested":
      next.activity = event.label;
      next.tool = toolName ? { name: toolName, category: null } : null;
      break;
    case "agent.permission_requested":
      next.activity = "Waiting for your approval";
      break;
    case "agent.tool_started":
      next.activity = event.label;
      next.tool = toolName ? { name: toolName, category } : null;
      next.reaction = { kind: "tool_started", at: event.at };
      break;
    case "agent.tool_completed":
      next.activity = null;
      next.tool = null;
      break;
    case "agent.tool_failed":
      next.activity = null;
      next.tool = null;
      next.reaction = { kind: "flinch", at: event.at };
      break;
    case "agent.permission_denied":
      next.tool = null;
      break;
    case "agent.verifying":
      next.activity = "Verifying changes";
      next.tool = null;
      break;
    case "agent.verification_passed":
    case "agent.verification_failed":
      next.activity = event.label;
      break;
    case "agent.paused":
      next.activity = "Paused by you";
      break;
    case "agent.completed":
    case "agent.failed":
    case "agent.stopped":
    case "agent.cancelled":
      next.activity = null;
      next.tool = null;
      next.lastResult = { behavior, label: event.label, at: event.at };
      if (event.type === "agent.completed") next.reaction = { kind: "celebrate", at: event.at };
      break;
    default:
      break;
  }

  if (!QUIET.has(event.type)) {
    const entry = { id: nextEventId++, type: event.type, label: event.label, at: event.at, tone: TONE[event.type] ?? "info" };
    next.recent = [entry, ...state.recent].slice(0, MAX_RECENT_EVENTS);
  }
  return next;
}

/** After a task's end posture has been shown, rest. Task details are cleared. */
export function settle(state: CompanionState): CompanionState {
  return { ...state, behavior: "idle", agentStatus: null, taskId: null, task: null, activity: null, tool: null };
}

/** One-line status for the indicator and accessibility labels. */
export function describeCompanion(state: CompanionState): string {
  if (!state.connected) return "Not connected to the agent";
  if (state.behavior === "idle") return "Idle";
  return state.activity ? `${BEHAVIOR_LABEL[state.behavior]}: ${state.activity}` : BEHAVIOR_LABEL[state.behavior];
}

export { activityForCategory };

let unsubscribe: (() => void) | null = null;
let restTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Connect the dragon to the agent runtime (idempotent). Failures are recorded
 * in the store; they never affect the runtime.
 */
export function connectDragonToAgent(subscribe: typeof onAgentEvent = onAgentEvent): void {
  if (unsubscribe) return;
  try {
    unsubscribe = subscribe((event) => {
      if (restTimer) clearTimeout(restTimer);
      restTimer = null;
      const next = reduceAgentEvent(useCompanionStore.getState(), event);
      useCompanionStore.setState(next);
      if (TERMINAL_BEHAVIORS.includes(next.behavior)) {
        const taskId = next.taskId;
        restTimer = setTimeout(() => {
          restTimer = null;
          const current = useCompanionStore.getState();
          if (current.taskId === taskId && TERMINAL_BEHAVIORS.includes(current.behavior)) {
            useCompanionStore.setState(settle(current));
          }
        }, TERMINAL_HOLD_MS[next.behavior] ?? 5_000);
      }
    });
    useCompanionStore.setState({ connected: true, connectionError: null });
  } catch (err) {
    unsubscribe = null;
    useCompanionStore.setState({
      connected: false,
      connectionError: err instanceof Error ? err.message : String(err),
    });
  }
}

/** For tests: disconnect and reset. */
export function disconnectDragonFromAgent(): void {
  unsubscribe?.();
  unsubscribe = null;
  if (restTimer) clearTimeout(restTimer);
  restTimer = null;
  useCompanionStore.setState({ ...INITIAL_COMPANION_STATE });
}
