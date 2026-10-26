// Mirrors agent events into the activity feed. Every entry corresponds to a
// real runtime event (tool start/finish, verification, task start/end).

import { onAgentEvent } from "@/agent/runtime/events";
import { useActivityStore, type ActivityKind } from "./activityStore";

const KIND_BY_CATEGORY: Record<string, ActivityKind> = {
  READ: "read",
  SEARCH: "search",
  PROJECT: "model",
  WRITE: "write",
  DELETE: "write",
  EXECUTE: "command",
  DEPENDENCY: "install",
};

let installed = false;

export function bridgeAgentEventsToActivity(): void {
  if (installed) return;
  installed = true;
  const open = new Map<string, string>(); // step id or key -> activity id
  const activity = () => useActivityStore.getState();

  onAgentEvent((e) => {
    const stepId = typeof e.data?.stepId === "string" ? e.data.stepId : null;
    switch (e.type) {
      case "agent.started":
        open.set(`task:${e.taskId}`, activity().start("model", `Task: ${e.task.userRequest.slice(0, 80)}`));
        break;
      case "agent.tool_started":
        if (stepId) open.set(stepId, activity().start(KIND_BY_CATEGORY[String(e.data?.category)] ?? "model", e.label));
        break;
      case "agent.tool_completed":
      case "agent.tool_failed": {
        const id = stepId ? open.get(stepId) : undefined;
        const outcome = String(e.data?.outcome ?? "");
        const status =
          e.type === "agent.tool_completed" ? "success" : outcome === "denied" ? "denied" : outcome === "cancelled" ? "cancelled" : "error";
        if (id) {
          activity().finish(id, status, String(e.data?.summary ?? ""));
          open.delete(stepId!);
        } else {
          // Refused before running (unknown tool, invalid input, repeated failure).
          const refused = activity().start("error", e.label);
          activity().finish(refused, "error", String(e.data?.summary ?? ""));
        }
        break;
      }
      case "agent.verifying":
        open.set(`verify:${e.taskId}`, activity().start("command", "Verifying changes"));
        break;
      case "agent.verification_passed":
      case "agent.verification_failed": {
        const id = open.get(`verify:${e.taskId}`);
        if (id) activity().finish(id, e.type === "agent.verification_passed" ? "success" : "error", e.label);
        open.delete(`verify:${e.taskId}`);
        break;
      }
      case "agent.completed":
      case "agent.failed":
      case "agent.stopped":
      case "agent.cancelled": {
        const id = open.get(`task:${e.taskId}`);
        const status = e.type === "agent.completed" ? "success" : e.type === "agent.cancelled" ? "cancelled" : "error";
        if (id) activity().finish(id, status, e.label);
        open.delete(`task:${e.taskId}`);
        break;
      }
      default:
        break;
    }
  });
}
