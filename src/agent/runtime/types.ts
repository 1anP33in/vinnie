// Agent task model. A task is one user request worked through by the
// runtime: plan, tool steps, verification, and a result computed by the
// application (never self-declared by the model).

import type { FailureCode } from "./recovery";

export type AgentStatus =
  | "idle"
  | "thinking"
  | "planning"
  | "executing"
  | "waiting_for_permission"
  | "verifying"
  | "paused"
  | "completed"
  | "failed"
  | "stopped"
  | "cancelled";

export const TERMINAL_STATUSES: readonly AgentStatus[] = ["completed", "failed", "stopped", "cancelled"];

export type AgentMode = "ask" | "assist" | "agent";

/** How the runtime classified the request. Questions skip planning and verification. */
export type RequestIntent = "question" | "task";

export type PlanStepStatus = "pending" | "in_progress" | "done" | "skipped";

export interface PlanStep {
  id: string;
  title: string;
  status: PlanStepStatus;
}

export interface AgentPlan {
  steps: PlanStep[];
  /** Set when the user edited the plan; the model is told to follow it. */
  editedByUser: boolean;
  updatedAt: number;
}

export type StepKind =
  | "thinking"
  | "planning"
  | "tool"
  | "permission"
  | "retry"
  | "verification"
  | "note";

export type StepStatus = "running" | "succeeded" | "failed" | "denied" | "cancelled" | "timed_out" | "info";

/** One timeline entry. Each corresponds to a real runtime event. */
export interface AgentStep {
  id: string;
  kind: StepKind;
  title: string;
  status: StepStatus;
  startedAt: number;
  endedAt: number | null;
  /** Tool call details (debug view). */
  tool?: {
    name: string;
    arguments: unknown;
    resultSummary?: string;
    errorCode?: FailureCode;
    exitCode?: number | null;
  };
  details?: string;
}

export interface TaskChange {
  path: string;
  kind: "create" | "modify" | "delete" | "move";
  newPath?: string | null;
  /** Content written (create/modify), used by verification. */
  expectedContent?: string;
  changeId?: number;
}

export type CheckStatus = "passed" | "failed" | "skipped";

export interface VerificationCheck {
  id: string;
  name: string;
  kind: "file" | "config" | "manifest" | "command";
  status: CheckStatus;
  details: string;
  command?: string;
  exitCode?: number | null;
  durationMs?: number;
}

export interface VerificationResult {
  success: boolean;
  checks: VerificationCheck[];
  summary: string;
}

export interface ChangeSummary {
  files: number;
  additions: number;
  deletions: number;
  paths: string[];
}

export interface AgentResult {
  status: "completed" | "failed" | "stopped" | "cancelled";
  /** Why the task ended (e.g. "Maximum iteration limit reached."). */
  reason: string;
  verification: VerificationResult | null;
  changes: ChangeSummary;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  /** Context window requested from the model. */
  contextBudget: number;
  /** Largest prompt sent, in tokens (as reported by the model). */
  peakPromptTokens: number;
}

export interface AgentTask {
  id: string;
  conversationId: string;
  userRequest: string;
  model: string;
  mode: AgentMode;
  intent: RequestIntent;
  status: AgentStatus;
  plan?: AgentPlan;
  steps: AgentStep[];
  memory: string[];
  changes: TaskChange[];
  startedAt: number;
  completedAt?: number;
  iteration: number;
  toolCalls: number;
  retries: number;
  usage: TokenUsage;
  result?: AgentResult;
  /** Accepted by the user after review. */
  accepted?: boolean;
}

export interface AgentLimits {
  maxIterations: number;
  maxToolCalls: number;
  maxRetries: number;
  commandTimeoutSecs: number;
  taskTimeoutMs: number;
  maxChangedFiles: number;
  /** Tokens; 0 = auto. */
  contextBudget: number;
  /** Characters of a single tool result kept in context. */
  maxToolResultChars: number;
}

export const DEFAULT_LIMITS: AgentLimits = {
  maxIterations: 25,
  maxToolCalls: 60,
  maxRetries: 2,
  commandTimeoutSecs: 600,
  taskTimeoutMs: 30 * 60_000,
  maxChangedFiles: 20,
  contextBudget: 0,
  maxToolResultChars: 8_000,
};
