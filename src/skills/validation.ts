// Skill metadata and bundle validation (the editor and imports). The backend
// validates again before writing anything to disk.

import { z } from "zod";
import type { SkillBundle, SkillMeta } from "@/lib/ipc/types";

export const SKILL_ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
/** Reference files: a plain file name with a text extension, no folders. */
export const REFERENCE_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}\.(md|txt|json|lua|js|ts|tsx|py|cs|sql|yaml|yml|toml|html|css|xml|ini|cfg)$/;
export const MAX_INSTRUCTIONS = 20_000;
export const MAX_REFERENCE = 200_000;
export const MAX_REFERENCES = 20;

const words = (max: number) => z.array(z.string().trim().min(1).max(40)).max(max);

export const skillMetaSchema = z.object({
  id: z.string().regex(SKILL_ID, "Use lowercase letters, digits, and dashes (2–64 characters), e.g. fivem-development."),
  name: z.string().trim().min(1, "Give the skill a name.").max(60),
  description: z.string().trim().min(1, "Describe what the skill helps with.").max(300),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "Use a version like 1.0.0."),
  author: z.string().trim().max(60),
  tags: words(12),
  match: z.object({
    keywords: words(40),
    languages: words(12),
    projectTypes: words(12),
  }),
  tools: z.array(z.string().regex(/^[a-z0-9_]+(\.[a-z0-9_*]+)?$/, "Tool hints look like run_command or github.*")).max(20),
});

export type SkillErrors = Partial<Record<keyof SkillMeta | "instructions", string>>;

export function validateSkill(meta: SkillMeta, instructions: string): SkillErrors {
  const errors: SkillErrors = {};
  const result = skillMetaSchema.safeParse(meta);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const key = (issue.path[0] as keyof SkillMeta | undefined) ?? "name";
      errors[key] ??= issue.message;
    }
  }
  if (!instructions.trim()) errors.instructions = "Write the instructions Vinnie should follow.";
  else if (instructions.length > MAX_INSTRUCTIONS) errors.instructions = `Instructions are limited to ${MAX_INSTRUCTIONS.toLocaleString()} characters.`;
  return errors;
}

export function emptySkill(): SkillMeta {
  return {
    id: "",
    name: "",
    description: "",
    version: "1.0.0",
    author: "",
    tags: [],
    match: { keywords: [], languages: [], projectTypes: [] },
    tools: [],
  };
}

/** Turn a name into a skill id: "My Skill!" → "my-skill". */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

const bundleSchema = z.object({
  format: z.literal("vinnie-skill"),
  version: z.literal(1),
  skill: skillMetaSchema,
  instructions: z.string().min(1).max(MAX_INSTRUCTIONS),
  references: z
    .array(z.object({ name: z.string().regex(REFERENCE_NAME, "Invalid reference file name."), content: z.string().max(MAX_REFERENCE) }))
    .max(MAX_REFERENCES),
});

/** Parse an exported skill file. Imported instructions are treated as untrusted guidance. */
export function parseSkillBundle(text: string): { bundle: SkillBundle } | { error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { error: "The file is not valid JSON." };
  }
  const result = bundleSchema.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0];
    return { error: `This is not a valid Vinnie skill file: ${issue ? `${issue.path.join(".") || "file"}: ${issue.message}` : "unknown problem"}.` };
  }
  const names = new Set<string>();
  for (const r of result.data.references) {
    if (names.has(r.name.toLowerCase())) return { error: `Duplicate reference file ${r.name}.` };
    names.add(r.name.toLowerCase());
  }
  return { bundle: result.data as SkillBundle };
}
