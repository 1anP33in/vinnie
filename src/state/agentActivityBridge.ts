// Mirrors agent events into the activity feed. Every entry corresponds to a
// real runtime event (tool start/finish, verification, task start/end).

import { onAgentEvent } from "@/agent/runtime/events";
import { onIntegrationEvent } from "@/mcp/events";
import { useActivityStore, type ActivityKind } from "./activityStore";

const KIND_BY_CATEGORY: Record<string, ActivityKind> = {
  READ: "read",
  SEARCH: "search",
  PROJECT: "model",
  WRITE: "write",
  DELETE: "write",
  EXECUTE: "command",
  DEPENDENCY: "install",
  EXTERNAL: "mcp",
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

let integrationsInstalled = false;

/**
 * Mirror MCP and skill events into the activity feed. Tool calls already
 * appear through the agent events, so only connection and skill events are
 * added here.
 */
export function bridgeIntegrationEventsToActivity(): void {
  if (integrationsInstalled) return;
  integrationsInstalled = true;
  const connecting = new Map<string, string>(); // server id -> activity id
  const activity = () => useActivityStore.getState();
  const instant = (kind: ActivityKind, title: string, status: "success" | "error", details?: string) => {
    activity().finish(activity().start(kind, title), status, details ?? null);
  };

  onIntegrationEvent((e) => {
    switch (e.type) {
      case "mcp.server_connecting":
        if (e.serverId) connecting.set(e.serverId, activity().start("mcp", e.label));
        break;
      case "mcp.server_connected":
      case "mcp.server_error": {
        const id = e.serverId ? connecting.get(e.serverId) : undefined;
        const status = e.type === "mcp.server_connected" ? "success" : "error";
        if (id) activity().finish(id, status, e.detail ?? e.label);
        else instant("mcp", e.label, status, e.detail);
        if (e.serverId) connecting.delete(e.serverId);
        break;
      }
      case "mcp.server_disconnected":
        instant("mcp", e.label, "success");
        break;
      case "mcp.tool_rejected":
        instant("mcp", e.label, "error", e.detail);
        break;
      case "skill.activated":
      case "skill.deactivated":
        instant("skill", e.label, "success", e.detail);
        break;
      case "skill.failed":
        instant("skill", e.label, "error", e.detail);
        break;
      default:
        break;
    }
  });
}
