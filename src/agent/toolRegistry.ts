import { toVinnieError } from "@/lib/errors";
import type { ToolDefinition, ToolRegistry, ToolResult, VinnieTool } from "./types";

const MAX_RESULT_CHARS = 40_000;

function clip(text: string): string {
  if (text.length <= MAX_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_RESULT_CHARS)}\n… (output truncated to ${MAX_RESULT_CHARS} characters)`;
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

  return {
    register(tool) {
      if (!/^[a-z][a-z0-9_]{0,63}$/.test(tool.name)) {
        throw new Error(`Invalid tool name "${tool.name}".`);
      }
      if (tools.has(tool.name)) {
        throw new Error(`A tool named "${tool.name}" is already registered.`);
      }
      tools.set(tool.name, tool as VinnieTool);
    },
    unregister: (name) => tools.delete(name),
    get: (name) => tools.get(name),
    list: (): ToolDefinition[] =>
      [...tools.values()].map(({ name, description, inputSchema, capability }) => ({
        name,
        description,
        inputSchema,
        capability,
      })),
    specs: () =>
      [...tools.values()].map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      })),

    async execute(name, input, context): Promise<ToolResult> {
      const tool = tools.get(name);
      if (!tool) {
        return {
          ok: false,
          kind: "unknown_tool",
          error: `There is no tool named "${name}". Available tools: ${[...tools.keys()].join(", ")}.`,
        };
      }
      const parsed = tool.schema.safeParse(normalizeArguments(input));
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
          .join("; ");
        return { ok: false, kind: "invalid_input", error: `Invalid input for ${name}: ${issues}` };
      }
      if (context.signal.aborted) {
        return { ok: false, kind: "denied", error: "The user stopped this request." };
      }
      try {
        const result = await tool.execute(parsed.data, context);
        return result.ok ? { ok: true, content: clip(result.content) } : result;
      } catch (err) {
        const e = toVinnieError(err);
        return { ok: false, kind: e.kind, error: e.message };
      }
    },
  };
}
