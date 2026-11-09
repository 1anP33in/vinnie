// Per-tool settings: enabled switch, approval policy (MCP tools), and usage
// stats. The registry consults `isEnabled` before executing anything, so a
// disabled tool can never run, whoever asks for it.

import { create } from "zustand";
import { onAgentEvent } from "@/agent/runtime/events";
import type { McpServerConfig, ToolPolicy, ToolSetting } from "@/lib/ipc/types";
import { getServices } from "@/services";

interface ToolSettingsState {
  settings: Record<string, ToolSetting>;
  loaded: boolean;
  load(): Promise<void>;
  isEnabled(key: string): boolean;
  setEnabled(key: string, enabled: boolean): Promise<void>;
  /** null resets to the default. */
  setPolicy(key: string, policy: ToolPolicy | null): Promise<void>;
  /** Effective policy of an MCP tool: its own setting, else the server's default. */
  policyFor(config: McpServerConfig, toolName: string): ToolPolicy;
}

function defaults(key: string): ToolSetting {
  return { key, enabled: true, policy: null, runCount: 0, lastRunAt: null, lastOutcome: null };
}

export const useToolSettingsStore = create<ToolSettingsState>((set, get) => ({
  settings: {},
  loaded: false,

  async load() {
    try {
      const list = await getServices().toolSettings.list();
      set({ settings: Object.fromEntries(list.map((s) => [s.key, s])), loaded: true });
    } catch {
      set({ loaded: true });
    }
    getServices().tools.setEnabledCheck((key) => get().isEnabled(key));
  },

  isEnabled: (key) => get().settings[key]?.enabled ?? true,

  async setEnabled(key, enabled) {
    const current = get().settings[key] ?? defaults(key);
    set((s) => ({ settings: { ...s.settings, [key]: { ...current, enabled } } }));
    getServices().tools.setEnabledCheck((k) => get().isEnabled(k));
    try {
      const saved = await getServices().toolSettings.save({ key, enabled, policy: current.policy });
      set((s) => ({ settings: { ...s.settings, [key]: saved } }));
    } catch {
      // Keep the in-memory choice: disabling must take effect even if saving failed.
    }
  },

  async setPolicy(key, policy) {
    const current = get().settings[key] ?? defaults(key);
    set((s) => ({ settings: { ...s.settings, [key]: { ...current, policy } } }));
    try {
      const saved = await getServices().toolSettings.save({ key, enabled: current.enabled, policy });
      set((s) => ({ settings: { ...s.settings, [key]: saved } }));
    } catch {
      /* in-memory value still applies */
    }
  },

  policyFor(config, toolName) {
    return get().settings[`mcp:${config.id}:${toolName}`]?.policy ?? config.defaultPolicy;
  },
}));

let bridged = false;

/** Count tool runs (from real runtime events) for the Tool Explorer. */
export function bridgeToolUsage(): void {
  if (bridged) return;
  bridged = true;
  onAgentEvent((e) => {
    if (e.type !== "agent.tool_completed" && e.type !== "agent.tool_failed") return;
    const name = typeof e.data?.tool === "string" ? e.data.tool : null;
    const tool = name ? getServices().tools.get(name) : undefined;
    if (!tool) return;
    const key = tool.settingsKey ?? tool.name;
    const outcome = String(e.data?.outcome ?? (e.type === "agent.tool_completed" ? "succeeded" : "failed"));
    useToolSettingsStore.setState((s) => {
      const current = s.settings[key] ?? defaults(key);
      return {
        settings: {
          ...s.settings,
          [key]: { ...current, runCount: current.runCount + 1, lastRunAt: Date.now(), lastOutcome: outcome },
        },
      };
    });
    void getServices().toolSettings.recordRun(key, outcome).catch(() => {});
  });
}
