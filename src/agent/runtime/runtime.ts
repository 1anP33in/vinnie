// AgentRuntime: the controlled agent loop.
//
//   observe → ask the model for the next action → validate → authorize →
//   execute → record → feed the result back → repeat
//
// The loop stops on completion, cancellation, a hard limit (iterations, tool
// calls, time, changed files), or an unrecoverable error. The model decides
// what to do; this class decides what is allowed, runs it, verifies the
// result, and computes the task's outcome (the model cannot declare success).

import { toVinnieError, VinnieError } from "@/lib/errors";
import type { ChangeRecord, ChatTurn, NewMessage, ProjectMetadata, RunResult, Settings, ToolCall } from "@/lib/ipc/types";
import type { AIProvider, GenerationHandle, GenerationOutcome } from "@/providers/types";
import type { Services } from "@/services";
import type { ProjectContextInput } from "../context";
import { describesToolCalls, extractTextToolCalls } from "../textToolCalls";
import type { ApprovalDecision, ApprovalRequest, CommandRequest, ToolContext, ToolRegistry, ToolResult } from "../types";
import { buildContext } from "./contextManager";
import { emitAgentEvent, type AgentEventType } from "./events";
import { TaskMemory } from "./memory";
import type { PermissionManager } from "./permissionManager";
import { applyPlanUpdate, classifyIntent, editPlanStep, removePlanStep, renderPlan, selectTools } from "./planner";
import { isTransientModelError } from "./recovery";
import { buildAgentSystemPrompt } from "./systemPrompt";
import { resolveContextBudget } from "./tokens";
import { ToolExecutor, type ExecutionRecord } from "./toolExecutor";
import {
  TERMINAL_STATUSES,
  type AgentLimits,
  type AgentMode,
  type AgentResult,
  type AgentStatus,
  type AgentStep,
  type AgentTask,
  type ChangeSummary,
  type StepKind,
  type StepStatus,
  type VerificationResult,
} from "./types";
import { describeVerificationFailure, VerificationEngine } from "./verification";

export interface StreamSink {
  reset(): void;
  started(): void;
  content(text: string): void;
  thinking(text: string): void;
}

export interface RuntimeDeps {
  provider: AIProvider;
  registry: ToolRegistry;
  services: Services;
  permissions: PermissionManager;
  settings(): Settings;
  /** Show an approval card and wait for the user's decision. */
  prompt(request: ApprovalRequest, signal: AbortSignal): Promise<ApprovalDecision>;
  runCommand(request: CommandRequest): Promise<RunResult>;
  /** Stop commands this task started (on cancel). */
  stopCommands(): void;
  filesChanged(paths: string[]): void;
  projectChanged(): void;
  metadata(): ProjectMetadata | null;
  refreshMetadata(): Promise<ProjectMetadata | null>;
  /** Save a message to the conversation (and show it). */
  persist(message: NewMessage): Promise<void>;
  stream: StreamSink;
  modelContextLength(model: string): Promise<number | null>;
  onUpdate(task: AgentTask): void;
  /** Shown to the user, e.g. "this model can't use tools". */
  notice(text: string): void;
  now?(): number;
  sleep?(ms: number): Promise<void>;
}

export interface RunInput {
  conversationId: string;
  request: string;
  model: string;
  /** Conversation before this request, as model turns. */
  history: ChatTurn[];
  project: ProjectContextInput | null;
  workspaceRoot: string | null;
  mode: AgentMode;
  limits: AgentLimits;
  autoVerify: boolean;
  toolsEnabled: boolean;
}

class StopTask extends Error {
  constructor(
    readonly status: "stopped" | "failed",
    readonly reason: string,
  ) {
    super(reason);
  }
}

let stepCounter = 0;

