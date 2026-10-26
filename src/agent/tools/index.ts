import type { ToolRegistry, VinnieTool } from "../types";
import { getProjectInfo, remember, updatePlan } from "./agentTools";
import { installDependency, runCommand } from "./commandTools";
import { createFile, deleteFile, moveFile, writeFile } from "./fileTools";
import { getProjectStructure, readFile, searchFiles } from "./readTools";

export const WORKSPACE_TOOLS: readonly VinnieTool[] = [
  getProjectStructure,
  searchFiles,
  readFile,
  createFile,
  writeFile,
  deleteFile,
  moveFile,
  runCommand,
  installDependency,
];

/** Tools that only affect the agent's own state (plan, memory, facts). */
export const AGENT_TOOLS: readonly VinnieTool[] = [updatePlan, remember, getProjectInfo];

/** Register all built-in tools (idempotent). */
export function registerWorkspaceTools(registry: ToolRegistry): void {
  for (const tool of [...WORKSPACE_TOOLS, ...AGENT_TOOLS]) {
    if (!registry.get(tool.name)) registry.register(tool);
  }
}
