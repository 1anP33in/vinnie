// What the dragon knows about Vinnie's current work. Filled only by the
// DragonEventAdapter from real agent runtime events.

import { create } from "zustand";
import type { AgentEventType } from "@/agent/runtime/events";
import type { AgentStatus } from "@/agent/runtime/types";
import type { DragonBehavior } from "./behavior";

export const MAX_RECENT_EVENTS = 8;

export type EventTone = "info" | "active" | "success" | "warning" | "error";

export interface DragonActivityEvent {
  id: number;
  type: AgentEventType;
  label: string;
  at: number;
  tone: EventTone;
}

export interface DragonTool {
  name: string;
  category: string | null;
}

export interface LastTaskResult {
  behavior: DragonBehavior;
  label: string;
  at: number;
}

export interface CompanionState {
  behavior: DragonBehavior;
  /** Runtime status of the active task, or null when no task is running. */
  agentStatus: AgentStatus | null;
  taskId: string | null;
  /** The user's request for the active task. */
  task: string | null;
  /** What the runtime says it is doing right now (tool label, "Verifying changes"…). */
  activity: string | null;
  /** The tool currently running or awaiting approval. */
  tool: DragonTool | null;
  recent: DragonActivityEvent[];
  lastResult: LastTaskResult | null;
  /** Increments on every behavior change that should trigger a reaction. */
  reaction: { kind: "task_started" | "tool_started" | "celebrate" | "flinch"; at: number } | null;
  /** False when the adapter could not subscribe to the agent events. */
  connected: boolean;
  connectionError: string | null;
}

export const INITIAL_COMPANION_STATE: CompanionState = {
  behavior: "idle",
  agentStatus: null,
  taskId: null,
  task: null,
  activity: null,
  tool: null,
  recent: [],
  lastResult: null,
  reaction: null,
  connected: false,
  connectionError: null,
};

export const useCompanionStore = create<CompanionState>(() => ({ ...INITIAL_COMPANION_STATE }));
