import type { ToolRegistry, VinnieTool } from "../types";
import { runCommand, installDependency } from "./commandTools";
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

/** Register the Phase 2 workspace tools (idempotent). */
export function registerWorkspaceTools(registry: ToolRegistry): void {
  for (const tool of WORKSPACE_TOOLS) {
    if (!registry.get(tool.name)) registry.register(tool);
  }
}
