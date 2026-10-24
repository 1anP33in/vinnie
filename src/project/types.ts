import type { ProjectInfo, ProjectStatus } from "@/lib/ipc/types";

export type { ProjectInfo, ProjectStatus };

/**
 * Selects and restores the active project folder.
 *
 * Phase 1 only tracks which folder is active. Phase 2 will add a
 * `WorkspaceProvider` (below) for indexing and file access; it will consume
 * the active project from here rather than replacing this interface.
 */
export interface ProjectProvider {
  /** The saved project, with its current availability. */
  getActive(): Promise<ProjectInfo | null>;
  /** Show the native folder picker. Resolves `null` when cancelled. */
  pickFolder(): Promise<ProjectInfo | null>;
  clear(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Phase 2 extension points (types only; intentionally not implemented).
// ---------------------------------------------------------------------------

export interface WorkspaceFileEntry {
  /** Path relative to the project root. */
  path: string;
  kind: "file" | "directory";
  sizeBytes?: number;
}

/** Context about the workspace that can be attached to a model request. */
export interface WorkspaceContext {
  root: ProjectInfo;
  files: WorkspaceFileEntry[];
}

/**
 * Workspace-aware operations planned for Phase 2. Every method will run in
 * the Rust backend, scoped to the active project root, behind explicit user
 * permissions.
 */
export interface WorkspaceProvider {
  index(signal?: AbortSignal): Promise<WorkspaceContext>;
  readFile(relativePath: string): Promise<string>;
  proposeEdit(relativePath: string, newContent: string): Promise<{ diff: string }>;
}