export class AgentRuntime {
  readonly task: AgentTask;
  private readonly controller = new AbortController();
  private readonly memory = new TaskMemory();
  private readonly executor: ToolExecutor;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private paused = false;
  private statusBeforePause: AgentStatus = "thinking";
  private resumeWaiters: (() => void)[] = [];
  private handle: GenerationHandle | null = null;
  private taskTurns: ChatTurn[] = [];
  private toolsOn: boolean;
  /** The last model failure, if the task ended because of one. */
  modelError: VinnieError | null = null;
  private budget = 8_192;
  private effectiveBudget = 8_192;

  constructor(
    private readonly deps: RuntimeDeps,
    private readonly input: RunInput,
  ) {
    this.now = deps.now ?? (() => Date.now());
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.toolsOn = input.toolsEnabled && input.workspaceRoot !== null && deps.registry.list().length > 0;
    this.task = {
      id: crypto.randomUUID(),
      conversationId: input.conversationId,
      userRequest: input.request,
      model: input.model,
      mode: input.mode,
      intent: classifyIntent(input.request),
      status: "idle",
      steps: [],
      memory: [],
      changes: [],
      startedAt: this.now(),
      iteration: 0,
      toolCalls: 0,
      retries: 0,
      usage: { promptTokens: 0, completionTokens: 0, contextBudget: 0, peakPromptTokens: 0 },
    };
    this.executor = new ToolExecutor(
      deps.registry,
      input.limits.maxRetries,
      {
        onStart: (name, args, label, category, isRetry) => {
          if (isRetry) {
            this.task.retries += 1;
            this.emit("agent.retrying", `Retrying ${name}`);
          }
          const stepId = this.addStep("tool", label, "running", { tool: { name, arguments: args } });
          this.emit("agent.tool_started", label, { tool: name, category, stepId });
        },
        onFinish: (record) => this.finishToolStep(record),
      },
      this.now,
    );
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  // ---- control ---------------------------------------------------------------

  pause(): void {
    if (this.paused || this.isFinished()) return;
    this.paused = true;
    this.statusBeforePause = this.task.status;
    this.setStatus("paused");
    this.addStep("note", "Paused by the user", "info");
    this.emit("agent.paused", "Paused");
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.setStatus(this.statusBeforePause);
    this.addStep("note", "Resumed", "info");
    this.emit("agent.resumed", "Resumed");
    for (const r of this.resumeWaiters.splice(0)) r();
  }

  cancel(): void {
    if (this.controller.signal.aborted || this.isFinished()) return;
    this.controller.abort();
    for (const r of this.resumeWaiters.splice(0)) r();
    void this.handle?.cancel();
    this.deps.stopCommands();
  }

  editPlanStep(id: string, title: string): void {
    if (!this.task.plan) return;
    this.task.plan = editPlanStep(this.task.plan, id, title);
    this.emit("agent.plan_updated", "Plan edited by the user");
  }

  removePlanStep(id: string): void {
    if (!this.task.plan) return;
    this.task.plan = removePlanStep(this.task.plan, id);
    this.emit("agent.plan_updated", "Plan edited by the user");
  }

  // ---- loop ------------------------------------------------------------------

  async run(): Promise<AgentTask> {
    const { limits } = this.input;
    const deadline = this.task.startedAt + limits.taskTimeoutMs;
    this.setStatus(this.task.intent === "task" && this.toolsOn ? "planning" : "thinking");
    this.emit("agent.started", "Task started");
    this.budget = resolveContextBudget(limits.contextBudget, await this.deps.modelContextLength(this.input.model).catch(() => null));
    this.effectiveBudget = this.budget;
    this.task.usage.contextBudget = this.budget;

    let verification: VerificationResult | null = null;
    let verifyAttempts = 0;
    let textCallNudges = 0;
    let continueNudges = 0;
    let finalStatus: AgentResult["status"] = "completed";
    let reason = "";

    try {
      for (;;) {
        await this.gate();
        this.throwIfCancelled();
        if (this.task.iteration >= limits.maxIterations) throw new StopTask("stopped", "Maximum iteration limit reached.");
        if (this.now() > deadline) throw new StopTask("stopped", "Maximum task duration reached.");
        this.task.iteration += 1;
        const planning = this.task.intent === "task" && this.toolsOn && !this.task.plan && this.task.iteration === 1;
        this.setStatus(planning ? "planning" : "thinking");
        this.emit(planning ? "agent.planning" : "agent.thinking", planning ? "Planning" : `${this.input.model} is thinking`);

        const toolNames = this.toolsOn
          ? selectTools(this.deps.registry.list(), this.input.mode, this.task.intent)
          : [];
        const outcome = await this.callModel(toolNames);
        this.throwIfCancelled();

        let content = outcome.content;
        let calls: ToolCall[] = this.toolsOn ? outcome.toolCalls : [];
        if (this.toolsOn && calls.length === 0) {
          const recovered = extractTextToolCalls(content, new Set(this.deps.registry.list().map((t) => t.name)));
          if (recovered.length) {
            calls = recovered;
            content = "";
          }
        }
        await this.deps.persist({
          conversationId: this.input.conversationId,
          role: "assistant",
          content,
          thinking: outcome.thinking.trim() ? outcome.thinking : null,
          status: "complete",
          model: this.input.model,
          toolCalls: calls.length ? calls : null,
        });

        if (calls.length === 0 && this.toolsOn && textCallNudges < limits.maxRetries) {
          const names = new Set(this.deps.registry.list().map((t) => t.name));
          if (describesToolCalls(content, names)) {
            // The model wrote tool calls as text inside its answer. They did not run; say so.
            textCallNudges += 1;
            this.task.retries += 1;
            this.addStep("retry", "Tool calls written as text were not executed; asking the model to call them", "info");
            this.emit("agent.retrying", "Asking the model to use real tool calls");
            this.taskTurns.push({ role: "assistant", content });
            this.taskTurns.push({
              role: "user",
              content:
                "None of the tool calls you wrote as JSON text were executed, and no files were changed. Use the tool-calling interface to call tools, one step at a time (for example, read_file first, then write_file with the complete new content).",
            });
            continue;
          }
        }

        const unfinished = this.unfinishedPlanSteps();
        if (
          calls.length === 0 &&
          this.toolsOn &&
          this.task.intent === "task" &&
          (this.task.changes.length === 0 || unfinished.length > 0) &&
          this.input.mode !== "ask" &&
          continueNudges < 1 &&
          !this.task.steps.some((s) => s.status === "denied")
        ) {
          // A task that ends with nothing changed, or with its own plan unfinished, is
          // usually a model that stopped early. Say so once; it may also be genuinely done.
          continueNudges += 1;
          const next = unfinished[0];
          this.addStep("note", "Task looks unfinished; asking the model to continue or explain", "info");
          this.taskTurns.push({ role: "assistant", content });
          this.taskTurns.push({
            role: "user",
            content:
              this.task.changes.length === 0
                ? `No files have been changed yet${next ? ` and your plan's next step is "${next}"` : ""}. If the request needs changes, make them now by calling the tools (for example write_file with the complete new file content). If no change is needed, say so and explain why.`
                : `These plan steps are not marked done: ${unfinished.map((t) => `"${t}"`).join(", ")}. Do them now with the tools, or call update_plan to mark them done or skipped, and say why.`,
          });
          continue;
        }

        if (calls.length === 0) {
          // The model considers itself done. Verify independently.
          if (this.task.changes.length > 0 && this.input.autoVerify) {
            verification = await this.verify();
            this.throwIfCancelled();
            if (verification.success) break;
            if (verifyAttempts >= limits.maxRetries) {
              throw new StopTask("failed", `Verification still failed after ${verifyAttempts + 1} attempt(s).`);
            }
            verifyAttempts += 1;
            this.task.retries += 1;
            this.emit("agent.retrying", "Repairing after failed verification");
            this.addStep("retry", "Investigating verification failure", "info", {
              details: describeVerificationFailure(verification),
            });
            this.taskTurns.push({ role: "assistant", content });
            this.taskTurns.push({ role: "user", content: describeVerificationFailure(verification) });
            continue;
          }
          break;
        }

        this.taskTurns.push({ role: "assistant", content, tool_calls: calls });
        this.setStatus("executing");
        const allowed = new Set(toolNames);
        for (const call of calls) {
          await this.gate();
          if (this.signal.aborted) {
            this.pushToolResult(call.function?.name ?? "tool", "Not executed: the task was cancelled.");
            continue;
          }
          if (this.task.toolCalls >= limits.maxToolCalls) {
            throw new StopTask("stopped", "Maximum tool call limit reached.");
          }
          this.task.toolCalls += 1;
          this.emit("agent.tool_requested", `Requested ${call.function?.name ?? "a tool"}`, { tool: call.function?.name });
          const record = await this.executor.execute(call, this.toolContext(), allowed);
          this.afterTool(record);
          this.pushToolResult(record.name, record.result.summary);
          await this.deps.persist({
            conversationId: this.input.conversationId,
            role: "tool",
            content: record.result.success ? record.result.summary : `Error: ${record.result.summary}`,
            toolName: /^[A-Za-z0-9_]{1,64}$/.test(record.name) ? record.name : null,
            status: "complete",
          });
          const distinct = new Set(this.task.changes.map((c) => c.newPath ?? c.path)).size;
          if (distinct > limits.maxChangedFiles) {
            throw new StopTask("stopped", `Maximum changed files limit (${limits.maxChangedFiles}) reached.`);
          }
        }
        this.throwIfCancelled();
      }
      reason =
        this.task.changes.length === 0
          ? this.task.intent === "question"
            ? "Answered."
            : "No files were changed."
          : verification
            ? "Changes made and verified."
            : this.input.autoVerify
              ? "Changes made."
              : "Changes made (automatic verification is turned off).";
      const unfinished = this.unfinishedPlanSteps();
      if (this.task.intent === "task" && unfinished.length > 0) {
        reason += ` Plan steps not marked done: ${unfinished.join("; ")}.`;
      }
    } catch (err) {
      if (this.signal.aborted) {
        finalStatus = "cancelled";
        reason = "Stopped by the user.";
      } else if (err instanceof StopTask) {
        finalStatus = err.status;
        reason = err.reason;
      } else {
        finalStatus = "failed";
        reason = toVinnieError(err).message;
      }
    }

    return this.finish(finalStatus, reason, verification);
  }

  // ---- model -----------------------------------------------------------------

  private systemPrompt(): string {
    return buildAgentSystemPrompt({
      mode: this.input.mode,
      intent: this.task.intent,
      project: this.input.project,
      memory: this.memory.render(),
      plan: renderPlan(this.task.plan),
      budget: {
        iteration: this.task.iteration,
        maxIterations: this.input.limits.maxIterations,
        toolCalls: this.task.toolCalls,
        maxToolCalls: this.input.limits.maxToolCalls,
      },
      toolsAvailable: this.toolsOn,
    });
  }

  private async callModel(toolNames: string[]): Promise<GenerationOutcome> {
    const { maxRetries } = this.input.limits;
    for (let attempt = 0; ; attempt++) {
      await this.gate();
      this.throwIfCancelled();
      const built = buildContext({
        system: this.systemPrompt(),
        history: this.input.history,
        request: this.input.request,
        taskTurns: this.taskTurns,
        budget: this.effectiveBudget,
      });
      this.deps.stream.reset();
      const specs = this.toolsOn ? this.deps.registry.specs(toolNames) : undefined;
      const partial = { content: "", thinking: "" };
      this.handle = this.deps.provider.streamChat(
        { model: this.input.model, messages: built.messages, tools: specs, numCtx: this.budget },
        (event) => {
          if (event.type === "started") this.deps.stream.started();
          else if (event.type === "content") {
            partial.content += event.text;
            this.deps.stream.content(event.text);
          } else if (event.type === "thinking") {
            partial.thinking += event.text;
            this.deps.stream.thinking(event.text);
          }
        },
      );
      try {
        const outcome = await this.handle.result;
        this.handle = null;
        if (outcome.status === "cancelled") throw new VinnieError("unknown", "cancelled");
        this.recordUsage(outcome);
        return outcome;
      } catch (err) {
        this.handle = null;
        if (this.signal.aborted) {
          await this.persistPartial(partial, null);
          this.throwIfCancelled();
        }
        const e = toVinnieError(err);
        if (e.kind === "tools_unsupported" && this.toolsOn) {
          this.toolsOn = false;
          this.addStep("note", `${this.input.model} can't use tools; continuing without them`, "info");
          this.deps.notice(`${this.input.model} doesn't support tools, so Vinnie answered without project tools.`);
          attempt -= 1;
          continue;
        }
        // Once output has been shown, keep it and report the failure rather than silently starting over.
        if (isTransientModelError(e.kind) && attempt < maxRetries && !partial.content.trim()) {
          this.task.retries += 1;
          this.addStep("retry", `Model request failed (${e.message}); retrying`, "info");
          this.emit("agent.retrying", "Retrying the model request");
          await this.sleep(1_000 * (attempt + 1));
          continue;
        }
        this.modelError = e;
        await this.persistPartial(partial, e.message);
        throw new StopTask("failed", `The model request failed: ${e.message}`);
      }
    }
  }

  /** Keep streamed output the user already saw, marked as interrupted. */
  private async persistPartial(partial: { content: string; thinking: string }, error: string | null): Promise<void> {
    if (!partial.content.trim() && !partial.thinking.trim()) return;
    await this.deps
      .persist({
        conversationId: this.input.conversationId,
        role: "assistant",
        content: partial.content,
        thinking: partial.thinking.trim() ? partial.thinking : null,
        status: "interrupted",
        model: this.input.model,
        error,
      })
      .catch(() => {});
  }

  private recordUsage(outcome: GenerationOutcome): void {
    const prompt = outcome.stats?.promptTokens ?? 0;
    const completion = outcome.stats?.completionTokens ?? 0;
    this.task.usage.promptTokens += prompt;
    this.task.usage.completionTokens += completion;
    this.task.usage.peakPromptTokens = Math.max(this.task.usage.peakPromptTokens, prompt);
    // Near the limit: tighten the budget so older results are compressed.
    if (prompt > this.budget * 0.9) this.effectiveBudget = Math.floor(this.budget * 0.75);
  }

  // ---- tools -----------------------------------------------------------------

  private toolContext(): ToolContext {
    const settings = this.deps.settings();
    return {
      taskId: this.task.id,
      signal: this.signal,
      services: this.deps.services,
      permissions: settings.permissions,
      mode: this.input.mode,
      workspaceRoot: this.input.workspaceRoot ?? "",
      authorize: async (request, capability) => {
        const auth = await this.deps.permissions.authorize({
          request,
          capability,
          mode: this.input.mode,
          permissions: settings.permissions,
          taskId: this.task.id,
          workspace: this.input.workspaceRoot ?? "",
          prompt: async (req) => {
            const previous = this.task.status;
            this.setStatus("waiting_for_permission");
            const stepId = this.addStep("permission", `Permission requested: ${describeRequest(req)}`, "running");
            this.emit("agent.permission_requested", "Waiting for your approval");
            const decision = await this.deps.prompt(req, this.signal);
            this.updateStep(stepId, decision.approved ? "succeeded" : "denied", {
              title: `${decision.approved ? "Permission granted" : "Permission denied"}: ${describeRequest(req)}`,
              details: decision.approved ? `Scope: ${decision.scope ?? "once"}` : undefined,
            });
            this.emit(decision.approved ? "agent.permission_granted" : "agent.permission_denied", decision.approved ? "Approved" : "Denied");
            this.memory.add(
              decision.approved
                ? `User approved: ${describeRequest(req)}${decision.scope && decision.scope !== "once" ? ` (for this ${decision.scope})` : ""}.`
                : `User denied: ${describeRequest(req)}. Do not retry it.`,
            );
            if (!this.paused) this.setStatus(previous);
            return decision;
          },
        });
        if (!auth.approved && !auth.prompted) {
          this.addStep("permission", `Not permitted: ${describeRequest(request)}`, "denied", { details: auth.reason });
          this.emit("agent.permission_denied", "Not permitted by settings");
        }
        return auth;
      },
      runCommand: (request) =>
        this.deps.runCommand({
          ...request,
          timeoutSecs: request.timeoutSecs ?? this.input.limits.commandTimeoutSecs,
        }),
      filesChanged: (paths) => this.deps.filesChanged(paths),
      projectChanged: () => this.deps.projectChanged(),
      agent: {
        updatePlan: (update) => {
          this.task.plan = applyPlanUpdate(this.task.plan, update.steps);
          this.addStep("planning", `Plan updated (${update.steps.length} steps)`, "info");
          this.emit("agent.plan_updated", "Plan updated");
        },
        remember: (fact) => {
          this.memory.add(fact);
          this.task.memory = this.memory.list();
        },
        metadata: () => this.deps.metadata(),
      },
    };
  }

  private finishToolStep(record: ExecutionRecord): void {
    const r = record.result;
    const status: StepStatus = r.success
      ? "succeeded"
      : r.outcome === "denied"
        ? "denied"
        : r.outcome === "cancelled"
          ? "cancelled"
          : r.outcome === "timed_out"
            ? "timed_out"
            : "failed";
    const toolInfo = {
      name: record.name,
      arguments: record.arguments,
      resultSummary: r.summary.slice(0, 4_000),
      errorCode: r.error?.code,
      exitCode: r.metadata?.exitCode,
    };
    const running = [...this.task.steps].reverse().find((s) => s.kind === "tool" && s.status === "running");
    let stepId: string;
    if (running && !record.refused) {
      stepId = running.id;
      this.updateStep(running.id, status, { tool: toolInfo });
    } else {
      stepId = this.addStep("tool", firstLine(r.summary), status, { tool: toolInfo });
    }
    const data = { tool: record.name, stepId, outcome: r.outcome, summary: firstLine(r.summary), code: r.error?.code };
    if (r.success) this.emit("agent.tool_completed", `${record.name} succeeded`, data);
    else this.emit("agent.tool_failed", `${record.name}: ${firstLine(r.summary)}`, data);
  }

  private afterTool(record: ExecutionRecord): void {
    const r: ToolResult = record.result;
    const args = (record.arguments ?? {}) as Record<string, unknown>;
    if (r.success && r.output && typeof r.output === "object" && "kind" in r.output && "path" in r.output) {
      const change = r.output as ChangeRecord;
      this.task.changes.push({
        path: change.path,
        kind: change.kind,
        newPath: change.newPath,
        expectedContent: typeof args.content === "string" ? args.content : undefined,
        changeId: change.id,
      });
      this.memory.add(`Changed ${change.newPath ? `${change.path} → ${change.newPath}` : change.path} (${change.kind}).`);
    } else if (!r.success && r.error && r.outcome !== "denied") {
      this.memory.add(`${record.name} failed (${r.error.code}): ${firstLine(r.summary).slice(0, 160)}`);
    } else if (r.success && record.name === "read_file" && typeof args.path === "string") {
      this.memory.add(`Read ${args.path}.`);
    }
    this.task.memory = this.memory.list();
    this.update();
  }

  private pushToolResult(name: string, content: string): void {
    const max = this.input.limits.maxToolResultChars;
    const clipped = content.length > max ? `${content.slice(0, max)}\n… (truncated to ${max} characters)` : content;
    this.taskTurns.push({ role: "tool", content: clipped, tool_name: name });
  }

  // ---- verification ----------------------------------------------------------

  private async verify(): Promise<VerificationResult> {
    this.setStatus("verifying");
    const stepId = this.addStep("verification", "Verifying changes", "running");
    this.emit("agent.verifying", "Verifying changes");
    const ctx = this.toolContext();
    const engine = new VerificationEngine({
      services: this.deps.services,
      metadata: () => this.deps.metadata(),
      refreshMetadata: () => this.deps.refreshMetadata(),
      signal: this.signal,
      runCheck: async (command) => {
        try {
          const check = await this.deps.services.process.assess(command, "assistant");
          if (check.requirement === "blocked" || check.requirement === "denied") {
            return { skipped: `Not allowed: ${check.assessment.reason}` };
          }
          let approved = false;
          if (check.requirement === "approval") {
            const auth = await ctx.authorize(
              {
                kind: "command",
                command,
                workspace: check.workspace,
                cwd: null,
                reason: "Verify the changes",
                assessment: check.assessment,
              },
              "execute",
            );
            if (!auth.approved) return { skipped: auth.reason ?? "Not approved." };
            approved = true;
          }
          const result = await ctx.runCommand({ command, approved, remember: false, reason: "Verification" });
          return { result };
        } catch (err) {
          return { skipped: toVinnieError(err).message };
        }
      },
    });
    const result = await engine.verify(this.task.changes);
    this.updateStep(stepId, result.success ? "succeeded" : "failed", { title: `Verification: ${result.summary}` });
    this.emit(result.success ? "agent.verification_passed" : "agent.verification_failed", result.summary);
    this.memory.add(`Verification ${result.success ? "passed" : "failed"}: ${result.summary}`);
    return result;
  }

  // ---- finish ----------------------------------------------------------------

  private async finish(
    status: AgentResult["status"],
    reason: string,
    verification: VerificationResult | null,
  ): Promise<AgentTask> {
    const changes = await this.changeSummary();
    this.task.result = { status, reason, verification, changes };
    this.task.completedAt = this.now();
    this.task.memory = this.memory.list();
    this.deps.permissions.endTask(this.task.id);
    this.setStatus(status);
    this.addStep("note", statusTitle(status, reason), status === "completed" ? "succeeded" : status === "cancelled" ? "cancelled" : "failed");
    const event: AgentEventType =
      status === "completed" ? "agent.completed" : status === "cancelled" ? "agent.cancelled" : status === "stopped" ? "agent.stopped" : "agent.failed";
    this.emit(event, statusTitle(status, reason));
    // Plain answers need no report; the chat already shows partial output or the error.
    if (this.task.toolCalls > 0 || changes.files > 0 || (this.task.intent === "task" && status === "completed")) {
      await this.deps
        .persist({
          conversationId: this.input.conversationId,
          role: "assistant",
          content: renderReport(this.task),
          status: status === "completed" ? "complete" : "interrupted",
          model: null,
        })
        .catch(() => {});
    }
    return this.task;
  }

  private unfinishedPlanSteps(): string[] {
    return (this.task.plan?.steps ?? []).filter((s) => s.status === "pending" || s.status === "in_progress").map((s) => s.title);
  }

  private async changeSummary(): Promise<ChangeSummary> {
    if (this.task.changes.length === 0) return { files: 0, additions: 0, deletions: 0, paths: [] };
    try {
      const all = await this.deps.services.changes.list();
      const mine = all.filter((c) => c.taskId === this.task.id && c.status === "applied");
      const paths = [...new Set(mine.map((c) => c.newPath ?? c.path))];
      return {
        files: paths.length,
        additions: mine.reduce((n, c) => n + c.additions, 0),
        deletions: mine.reduce((n, c) => n + c.deletions, 0),
        paths,
      };
    } catch {
      const paths = [...new Set(this.task.changes.map((c) => c.newPath ?? c.path))];
      return { files: paths.length, additions: 0, deletions: 0, paths };
    }
  }

  // ---- helpers ---------------------------------------------------------------

  private async gate(): Promise<void> {
    while (this.paused && !this.signal.aborted) {
      await new Promise<void>((resolve) => this.resumeWaiters.push(resolve));
    }
  }

  private throwIfCancelled(): void {
    if (this.signal.aborted) throw new StopTask("failed", "cancelled");
  }

  private isFinished(): boolean {
    return TERMINAL_STATUSES.includes(this.task.status);
  }

  private setStatus(status: AgentStatus): void {
    if (this.task.status === status) return;
    this.task.status = status;
    this.update();
  }

  private addStep(kind: StepKind, title: string, status: StepStatus, extra: Partial<AgentStep> = {}): string {
    const id = `s${(stepCounter++).toString(36)}`;
    const at = this.now();
    this.task.steps = [
      ...this.task.steps,
      { id, kind, title, status, startedAt: at, endedAt: status === "running" ? null : at, ...extra },
    ];
    this.update();
    return id;
  }

  private updateStep(id: string, status: StepStatus, extra: Partial<AgentStep> = {}): void {
    const at = this.now();
    this.task.steps = this.task.steps.map((s) => (s.id === id ? { ...s, ...extra, status, endedAt: at } : s));
    this.update();
  }

  private update(): void {
    this.deps.onUpdate(snapshot(this.task));
  }

  private emit(type: AgentEventType, label: string, data?: Record<string, unknown>): void {
    emitAgentEvent({ type, taskId: this.task.id, at: this.now(), label, task: snapshot(this.task), data });
  }
}

function snapshot(task: AgentTask): AgentTask {
  return { ...task, steps: [...task.steps], changes: [...task.changes], memory: [...task.memory] };
}

function firstLine(text: string): string {
  const line = text.split("\n", 1)[0] ?? "";
  return line.length > 160 ? `${line.slice(0, 160)}…` : line;
}

export function describeRequest(r: ApprovalRequest): string {
  switch (r.kind) {
    case "command":
      return r.install ? `install ${r.install.packages.join(", ") || "dependencies"}` : `run \`${r.command}\``;
    case "file":
      return `${r.preview.kind} ${r.preview.newPath ? `${r.preview.path} → ${r.preview.newPath}` : r.preview.path}`;
    case "read":
      return `read ${r.path}`;
  }
}

function statusTitle(status: AgentResult["status"], reason: string): string {
  switch (status) {
    case "completed":
      return `Task completed. ${reason}`;
    case "cancelled":
      return "Task cancelled by the user.";
    case "stopped":
      return `Task stopped safely. Reason: ${reason}`;
    default:
      return `Task failed. ${reason}`;
  }
}

/** Factual task report written by the application (not the model). */
export function renderReport(task: AgentTask): string {
  const r = task.result!;
  const unchanged = r.status === "completed" && task.intent === "task" && r.changes.files === 0;
  const icon = unchanged ? "ℹ" : { completed: "✓", failed: "✗", stopped: "■", cancelled: "■" }[r.status];
  // Blocks are separated by blank lines so Markdown keeps them apart.
  const blocks = [`**Task report** ${icon} ${unchanged ? `Task finished. ${r.reason}` : statusTitle(r.status, r.reason)}`];
  blocks.push(
    r.changes.files
      ? `**Changes:** ${r.changes.files} file${r.changes.files === 1 ? "" : "s"} changed (+${r.changes.additions} −${r.changes.deletions}): ${r.changes.paths.map((p) => `\`${p}\``).join(", ")}`
      : "**Changes:** none.",
  );
  if (r.verification) {
    blocks.push(`**Verification:** ${r.verification.summary}`);
    blocks.push(
      r.verification.checks
        .map((c) => {
          const mark = c.status === "passed" ? "✓" : c.status === "failed" ? "✗" : "–";
          return `- ${mark} ${c.name}${c.status === "failed" ? ` — ${c.details.split("\n", 1)[0]}` : ""}`;
        })
        .join("\n"),
    );
  } else if (r.changes.files) {
    blocks.push("**Verification:** not run.");
  }
  blocks.push(`Steps: ${task.iteration} model step(s), ${task.toolCalls} tool call(s), ${task.retries} retr${task.retries === 1 ? "y" : "ies"}.`);
  return blocks.filter(Boolean).join("\n\n");
}
