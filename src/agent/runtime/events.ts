// Agent event system. Independent of the UI: the agent store, the activity
// feed, and (in Phase 5) the ice dragon all subscribe here. Events are only
// emitted by the runtime when the corresponding thing actually happens.

import { emitDragon, type DragonState } from "../events";
import type { AgentTask } from "./types";

export type AgentEventType =
  | "agent.started"
  | "agent.thinking"
  | "agent.planning"
  | "agent.plan_updated"
  | "agent.tool_requested"
  | "agent.permission_requested"
  | "agent.permission_granted"
  | "agent.permission_denied"
  | "agent.tool_started"
  | "agent.tool_completed"
  | "agent.tool_failed"
  | "agent.retrying"
  | "agent.verifying"
  | "agent.verification_passed"
  | "agent.verification_failed"
  | "agent.paused"
  | "agent.resumed"
  | "agent.cancelled"
  | "agent.completed"
  | "agent.failed"
  | "agent.stopped";

export interface AgentEvent {
  type: AgentEventType;
  taskId: string;
  at: number;
  /** Short human-readable description. */
  label: string;
  /** Snapshot of the task after the event. */
  task: AgentTask;
  /** Extra data, e.g. the tool name and category. */
  data?: Record<string, unknown>;
}

type Listener = (event: AgentEvent) => void;
const listeners = new Set<Listener>();

export function emitAgentEvent(event: AgentEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // A failing subscriber must never break the runtime.
    }
  }
}

export function onAgentEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Map agent events to future dragon states (Phase 5 consumes these). */
export function dragonStateFor(event: AgentEvent): DragonState | null {
  switch (event.type) {
    case "agent.started":
    case "agent.thinking":
    case "agent.planning":
    case "agent.retrying":
      return "thinking";
    case "agent.tool_started": {
      const category = event.data?.category;
      if (category === "READ" || category === "SEARCH" || category === "PROJECT") return "reading";
      if (category === "WRITE" || category === "DELETE") return "editing";
      if (category === "EXECUTE" || category === "DEPENDENCY") return "running";
      return "working";
    }
    case "agent.permission_requested":
    case "agent.paused":
      return "waiting";
    case "agent.verifying":
      return "running";
    case "agent.tool_failed":
    case "agent.verification_failed":
    case "agent.failed":
      return "error";
    case "agent.verification_passed":
    case "agent.completed":
      return "success";
    case "agent.cancelled":
    case "agent.stopped":
      return "idle";
    default:
      return null;
  }
}

let bridged = false;

/** Forward agent events to the dragon event bus (idempotent). */
export function bridgeAgentEventsToDragon(): void {
  if (bridged) return;
  bridged = true;
  onAgentEvent((event) => {
    const state = dragonStateFor(event);
    if (state) emitDragon(state, event.label);
  });
}
