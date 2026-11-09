import { toVinnieError } from "@/lib/errors";
import { classifyErrorKind, recoveryHint } from "./runtime/recovery";
import { toolFailure, type ToolDefinition, type ToolRegistry, type ToolResult, type VinnieTool } from "./types";

const MAX_SUMMARY_CHARS = 40_000;

function clip(text: string): string {
  if (text.length <= MAX_SUMMARY_CHARS) return text;
  return `${text.slice(0, MAX_SUMMARY_CHARS)}\n… (output truncated to ${MAX_SUMMARY_CHARS} characters)`;
}

/** Parse arguments that a model may send as an object or a JSON string. */
export function normalizeArguments(raw: unknown): unknown {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return {};
    try {
      return JSON.parse(trimmed);
    } catch {
      return raw;
    }
  }
  return raw ?? {};
}

export function createToolRegistry(): ToolRegistry {
  const tools = new Map<string, VinnieTool>();
  const listeners = new Set<() => void>();
  let enabledCheck: (settingsKey: string) => boolean = () => true;
  const keyOf = (t: VinnieTool) => t.settingsKey ?? t.name;
  const notify = () => {
    for (const l of listeners) {
      try {
        l();
      } catch {
        /* listeners must not break registration */
      }
    }
  };

  return {
    register(tool) {
      if (!/^[a-z][a-z0-9_]{0,63}$/.test(tool.name)) {
        throw new Error(`Invalid tool name "${tool.name}".`);
      }
      if (tools.has(tool.name)) {
        throw new Error(`A tool named "${tool.name}" is already registered.`);
      }
      tools.set(tool.name, tool as VinnieTool);
      notify();
    },
    unregister: (name) => {
      const removed = tools.delete(name);
      if (removed) notify();
      return removed;
    },
    get: (name) => tools.get(name),
    list: (): ToolDefinition[] =>
      [...tools.values()].map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        category: t.category,
        riskLevel: t.riskLevel,
        source: t.source ?? "native",
        settingsKey: keyOf(t),
        displayName: t.displayName ?? t.name,
        serverId: t.serverId,
        permission: t.permission,
        enabled: enabledCheck(keyOf(t)),
        available: t.available ? t.available() : true,
      })),
    setEnabledCheck(check) {
      enabledCheck = check;
      notify();
    },
    isEnabled: (name) => {
      const tool = tools.get(name);
      return !!tool && enabledCheck(keyOf(tool));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    specs: (names) =>
      [...tools.values()]
        .filter((t) => !names || names.includes(t.name))
        .map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.inputSchema },
        })),

    async execute(name, input, context): Promise<ToolResult> {
      const tool = tools.get(name);
      if (!tool) {
        return toolFailure(
          "TOOL_FAILURE",
          `There is no tool named "${name}", so nothing was executed. Available tools: ${[...tools.keys()].join(", ")}.`,
        );
      }
      const args = normalizeArguments(input);
      if (typeof args === "string") {
        return toolFailure("INVALID_ARGUMENT", `The arguments for ${name} are not valid JSON, so nothing was executed.`);
      }
      const parsed = tool.schema.safeParse(args);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
        return toolFailure("INVALID_ARGUMENT", `Invalid input for ${name}: ${issues}. Nothing was executed.`);
      }
      if (!enabledCheck(keyOf(tool))) {
        return toolFailure("PERMISSION_DENIED", `The ${tool.displayName ?? name} tool is disabled in Tools settings, so it was not executed.`, {
          outcome: "denied",
          details: "Do not call it again; use a different approach or ask the user to enable it.",
        });
      }
      if (tool.available && !tool.available()) {
        return toolFailure("NETWORK_FAILURE", `${tool.displayName ?? name} is unavailable because its server is not connected. Nothing was executed.`, {
          details: "Continue without it, or tell the user to reconnect the server in the MCP manager.",
        });
      }
      if (context.signal.aborted) {
        return toolFailure("CANCELLED", "The task was stopped before this tool ran.", { outcome: "cancelled" });
      }
      try {
        const result = await tool.execute(parsed.data, context);
        return { ...result, summary: clip(result.summary) };
      } catch (err) {
        const e = toVinnieError(err);
        const code = classifyErrorKind(e.kind);
        return toolFailure(code, e.message, { details: recoveryHint(code) });
      }
    },
  };
}
