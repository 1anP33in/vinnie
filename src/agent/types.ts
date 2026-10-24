// The standardized tool interface. Built-in workspace tools implement it
// today; MCP tools (Phase 4) will be adapted to the same shape. Tools never
// bypass the backend: every file, search, and process operation goes through
// commands that enforce workspace boundaries, the command policy, and the
// user's permission settings.

import type { z } from "zod";
import type { ErrorKind } from "@/lib/errors";
import type {
  ChangePreview,
  CommandAssessment,
  FileOperation,
  PermissionSettings,
  RunResult,
} from "@/lib/ipc/types";
import type { Services } from "@/services";
import type { ActivityKind } from "@/state/activityStore";

export type ToolCapability = "read" | "write" | "execute" | "install";

export type ToolResult =
  | { ok: true; content: string }
  | { ok: false; error: string; kind?: ErrorKind | "denied" | "invalid_input" | "unknown_tool" };

/** A request shown to the user before a gated action runs. */
export type ApprovalRequest =
  | {
      kind: "command";
      command: string;
      workspace: string;
      cwd: string | null;
      reason: string | null;
      assessment: CommandAssessment;
      install?: {
        manager: string;
        packages: string[];
        candidates: string[];
        ambiguous: boolean;
        detectionReason: string;
      };
    }
  | { kind: "file"; operation: FileOperation; preview: ChangePreview; reason: string | null; workspace: string }
  | { kind: "read"; path: string; reason: string | null; workspace: string };

export interface ApprovalDecision {
  approved: boolean;
  /** "Always allow" this exact command in this workspace. */
  remember?: boolean;
  /** For ambiguous installs: the package manager the user picked. */
  manager?: string;
}

export interface CommandRequest {
  command: string;
  cwd?: string | null;
  timeoutSecs?: number | null;
  approved: boolean;
  remember: boolean;
  reason?: string | null;
}

export interface ToolContext {
  /** Groups the changes of one assistant turn so they can be reverted together. */
  taskId: string;
  signal: AbortSignal;
  services: Services;
  permissions: PermissionSettings;
  workspaceRoot: string;
  requestApproval(request: ApprovalRequest): Promise<ApprovalDecision>;
  /** Run a command through the terminal (so output is visible to the user). */
  runCommand(request: CommandRequest): Promise<RunResult>;
  /** Tell the UI which files changed so open editors and the explorer refresh. */
  filesChanged(paths: string[]): void;
  /** Ask for the project to be re-analyzed (e.g. after installing dependencies). */
  projectChanged(): void;
}

export interface VinnieTool<Input = unknown> {
  name: string;
  description: string;
  /** JSON schema of the input, as sent to the model. */
  inputSchema: Record<string, unknown>;
  /** Runtime validator for model-provided input. */
  schema: z.ZodType<Input>;
  capability: ToolCapability;
  activityKind: ActivityKind;
  /** Short label for the activity feed, e.g. "Reading client/main.lua". */
  describe(input: Input): string;
  execute(input: Input, context: ToolContext): Promise<ToolResult>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  capability: ToolCapability;
}

export interface ToolRegistry {
  register<I>(tool: VinnieTool<I>): void;
  unregister(name: string): boolean;
  get(name: string): VinnieTool | undefined;
  list(): ToolDefinition[];
  /** Tool specs in Ollama's function-calling format. */
  specs(): object[];
  /** Validate input and execute; never throws. */
  execute(name: string, input: unknown, context: ToolContext): Promise<ToolResult>;
}

export type { RunResult };
