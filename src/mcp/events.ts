// Events from the MCP and skill subsystems (mcp.*, skill.*). Subscribers:
// the activity feed and the integration stores. Payloads carry names and
// counts only, never credentials or tool arguments.

export type IntegrationEventType =
  | "mcp.server_connecting"
  | "mcp.server_connected"
  | "mcp.server_disconnected"
  | "mcp.server_error"
  | "mcp.tool_discovered"
  | "mcp.tool_rejected"
  | "mcp.tool_started"
  | "mcp.tool_completed"
  | "mcp.tool_failed"
  | "skill.discovered"
  | "skill.activated"
  | "skill.deactivated"
  | "skill.loaded"
  | "skill.failed";

export interface IntegrationEvent {
  type: IntegrationEventType;
  /** Short human-readable description. */
  label: string;
  serverId?: string;
  skillId?: string;
  tool?: string;
  /** Extra non-sensitive details (counts, durations, error messages). */
  detail?: string;
  at: number;
}

type Listener = (event: IntegrationEvent) => void;
const listeners = new Set<Listener>();

export function emitIntegrationEvent(event: Omit<IntegrationEvent, "at">): void {
  const full = { ...event, at: Date.now() };
  for (const listener of listeners) {
    try {
      listener(full);
    } catch {
      // A failing subscriber must never break the MCP manager.
    }
  }
}

export function onIntegrationEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
