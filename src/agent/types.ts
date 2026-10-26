// The standardized tool interface. Built-in workspace tools implement it
// today; MCP tools (Phase 4) will be adapted to the same shape. Tools never
// bypass the backend: every file, search, and process operation goes through
// commands that enforce workspace boundaries, the command policy, and the
// user's permission settings.

import type { z } from "zod";
import type {
  ChangePreview,
  CommandAssessment,
  FileOperation,
  PermissionSettings,
  ProjectMetadata,
  RunResult,
} from "@/lib/ipc/types";
import type { Services } from "@/services";
import type { ActivityKind } from "@/state/activityStore";
import type { FailureCode } from "./runtime/recovery";
import type { AgentMode, PlanStepStatus } from "./runtime/types";

export type ToolCategory = "READ" | "SEARCH" | "WRITE" | "DELETE" | "EXECUTE" | "DEPENDENCY" | "PROJECT";

/** Safe: no side effects. Moderate: changes files (reversible). High: runs programs or installs. */
export type ToolRiskLevel = "safe" | "moderate" | "high";

export type ToolOutcome = "succeeded" | "failed" | "denied" | "cancelled" | "timed_out";

export interface ToolResult {
  success: boolean;
  outcome: ToolOutcome;
  /** Text given back to the model. */
  summary: string;
  /** Structured data (search matches, run results, ...). */
  output?: unknown;
  error?: { code: FailureCode; message: string; details?: string };
  metadata?: {
    durationMs?: number;
    filesChanged?: string[];
    exitCode?: number | null;
    changeIds?: number[];
  };
}

export function toolSuccess(summary: string, extra: Partial<Pick<ToolResult, "output" | "metadata">> = {}): ToolResult {
  return { success: true, outcome: "succeeded", summary, ...extra };
}

export function toolFailure(
  code: FailureCode,
  message: string,
  extra: { outcome?: Exclude<ToolOutcome, "succeeded">; details?: string; output?: unknown; metadata?: ToolResult["metadata"] } = {},
): ToolResult {
  return {
    success: false,
    outcome: extra.outcome ?? (code === "PERMISSION_DENIED" ? "denied" : code === "CANCELLED" ? "cancelled" : "failed"),
    summary: message,
    error: { code, message, details: extra.details },
    output: extra.output,
    metadata: extra.metadata,
  };
}

/** Scopes a user can grant from an approval card. */
export type PermissionScope = "once" | "task" | "session" | "workspace";

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
  /** How long the approval applies. Defaults to this one action. */
  scope?: PermissionScope;
  /** For ambiguous installs: the package manager the user picked. */
  manager?: string;
}

/** What a gated action needs, as decided by the permission manager. */
export interface Authorization {
  approved: boolean;
  /** The user was asked (vs. allowed by settings or an earlier grant). */
  prompted: boolean;
  scope?: PermissionScope;
  manager?: string;
  /** Why it was refused, if it was. */
  reason?: string;
}

export interface CommandRequest {
  command: string;
  cwd?: string | null;
  timeoutSecs?: number | null;
  approved: boolean;
  remember: boolean;
  reason?: string | null;
}

export interface PlanUpdate {
  steps: { title: string; status?: PlanStepStatus }[];
}

export interface ToolContext {
  /** Groups the changes of one task so they can be reverted together. */
  taskId: string;
  signal: AbortSignal;
  services: Services;
  permissions: PermissionSettings;
  mode: AgentMode;
  workspaceRoot: string;
  /**
   * Decide whether a gated action may run: applies the agent mode, the
   * permission settings, and any scoped grants, and asks the user if needed.
   * The model has no access to this.
   */
  authorize(request: ApprovalRequest, capability: "write" | "delete" | "execute" | "install" | "read"): Promise<Authorization>;
  /** Run a command through the terminal (so output is visible to the user). */
  runCommand(request: CommandRequest): Promise<RunResult>;
  /** Tell the UI which files changed so open editors and the explorer refresh. */
  filesChanged(paths: string[]): void;
  /** Ask for the project to be re-analyzed (e.g. after installing dependencies). */
  projectChanged(): void;
  /** Agent-only hooks (planning and memory). */
  agent?: {
    updatePlan(update: PlanUpdate): void;
    remember(fact: string): void;
    metadata(): ProjectMetadata | null;
  };
}

export interface VinnieTool<Input = unknown> {
  name: string;
  description: string;
  /** JSON schema of the input, as sent to the model. */
  inputSchema: Record<string, unknown>;
  /** Runtime validator for model-provided input. */
  schema: z.ZodType<Input>;
  category: ToolCategory;
  riskLevel: ToolRiskLevel;
  activityKind: ActivityKind;
  /** Short label for the activity feed, e.g. "Reading client/main.lua". */
  describe(input: Input): string;
  execute(input: Input, context: ToolContext): Promise<ToolResult>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  category: ToolCategory;
  riskLevel: ToolRiskLevel;
}

export interface ToolRegistry {
  register<I>(tool: VinnieTool<I>): void;
  unregister(name: string): boolean;
  get(name: string): VinnieTool | undefined;
  list(): ToolDefinition[];
  /** Tool specs in Ollama's function-calling format (optionally a subset). */
  specs(names?: readonly string[]): object[];
  /** Validate input and execute; never throws. */
  execute(name: string, input: unknown, context: ToolContext): Promise<ToolResult>;
}

export type { RunResult };
