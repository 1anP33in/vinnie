// Planner helpers: decide how complex a request is, choose which tools to
// offer, and maintain the visible plan. The model writes the plan (via
// update_plan); the user can edit it; the runtime keeps it in context.

import type { ToolDefinition } from "../types";
import type { AgentMode, AgentPlan, PlanStep, RequestIntent } from "./types";

const ACTION_WORDS =
  /\b(add|create|make|build|fix|implement|write|update|change|modify|refactor|rename|move|delete|remove|install|upgrade|bump|set|replace|convert|generate|run|test|migrate|configure|enable|disable|edit|insert|append|clean ?up|format|lint)\b/i;
const QUESTION_START =
  /^(what|where|which|who|why|how|when|is|are|does|do|did|can you explain|explain|show me|tell me|list|describe|summari[sz]e|give me an overview)\b/i;

/** Simple questions skip planning and verification; tasks get both. */
export function classifyIntent(request: string): RequestIntent {
  const text = request.trim();
  const action = ACTION_WORDS.test(text);
  if (QUESTION_START.test(text) && !action) return "question";
  if (/\?\s*$/.test(text) && !action) return "question";
  return action ? "task" : "question";
}

const READ_ONLY = new Set(["READ", "SEARCH", "PROJECT"]);

/**
 * Tools to offer the model for this request. Ask mode is read-only; simple
 * questions get inspection tools (plus commands, for things like version
 * checks); tasks get everything.
 */
export function selectTools(defs: readonly ToolDefinition[], mode: AgentMode, intent: RequestIntent): string[] {
  return defs
    .filter((d) => {
      if (mode === "ask") return READ_ONLY.has(d.category);
      if (intent === "question") return READ_ONLY.has(d.category) || d.category === "EXECUTE";
      return true;
    })
    .map((d) => d.name);
}

let stepCounter = 0;
const newStepId = () => `step-${Date.now().toString(36)}-${(stepCounter++).toString(36)}`;

/** Apply a plan from the model, keeping ids of steps whose titles match. */
export function applyPlanUpdate(
  previous: AgentPlan | undefined,
  steps: { title: string; status?: PlanStep["status"] }[],
): AgentPlan {
  const byTitle = new Map(previous?.steps.map((s) => [s.title.toLowerCase(), s.id]) ?? []);
  return {
    steps: steps.map((s) => ({
      id: byTitle.get(s.title.toLowerCase()) ?? newStepId(),
      title: s.title.trim(),
      status: s.status ?? "pending",
    })),
    editedByUser: previous?.editedByUser ?? false,
    updatedAt: Date.now(),
  };
}

export function editPlanStep(plan: AgentPlan, id: string, title: string): AgentPlan {
  return {
    ...plan,
    steps: plan.steps.map((s) => (s.id === id ? { ...s, title: title.trim() || s.title } : s)),
    editedByUser: true,
    updatedAt: Date.now(),
  };
}

export function removePlanStep(plan: AgentPlan, id: string): AgentPlan {
  return { ...plan, steps: plan.steps.filter((s) => s.id !== id), editedByUser: true, updatedAt: Date.now() };
}

export function renderPlan(plan: AgentPlan | undefined): string {
  if (!plan || plan.steps.length === 0) return "(no plan yet)";
  const mark = { pending: "[ ]", in_progress: "[>]", done: "[x]", skipped: "[-]" } as const;
  const lines = plan.steps.map((s, i) => `${i + 1}. ${mark[s.status]} ${s.title}`);
  if (plan.editedByUser) lines.push("(The user edited this plan. Follow it as written.)");
  return lines.join("\n");
}
