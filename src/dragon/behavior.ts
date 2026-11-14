// Dragon behaviors: what the 3D dragon is doing, derived only from the agent
// runtime's own task status. Nothing here invents activity.

import type { AgentStatus } from "@/agent/runtime/types";

export type DragonBehavior =
  | "idle"
  | "thinking"
  | "planning"
  | "executing"
  | "waiting"
  | "verifying"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export const BEHAVIOR_LABEL: Record<DragonBehavior, string> = {
  idle: "Idle",
  thinking: "Thinking",
  planning: "Planning",
  executing: "Executing",
  waiting: "Waiting for permission",
  verifying: "Verifying",
  paused: "Paused",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** The runtime's task status is the single source of truth for the dragon. */
export function behaviorForStatus(status: AgentStatus): DragonBehavior {
  switch (status) {
    case "thinking":
      return "thinking";
    case "planning":
      return "planning";
    case "executing":
      return "executing";
    case "waiting_for_permission":
      return "waiting";
    case "verifying":
      return "verifying";
    case "paused":
      return "paused";
    case "completed":
      return "completed";
    // "stopped" means a limit ended the task (iterations, time, tool calls).
    case "failed":
    case "stopped":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "idle":
    default:
      return "idle";
  }
}

export const TERMINAL_BEHAVIORS: readonly DragonBehavior[] = ["completed", "failed", "cancelled"];

/** How long a finished task's posture is held before the dragon rests again. */
export const TERMINAL_HOLD_MS: Partial<Record<DragonBehavior, number>> = {
  completed: 6_000,
  failed: 10_000,
  cancelled: 3_000,
};

/** Plain description of a tool category (from the tool registry). */
export function activityForCategory(category: unknown): string {
  switch (category) {
    case "READ":
      return "Reading files";
    case "SEARCH":
      return "Searching the project";
    case "PROJECT":
      return "Inspecting the project";
    case "WRITE":
      return "Editing files";
    case "DELETE":
      return "Deleting files";
    case "EXECUTE":
      return "Running a command";
    case "DEPENDENCY":
      return "Installing dependencies";
    case "EXTERNAL":
      return "Using an external (MCP) tool";
    default:
      return "Using a tool";
  }
}
