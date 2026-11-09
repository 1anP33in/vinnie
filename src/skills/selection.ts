// Automatic skill selection. Scores each enabled skill against the request
// and the selected project, and returns the few that clearly apply. Only
// the selected skills' instructions are loaded into the model's context.

import type { ProjectMetadata, SkillSummary } from "@/lib/ipc/types";

export type SkillOverride = "on" | "off";

export interface SkillChoice {
  skill: SkillSummary;
  score: number;
  /** Why it was chosen (shown in the task panel). */
  reasons: string[];
  manual: boolean;
}

export const MAX_AUTO_SKILLS = 3;
const THRESHOLD = 3;

const STOP = new Set(["the", "and", "for", "with", "that", "this", "from", "into", "your", "you", "can", "how", "what", "please", "make", "use", "using", "add", "build", "create", "fix", "write", "need", "want", "app", "code"]);

export function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9#+.]+/)
      .map((w) => w.replace(/^\.+|\.+$/g, ""))
      .filter((w) => w.length >= 2 && !STOP.has(w)),
  );
}

/** Whether `term` (one or more words) appears in the request words. */
function mentions(requestWords: Set<string>, requestText: string, term: string): boolean {
  const t = term.toLowerCase().trim();
  if (!t) return false;
  if (t.includes(" ")) return requestText.includes(t);
  if (requestWords.has(t)) return true;
  // Simple plurals: "issues" ↔ "issue", "queries" ↔ "query".
  if (requestWords.has(`${t}s`) || (t.endsWith("y") && requestWords.has(`${t.slice(0, -1)}ies`))) return true;
  return t.endsWith("s") && requestWords.has(t.slice(0, -1));
}

export function scoreSkill(skill: SkillSummary, request: string, project: ProjectMetadata | null): { score: number; reasons: string[] } {
  const text = request.toLowerCase();
  const reqWords = words(request);
  let score = 0;
  const reasons: string[] = [];
  const hit = (points: number, reason: string) => {
    score += points;
    if (!reasons.includes(reason)) reasons.push(reason);
  };

  for (const k of [...skill.match.keywords, ...skill.tags]) {
    if (mentions(reqWords, text, k)) hit(3, `mentions "${k}"`);
  }
  for (const w of words(skill.name)) if (w.length > 2 && reqWords.has(w)) hit(2, `mentions "${w}"`);

  if (project) {
    const langs = new Set(project.languages.slice(0, 4).map((l) => l.name.toLowerCase()));
    for (const l of skill.match.languages) if (langs.has(l.toLowerCase())) hit(2, `project uses ${l}`);
    const types = project.projectTypes.map((t) => t.toLowerCase());
    for (const t of skill.match.projectTypes) {
      if (types.some((pt) => pt.includes(t.toLowerCase()))) hit(2, `${t} project`);
    }
    if (project.fivem && (skill.tags.includes("fivem") || skill.match.keywords.includes("fivem"))) hit(2, "FiveM manifest found");
  }
  return { score, reasons };
}

/**
 * Pick the skills for a request: manual "on" skills always, manual "off"
 * never, otherwise the best-scoring enabled skills above the threshold.
 */
export function selectSkills(
  skills: SkillSummary[],
  request: string,
  project: ProjectMetadata | null,
  overrides: Record<string, SkillOverride> = {},
  max = MAX_AUTO_SKILLS,
): SkillChoice[] {
  const usable = skills.filter((s) => s.enabled && !s.error);
  const manual: SkillChoice[] = usable
    .filter((s) => overrides[s.id] === "on")
    .map((s) => ({ skill: s, score: Infinity, reasons: ["turned on by you"], manual: true }));
  const auto = usable
    .filter((s) => !overrides[s.id])
    .map((s) => ({ skill: s, ...scoreSkill(s, request, project), manual: false }))
    .filter((c) => c.score >= THRESHOLD)
    .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
    .slice(0, Math.max(0, max - manual.length));
  return [...manual, ...auto];
}
