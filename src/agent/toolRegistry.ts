import type { Tool, ToolDefinition, ToolRegistry } from "./types";

/** In-memory tool registry. Starts empty: Phase 1 ships no tools. */
export function createToolRegistry(): ToolRegistry {
  const tools = new Map<string, Tool>();
  return {
    register(tool) {
      if (tools.has(tool.name)) {
        throw new Error(`A tool named "${tool.name}" is already registered.`);
      }
      tools.set(tool.name, tool);
    },
    unregister: (name) => tools.delete(name),
    get: (name) => tools.get(name),
    list: (): ToolDefinition[] =>
      [...tools.values()].map(({ execute: _execute, ...definition }) => definition),
  };
}
