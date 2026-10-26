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
      [...tools.values()].map(({ name, description, inputSchema, category, riskLevel }) => ({
        name,
        description,
        inputSchema,
        category,
        riskLevel,
      })),
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
