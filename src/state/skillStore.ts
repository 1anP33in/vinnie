// Installed skills, manual activation for this session, and lazy loading of
// instructions (only the skills chosen for a task are read from disk).

import { create } from "zustand";
import { describeError } from "@/lib/errors";
import type { ProjectMetadata, SkillBundle, SkillDetail, SkillMeta, SkillSummary } from "@/lib/ipc/types";
import { emitIntegrationEvent } from "@/mcp/events";
import { getServices } from "@/services";
import { selectSkills, type SkillChoice, type SkillOverride } from "@/skills/selection";
import { parseSkillBundle } from "@/skills/validation";

/** A skill as handed to the agent runtime for one task. */
export interface ActiveSkill {
  id: string;
  name: string;
  instructions: string;
  references: string[];
  /** Tool hints (`github.*`); they only affect which tools are offered. */
  tools: string[];
  reasons: string[];
  manual: boolean;
}

interface SkillState {
  skills: SkillSummary[];
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  /** Manual choices for this session: always on / always off. */
  overrides: Record<string, SkillOverride>;
  load(): Promise<void>;
  setOverride(id: string, value: SkillOverride | null): void;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  read(id: string): Promise<SkillDetail>;
  save(meta: SkillMeta, instructions: string, isNew: boolean): Promise<SkillSummary>;
  remove(id: string): Promise<void>;
  /** Choose and load the skills for a request. Failures skip that skill. */
  activate(request: string, project: ProjectMetadata | null): Promise<ActiveSkill[]>;
  exportSkill(id: string): Promise<string | null>;
  importSkill(overwrite?: boolean): Promise<{ imported?: SkillSummary; error?: string; conflict?: SkillBundle }>;
  importBundle(bundle: SkillBundle, overwrite: boolean): Promise<SkillSummary>;
}

/** Instructions cache, keyed by id@version (cleared when a skill is saved). */
const instructionCache = new Map<string, string>();

export const useSkillStore = create<SkillState>((set, get) => ({
  skills: [],
  status: "idle",
  error: null,
  overrides: {},

  async load() {
    set({ status: "loading", error: null });
    try {
      const skills = await getServices().skills.list();
      set({ skills, status: "ready" });
      for (const s of skills) {
        if (s.error) emitIntegrationEvent({ type: "skill.failed", label: `Skill ${s.id} could not be loaded`, skillId: s.id, detail: s.error });
      }
      emitIntegrationEvent({ type: "skill.discovered", label: `${skills.filter((s) => !s.error).length} skills installed` });
    } catch (err) {
      set({ status: "error", error: describeError(err).detail });
    }
  },

  setOverride(id, value) {
    set((s) => {
      const overrides = { ...s.overrides };
      if (value) overrides[id] = value;
      else delete overrides[id];
      return { overrides };
    });
    const skill = get().skills.find((s) => s.id === id);
    if (skill && value) {
      emitIntegrationEvent({
        type: value === "on" ? "skill.activated" : "skill.deactivated",
        label: `${skill.name} turned ${value} by you`,
        skillId: id,
      });
    }
  },

  async setEnabled(id, enabled) {
    await getServices().skills.setEnabled(id, enabled);
    set((s) => ({ skills: s.skills.map((k) => (k.id === id ? { ...k, enabled } : k)) }));
  },

  read: (id) => getServices().skills.read(id),

  async save(meta, instructions, isNew) {
    const saved = await getServices().skills.save(meta, instructions, isNew);
    for (const key of instructionCache.keys()) if (key.startsWith(`${meta.id}@`)) instructionCache.delete(key);
    set((s) => ({
      skills: isNew || !s.skills.some((k) => k.id === saved.id) ? [...s.skills, saved].sort((a, b) => a.name.localeCompare(b.name)) : s.skills.map((k) => (k.id === saved.id ? saved : k)),
    }));
    return saved;
  },

  async remove(id) {
    await getServices().skills.remove(id);
    set((s) => {
      const overrides = { ...s.overrides };
      delete overrides[id];
      return { skills: s.skills.filter((k) => k.id !== id), overrides };
    });
  },

  async activate(request, project) {
    const choices: SkillChoice[] = selectSkills(get().skills, request, project, get().overrides);
    const active: ActiveSkill[] = [];
    for (const c of choices) {
      const key = `${c.skill.id}@${c.skill.version}`;
      try {
        let instructions = instructionCache.get(key);
        if (instructions === undefined) {
          instructions = (await getServices().skills.read(c.skill.id)).instructions;
          instructionCache.set(key, instructions);
          emitIntegrationEvent({ type: "skill.loaded", label: `Loaded ${c.skill.name}`, skillId: c.skill.id });
        }
        active.push({
          id: c.skill.id,
          name: c.skill.name,
          instructions,
          references: c.skill.references,
          tools: c.skill.tools,
          reasons: c.reasons,
          manual: c.manual,
        });
        emitIntegrationEvent({ type: "skill.activated", label: `Using ${c.skill.name}`, skillId: c.skill.id, detail: c.reasons.join(", ") });
      } catch (err) {
        emitIntegrationEvent({ type: "skill.failed", label: `Could not load ${c.skill.name}`, skillId: c.skill.id, detail: describeError(err).detail });
      }
    }
    return active;
  },

  async exportSkill(id) {
    const bundle = await getServices().skills.exportBundle(id);
    return getServices().dialogs.saveText(`${id}.vinnie-skill.json`, JSON.stringify(bundle, null, 2));
  },

  async importSkill(overwrite = false) {
    const file = await getServices().dialogs.openText();
    if (!file) return {};
    const parsed = parseSkillBundle(file.content);
    if ("error" in parsed) return { error: parsed.error };
    if (!overwrite && get().skills.some((s) => s.id === parsed.bundle.skill.id)) return { conflict: parsed.bundle };
    try {
      return { imported: await get().importBundle(parsed.bundle, overwrite) };
    } catch (err) {
      return { error: describeError(err).detail };
    }
  },

  async importBundle(bundle, overwrite) {
    const imported = await getServices().skills.importBundle(bundle, overwrite);
    for (const key of instructionCache.keys()) if (key.startsWith(`${imported.id}@`)) instructionCache.delete(key);
    set((s) => ({
      skills: [...s.skills.filter((k) => k.id !== imported.id), imported].sort((a, b) => a.name.localeCompare(b.name)),
    }));
    emitIntegrationEvent({ type: "skill.discovered", label: `Imported skill ${imported.name}`, skillId: imported.id });
    return imported;
  },
}));

/** Tests: forget cached instructions. */
export function clearSkillCache(): void {
  instructionCache.clear();
}
