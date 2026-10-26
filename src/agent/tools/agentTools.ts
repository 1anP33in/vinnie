// Agent-only tools: planning, task memory, and project facts. They only
// change the agent's own state, never the workspace.

import { z } from "zod";
import { toolFailure, toolSuccess, type VinnieTool } from "../types";

const planSchema = z.object({
  steps: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        status: z.enum(["pending", "in_progress", "done", "skipped"]).optional(),
      }),
    )
    .min(1)
    .max(15),
});

export const updatePlan: VinnieTool<z.infer<typeof planSchema>> = {
  name: "update_plan",
  description:
    "Create or update the visible task plan (3-8 short steps for multi-step work). Call it before making changes, and again to mark steps in_progress/done as you work. Skip it for simple questions.",
  inputSchema: {
    type: "object",
    properties: {
      steps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            status: { type: "string", enum: ["pending", "in_progress", "done", "skipped"] },
          },
          required: ["title"],
        },
      },
    },
    required: ["steps"],
  },
  schema: planSchema,
  category: "PROJECT",
  riskLevel: "safe",
  activityKind: "model",
  describe: (i) => `Planning (${i.steps.length} steps)`,
  async execute(input, ctx) {
    if (!ctx.agent) return toolFailure("TOOL_FAILURE", "Planning is only available while an agent task runs.");
    ctx.agent.updatePlan({ steps: input.steps });
    const lines = input.steps.map((s, i) => `${i + 1}. [${s.status ?? "pending"}] ${s.title}`);
    return toolSuccess(`Plan updated:\n${lines.join("\n")}`);
  },
};

const rememberSchema = z.object({ fact: z.string().min(3).max(300) });

export const remember: VinnieTool<z.infer<typeof rememberSchema>> = {
  name: "remember",
  description:
    "Record an important fact for the rest of this task (e.g. where something lives, a decision the user made). Facts survive context compression.",
  inputSchema: { type: "object", properties: { fact: { type: "string" } }, required: ["fact"] },
  schema: rememberSchema,
  category: "PROJECT",
  riskLevel: "safe",
  activityKind: "model",
  describe: () => "Recording a fact",
  async execute(input, ctx) {
    if (!ctx.agent) return toolFailure("TOOL_FAILURE", "Task memory is only available while an agent task runs.");
    ctx.agent.remember(input.fact);
    return toolSuccess("Noted.");
  },
};

const infoSchema = z.object({});

export const getProjectInfo: VinnieTool<z.infer<typeof infoSchema>> = {
  name: "get_project_info",
  description:
    "Get the detected project facts: types, languages, frameworks, package managers, entry points, config files, test/build scripts, and Git status.",
  inputSchema: { type: "object", properties: {} },
  schema: infoSchema,
  category: "PROJECT",
  riskLevel: "safe",
  activityKind: "read",
  describe: () => "Reading project information",
  async execute(_input, ctx) {
    const m = ctx.agent?.metadata() ?? (await ctx.services.analysis.cached());
    if (!m) return toolFailure("TOOL_FAILURE", "The project has not been analyzed yet.");
    const facts = {
      name: m.name,
      types: m.projectTypes,
      languages: m.languages,
      frameworks: m.frameworks,
      packageManagers: m.packageManagers.map((p) => ({
        ecosystem: p.ecosystem,
        manager: p.manager,
        ambiguous: p.ambiguous,
        evidence: p.evidence,
      })),
      entryPoints: m.entryPoints,
      configFiles: m.configFiles,
      instructionFiles: m.instructionFiles,
      fivem: m.fivem,
      git: m.git.isRepo
        ? { branch: m.git.branch, modified: m.git.modified.length, untracked: m.git.untracked.length }
        : null,
    };
    return toolSuccess(JSON.stringify(facts, null, 2), { output: facts });
  },
};
