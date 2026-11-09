// Tool executor: the single path from a model's tool request to execution.
//
//   1. the tool must exist and be offered for this task (mode/intent)
//   2. arguments must be valid JSON and match the schema (registry)
//   3. the same failing call is not repeated without a change (RetryGuard)
//   4. paths, permissions, and the command policy are enforced by the tools
//      and the backend
//   5. execute, time it, and return a structured result with recovery hints
//
// Model output is treated as untrusted input throughout.

import type { ToolCall } from "@/lib/ipc/types";
import { normalizeArguments } from "../toolRegistry";
import { toolFailure, type ToolContext, type ToolRegistry, type ToolResult } from "../types";
import { callSignature, recoveryHint, RetryGuard } from "./recovery";

export interface ExecutionRecord {
  name: string;
  arguments: unknown;
  result: ToolResult;
  durationMs: number;
  /** This call repeats one that failed before. */
  isRetry: boolean;
  /** The call was refused before execution (unknown, unavailable, repeated). */
  refused: boolean;
}

export interface ExecutorHooks {
  onStart(name: string, args: unknown, label: string, category: string | undefined, isRetry: boolean): void;
  onFinish(record: ExecutionRecord): void;
}

export class ToolExecutor {
  readonly guard: RetryGuard;

  constructor(
    private readonly registry: ToolRegistry,
    maxRetries: number,
    private readonly hooks: ExecutorHooks,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.guard = new RetryGuard(maxRetries);
  }

  async execute(call: ToolCall, ctx: ToolContext, allowed: ReadonlySet<string>): Promise<ExecutionRecord> {
    const name = call.function?.name ?? "";
    const args = normalizeArguments(call.function?.arguments);
    const tool = this.registry.get(name);
    const refuse = (result: ToolResult): ExecutionRecord => {
      const record = { name, arguments: args, result, durationMs: 0, isRetry: false, refused: true };
      this.hooks.onFinish(record);
      return record;
    };

    if (!tool) {
      return refuse(
        toolFailure("TOOL_FAILURE", `Vinnie requested an unknown tool: ${name || "(no name)"}. The operation was not executed.`, {
          details: `Available tools: ${[...allowed].join(", ")}.`,
        }),
      );
    }
    if (!allowed.has(name)) {
      return refuse(
        toolFailure("PERMISSION_DENIED", `The ${name} tool is not available for this task (mode or request type), so it was not executed.`, {
          outcome: "denied",
        }),
      );
    }
    const signature = callSignature(name, args);
    const previousFailures = this.guard.failureCount(signature);
    if (!this.guard.allows(signature)) {
      return refuse(
        toolFailure(
          "TOOL_FAILURE",
          `Not executed: this exact ${name} call has already failed ${previousFailures} times. Change your approach instead of repeating it.`,
        ),
      );
    }

    const isRetry = previousFailures > 0;
    let label = `Calling ${name}`;
    try {
      label = tool.describe(args as never);
    } catch {
      /* invalid args: the registry reports them below */
    }
    this.hooks.onStart(name, args, label, tool.category, isRetry);
    const started = this.now();
    let result = await this.registry.execute(name, args, ctx);
    const durationMs = this.now() - started;

    if (result.success) {
      this.guard.recordSuccess(signature);
    } else if (result.outcome !== "cancelled" && result.outcome !== "denied") {
      this.guard.recordFailure(signature);
    }
    if (!result.success && result.error) {
      const hint = result.error.details ?? recoveryHint(result.error.code);
      result = { ...result, summary: `${result.summary}\n\nRecovery: ${hint}` };
    }
    result = { ...result, metadata: { ...result.metadata, durationMs } };
    const record: ExecutionRecord = { name, arguments: args, result, durationMs, isRetry, refused: false };
    this.hooks.onFinish(record);
    return record;
  }
}
