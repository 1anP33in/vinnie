// Command tools. The backend classifies every command (blocked / approval /
// low risk) and enforces it; these tools show the approval card and report
// the real outcome, including failures.

import { z } from "zod";
import { diagnose } from "@/lib/diagnose";
import type { RunResult } from "@/lib/ipc/types";
import type { ToolContext, ToolResult, VinnieTool } from "../types";

const TAIL_CHARS = 4_000;

function tail(text: string): string {
  const trimmed = text.trimEnd();
  return trimmed.length > TAIL_CHARS ? `…${trimmed.slice(-TAIL_CHARS)}` : trimmed;
}

export function formatRunResult(result: RunResult): string {
  const o = result.outcome;
  const status = o.timedOut
    ? "TIMED OUT (the process was stopped)"
    : o.cancelled
      ? "STOPPED by the user"
      : o.success
        ? "succeeded"
        : "FAILED";
  const parts = [
    `Command: ${result.assessment.command}`,
    `Result: ${status}`,
    `Exit code: ${o.exitCode ?? "none"}`,
    `Duration: ${(o.durationMs / 1000).toFixed(1)}s`,
  ];
  if (o.stdoutTail.trim()) parts.push(`--- stdout (end) ---\n${tail(o.stdoutTail)}`);
  if (o.stderrTail.trim()) parts.push(`--- stderr (end) ---\n${tail(o.stderrTail)}`);
  if (!o.success) {
    const d = diagnose(`${o.stderrTail}\n${o.stdoutTail}`);
    if (d) parts.push(`Likely cause: ${d.cause}\nSuggested next step: ${d.suggestion}`);
  }
  return parts.join("\n");
}

async function gateAndRun(
  command: string,
  opts: { reason?: string; cwd?: string; timeoutSecs?: number },
  ctx: ToolContext,
  install?: { manager: string; packages: string[]; candidates: string[]; ambiguous: boolean; detectionReason: string },
): Promise<{ result: RunResult } | ToolResult> {
  const check = await ctx.services.process.assess(command, "assistant");
  if (check.requirement === "blocked") {
    return { ok: false, kind: "blocked", error: `Blocked by Vinnie's command policy: ${check.assessment.reason}` };
  }
  if (check.requirement === "denied") {
    return { ok: false, kind: "permission_denied", error: "The user's settings do not allow Vinnie to run this command." };
  }
  let approved = false;
  let remember = false;
  if (check.requirement === "approval") {
    const decision = await ctx.requestApproval({
      kind: "command",
      command: check.assessment.command,
      workspace: check.workspace,
      cwd: opts.cwd ?? null,
      reason: opts.reason ?? null,
      assessment: check.assessment,
      install,
    });
    if (!decision.approved) {
      return { ok: false, kind: "denied", error: `The user denied running \`${check.assessment.command}\`.` };
    }
    if (install && decision.manager && decision.manager !== install.manager) {
      // The user picked a different package manager for an ambiguous project.
      const rebuilt = await ctx.services.analysis.installCommand(decision.manager, install.packages);
      return gateAndRun(rebuilt.display, opts, ctx, { ...install, manager: decision.manager, ambiguous: false });
    }
    approved = true;
    remember = decision.remember ?? false;
  }
  const result = await ctx.runCommand({
    command: check.assessment.command,
    cwd: opts.cwd ?? null,
    timeoutSecs: opts.timeoutSecs ?? null,
    approved,
    remember,
    reason: opts.reason ?? null,
  });
  return { result };
}

const runSchema = z.object({
  command: z.string().min(1).max(2000),
  reason: z.string().max(500).optional(),
  cwd: z.string().max(1024).optional(),
  timeoutSeconds: z.number().int().min(1).max(3600).optional(),
});

export const runCommand: VinnieTool<z.infer<typeof runSchema>> = {
  name: "run_command",
  description:
    "Run one development command (no pipes, redirects, or '&&') in the project folder, e.g. `npm test` or `git status`. Read-only and build/test commands run directly; others need the user's approval; destructive commands are blocked. Returns the exit code and the end of the output.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string" },
      reason: { type: "string", description: "Why this command is needed, shown to the user." },
      cwd: { type: "string", description: "Working folder relative to the project root (default: root)." },
      timeoutSeconds: { type: "integer", description: "Default 600." },
    },
    required: ["command"],
  },
  schema: runSchema,
  capability: "execute",
  activityKind: "command",
  describe: (i) => `Running ${i.command}`,
  async execute(input, ctx) {
    const outcome = await gateAndRun(input.command, { reason: input.reason, cwd: input.cwd, timeoutSecs: input.timeoutSeconds }, ctx);
    if (!("result" in outcome)) return outcome;
    return { ok: true, content: formatRunResult(outcome.result) };
  },
};

const installSchema = z.object({
  packages: z.array(z.string().min(1).max(214)).max(20),
  dev: z.boolean().optional(),
  manager: z.string().max(20).optional(),
  reason: z.string().max(500).optional(),
});

export const installDependency: VinnieTool<z.infer<typeof installSchema>> = {
  name: "install_dependency",
  description:
    "Install packages with the project's package manager (detected from lockfiles). Pass an empty list to install the project's declared dependencies. Always asks the user unless they enabled automatic installs.",
  inputSchema: {
    type: "object",
    properties: {
      packages: { type: "array", items: { type: "string" }, description: "e.g. ['express'] or ['requests==2.32.3']" },
      dev: { type: "boolean", description: "Install as a development dependency." },
      manager: { type: "string", description: "Only if the user named one (npm, pnpm, yarn, pip, cargo, ...)." },
      reason: { type: "string" },
    },
    required: ["packages"],
  },
  schema: installSchema,
  capability: "install",
  activityKind: "install",
  describe: (i) => `Installing ${i.packages.length ? i.packages.join(", ") : "project dependencies"}`,
  async execute(input, ctx) {
    const detections = await ctx.services.analysis.packageManagers();
    let manager = input.manager?.toLowerCase();
    let candidates: string[] = manager ? [manager] : [];
    let ambiguous = false;
    let detectionReason = manager ? "Requested explicitly." : "";
    if (!manager) {
      if (detections.length === 0) {
        return { ok: false, error: "No package manager was detected in this project (no package.json, requirements.txt, Cargo.toml, ...)." };
      }
      const primary = detections[0]!;
      candidates = primary.candidates;
      ambiguous = primary.ambiguous;
      detectionReason = primary.reason;
      manager = primary.manager ?? primary.candidates[0]!;
    }
    const cmd = await ctx.services.analysis.installCommand(manager, input.packages, input.dev ?? false);
    const outcome = await gateAndRun(cmd.display, { reason: input.reason }, ctx, {
      manager,
      packages: cmd.packages,
      candidates,
      ambiguous,
      detectionReason,
    });
    if (!("result" in outcome)) return outcome;
    ctx.projectChanged();
    const o = outcome.result.outcome;
    const what = input.packages.length ? input.packages.join(", ") : "the project's dependencies";
    const verdict = o.success
      ? `Installed ${what} successfully.`
      : `Installing ${what} FAILED. Nothing should be assumed installed.`;
    return { ok: true, content: `${verdict}\n${formatRunResult(outcome.result)}` };
  },
};
