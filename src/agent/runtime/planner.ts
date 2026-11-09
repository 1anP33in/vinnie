// Planner helpers: decide how complex a request is, choose which tools to
// offer, and maintain the visible plan. The model writes the plan (via
// update_plan); the user can edit it; the runtime keeps it in context.

import { isReadOnly } from "@/mcp/classify";
import { words } from "@/skills/selection";
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

/** At most this many external (MCP) tools are offered per request. */
export const MAX_EXTERNAL_TOOLS = 8;

export interface ToolSelectionContext {
  /** The user's request, for relevance. */
  request?: string;
  /** Tool hints from active skills: `run_command`, `github.*`. */
  hints?: string[];
  maxExternal?: number;
  /** A skill with reference files is active (offers read_skill_reference). */
  skillReferences?: boolean;
  /** A project folder is open. Without one only agent tools and MCP tools are offered. */
  workspace?: boolean;
}

/** Native tools that don't touch the project folder. */
const PROJECTLESS = new Set(["update_plan", "remember", "read_skill_reference"]);

function stem(w: string): string {
  if (w.endsWith("ies") && w.length > 4) return `${w.slice(0, -3)}y`;
  if (w.endsWith("es") && w.length > 4 && /(sh|ch|x|ss)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s") && w.length > 3 && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

function hintMatches(hint: string, d: ToolDefinition): boolean {
  if (hint.endsWith(".*")) return d.serverId === hint.slice(0, -2);
  return hint === d.displayName || hint === d.name;
}

/**
 * Relevance of an external tool to the request: the server named (+5), words
 * of the tool name (+3 each), words of its description (+1 each, capped),
 * and skill hints (+4). Server text is only used for matching, never trusted.
 */
export function scoreExternalTool(d: ToolDefinition, request: string, hints: string[]): number {
  const req = new Set([...words(request)].map(stem));
  let score = 0;
  if (d.serverId && (req.has(d.serverId) || req.has(stem(d.serverId)))) score += 5;
  const toolName = d.displayName.split(".").slice(1).join(".");
  for (const w of new Set(toolName.split(/[^a-z0-9]+/i).map((x) => stem(x.toLowerCase())))) {
    if (w.length > 2 && req.has(w)) score += 3;
  }
  let fromDescription = 0;
  for (const w of new Set([...words(d.description.replace(/^\[[^\]]*\]/, ""))].map(stem))) {
    if (w.length > 3 && req.has(w)) fromDescription++;
  }
  score += Math.min(fromDescription, 3);
  if (hints.some((h) => hintMatches(h, d))) score += 4;
  return score;
}

/**
 * Tools to offer the model for this request. Ask mode is read-only; simple
 * questions get inspection tools (plus commands, for things like version
 * checks); tasks get everything. Disabled and unavailable tools are never
 * offered, and only the few most relevant external tools are.
 */
export function selectTools(defs: readonly ToolDefinition[], mode: AgentMode, intent: RequestIntent, ctx: ToolSelectionContext = {}): string[] {
  const usable = defs.filter((d) => d.enabled !== false && d.available !== false);
  const native = usable
    .filter((d) => d.category !== "EXTERNAL")
    .filter((d) => d.name !== "read_skill_reference" || ctx.skillReferences === true)
    .filter((d) => ctx.workspace !== false || PROJECTLESS.has(d.name))
    .filter((d) => {
      if (mode === "ask") return READ_ONLY.has(d.category);
      if (intent === "question") return READ_ONLY.has(d.category) || d.category === "EXECUTE";
      return true;
    })
    .map((d) => d.name);

  const request = ctx.request ?? "";
  const hints = ctx.hints ?? [];
  const external = usable
    .filter((d) => d.category === "EXTERNAL")
    .filter((d) => (mode === "ask" || intent === "question" ? !d.permission || isReadOnly(d.permission) : true))
    .map((d) => ({ d, score: scoreExternalTool(d, request, hints) }))
    .filter((x) => x.score >= 3)
    .sort((a, b) => b.score - a.score || a.d.name.localeCompare(b.d.name))
    .slice(0, ctx.maxExternal ?? MAX_EXTERNAL_TOOLS)
    .map((x) => x.d.name);
  return [...native, ...external];
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
