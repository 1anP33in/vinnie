// React binding for the MCP manager (one per app session).

import { useSyncExternalStore } from "react";
import { McpManager, type McpServerState } from "@/mcp/manager";
import { getServices } from "@/services";
import { useToolSettingsStore } from "./toolSettingsStore";

let manager: McpManager | null = null;

export function getMcpManager(): McpManager {
  manager ??= new McpManager({
    mcp: () => getServices().mcp,
    registry: () => getServices().tools,
    policyFor: (config, tool) => useToolSettingsStore.getState().policyFor(config, tool),
  });
  return manager;
}

/** Tests: start from a fresh manager. */
export function resetMcpManager(next?: McpManager): void {
  void manager?.shutdown();
  manager = next ?? null;
}

export function useMcpServers(): McpServerState[] {
  const m = getMcpManager();
  return useSyncExternalStore(
    (cb) => m.subscribe(cb),
    () => m.snapshot(),
  );
}
