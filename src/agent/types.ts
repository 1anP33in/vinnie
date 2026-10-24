// Extension points for the future agent (Phases 2–5). Nothing here executes
// tools in Phase 1; the registry is real but empty, and the UI never shows
// tools, MCP servers, or agent activity that does not exist.

/** JSON-schema-like description of a tool's parameters. */
export interface ToolParameterSchema {
  type: "object";
  properties: Record<string, { type: string; description?: string }>;
  required?: string[];
}

export type ToolPermission = "read-project" | "write-project" | "run-command" | "network";

export interface ToolDefinition {
  /** Unique, stable name, e.g. `fs.read_file` or `mcp.<server>.<tool>`. */
  name: string;
  description: string;
  parameters: ToolParameterSchema;
  /** Permissions the user must grant before the tool may run (Phase 3). */
  permissions: ToolPermission[];
  /** Where the tool comes from: built-in or an MCP server (Phase 4). */
  source: { kind: "native" } | { kind: "mcp"; server: string };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type ToolResult = { ok: true; output: string } | { ok: false; error: string };

export interface Tool extends ToolDefinition {
  execute(args: Record<string, unknown>, signal: AbortSignal): Promise<ToolResult>;
}

export interface ToolRegistry {
  register(tool: Tool): void;
  unregister(name: string): boolean;
  get(name: string): Tool | undefined;
  list(): ToolDefinition[];
}

/**
 * Events the agent will emit (Phase 3). The ice dragon viewer (Phase 5)
 * subscribes to these so its animations reflect real activity only.
 */
export type AgentEvent =
  | { type: "idle" }
  | { type: "thinking"; requestId: string }
  | { type: "responding"; requestId: string }
  | { type: "tool-started"; call: ToolCall }
  | { type: "tool-finished"; call: ToolCall; result: ToolResult }
  | { type: "error"; message: string };
