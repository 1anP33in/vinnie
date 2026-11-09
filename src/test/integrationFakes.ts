// Fakes for the Phase 4 services (MCP backend, tool settings, skills, file
// dialogs). They keep state in memory and record calls for assertions.

import { VinnieError } from "@/lib/errors";
import type {
  McpHttpBodyEvent,
  McpHttpRequest,
  McpServerConfig,
  McpServerInput,
  McpStdioEvent,
  SecretChanges,
  SkillBundle,
  SkillDetail,
  SkillMeta,
  SkillSummary,
  ToolSetting,
} from "@/lib/ipc/types";
import type { FileDialogService, McpService, SkillService, ToolSettingsService } from "@/services";

export function createFakeMcpService() {
  const servers = new Map<string, McpServerConfig>();
  /** Secret values by `server/key` (the real backend keeps them in Credential Manager). */
  const secrets = new Map<string, string>();
  const stdio = new Map<string, (e: McpStdioEvent) => void>();
  const sent: { serverId: string; line: string }[] = [];
  const stopped: string[] = [];
  const aborted: string[] = [];
  let http: ((serverId: string, req: McpHttpRequest, onBody: (e: McpHttpBodyEvent) => void) => Promise<{ status: number; statusText: string; headers: Record<string, string> }>) | null = null;
  let clock = 1_000;

  const service: McpService = {
    async list() {
      return [...servers.values()];
    },
    async save(server: McpServerInput, changes: SecretChanges, isNew: boolean) {
      const existing = servers.get(server.id);
      if (isNew && existing) throw new VinnieError("conflict", `A server with the ID \`${server.id}\` already exists.`);
      if (!isNew && !existing) throw new VinnieError("not_found", "That MCP server no longer exists.");
      const keys = new Set(existing?.secretKeys ?? []);
      for (const [k, v] of Object.entries(changes)) {
        if (v === null) {
          keys.delete(k);
          secrets.delete(`${server.id}/${k}`);
        } else {
          keys.add(k);
          secrets.set(`${server.id}/${k}`, v);
        }
      }
      const config: McpServerConfig = {
        ...server,
        secretKeys: [...keys].sort(),
        lastConnectedAt: existing?.lastConnectedAt ?? null,
        createdAt: existing?.createdAt ?? clock++,
        updatedAt: clock++,
      };
      servers.set(server.id, config);
      return config;
    },
    async remove(id) {
      servers.delete(id);
      for (const k of [...secrets.keys()]) if (k.startsWith(`${id}/`)) secrets.delete(k);
    },
    async markConnected(id) {
      const s = servers.get(id);
      if (s) servers.set(id, { ...s, lastConnectedAt: clock++ });
    },
    async stdioStart(serverId, onEvent) {
      stdio.set(serverId, onEvent);
      return { pid: 4242 };
    },
    async stdioSend(serverId, line) {
      sent.push({ serverId, line });
    },
    async stdioStop(serverId) {
      stopped.push(serverId);
      const emit = stdio.get(serverId);
      stdio.delete(serverId);
      emit?.({ type: "exit", code: null });
      return !!emit;
    },
    async httpFetch(serverId, request, onBody) {
      if (!http) throw new VinnieError("unreachable", "No fake HTTP handler.");
      return http(serverId, request, onBody);
    },
    async httpAbort(requestId) {
      aborted.push(requestId);
      return true;
    },
    async logs() {
      return [];
    },
  };

  return {
    service,
    servers,
    secrets,
    sent,
    stopped,
    aborted,
    /** Push an event from a running fake stdio server. */
    emitStdio: (serverId: string, e: McpStdioEvent) => stdio.get(serverId)?.(e),
    setHttp: (handler: typeof http) => {
      http = handler;
    },
  };
}

export function createFakeToolSettings() {
  const settings = new Map<string, ToolSetting>();
  const runs: { key: string; outcome: string }[] = [];
  const service: ToolSettingsService = {
    async list() {
      return [...settings.values()];
    },
    async save(s) {
      const current = settings.get(s.key) ?? { key: s.key, enabled: true, policy: null, runCount: 0, lastRunAt: null, lastOutcome: null };
      const next = { ...current, enabled: s.enabled, policy: s.policy };
      settings.set(s.key, next);
      return next;
    },
    async recordRun(key, outcome) {
      runs.push({ key, outcome });
    },
  };
  return { service, settings, runs };
}

export function skillMeta(id: string, over: Partial<SkillMeta> = {}): SkillMeta {
  return {
    id,
    name: id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    description: `Helps with ${id}.`,
    version: "1.0.0",
    author: "Test",
    tags: [],
    match: { keywords: [], languages: [], projectTypes: [] },
    tools: [],
    ...over,
  };
}

export function createFakeSkills(initial: { meta: SkillMeta; instructions: string; references?: Record<string, string>; enabled?: boolean }[] = []) {
  const skills = new Map<string, { meta: SkillMeta; instructions: string; references: Map<string, string>; enabled: boolean }>();
  for (const s of initial) {
    skills.set(s.meta.id, { meta: s.meta, instructions: s.instructions, references: new Map(Object.entries(s.references ?? {})), enabled: s.enabled ?? true });
  }
  const reads: string[] = [];
  const summary = (id: string): SkillSummary => {
    const s = skills.get(id);
    if (!s) throw new VinnieError("not_found", "That skill no longer exists.");
    return { ...s.meta, enabled: s.enabled, builtin: false, references: [...s.references.keys()].sort(), error: null };
  };
  const service: SkillService = {
    async list() {
      return [...skills.keys()].sort().map(summary);
    },
    async read(id): Promise<SkillDetail> {
      reads.push(id);
      return { ...summary(id), instructions: skills.get(id)!.instructions };
    },
    async save(meta, instructions, isNew) {
      if (isNew && skills.has(meta.id)) throw new VinnieError("conflict", "A skill with that id already exists.");
      const prev = skills.get(meta.id);
      skills.set(meta.id, { meta, instructions, references: prev?.references ?? new Map(), enabled: prev?.enabled ?? true });
      return summary(meta.id);
    },
    async remove(id) {
      skills.delete(id);
    },
    async setEnabled(id, enabled) {
      const s = skills.get(id);
      if (s) s.enabled = enabled;
    },
    async readReference(id, name) {
      const text = skills.get(id)?.references.get(name);
      if (text === undefined) throw new VinnieError("not_found", `The skill \`${id}\` has no reference \`${name}\`.`);
      return text;
    },
    async saveReference(id, name, content) {
      skills.get(id)?.references.set(name, content);
    },
    async deleteReference(id, name) {
      skills.get(id)?.references.delete(name);
    },
    async exportBundle(id): Promise<SkillBundle> {
      const s = skills.get(id)!;
      return {
        format: "vinnie-skill",
        version: 1,
        skill: s.meta,
        instructions: s.instructions,
        references: [...s.references.entries()].map(([name, content]) => ({ name, content })),
      };
    },
    async importBundle(bundle, overwrite) {
      if (skills.has(bundle.skill.id) && !overwrite) throw new VinnieError("conflict", "Already installed.");
      skills.set(bundle.skill.id, {
        meta: bundle.skill,
        instructions: bundle.instructions,
        references: new Map(bundle.references.map((r) => [r.name, r.content])),
        enabled: true,
      });
      return summary(bundle.skill.id);
    },
  };
  return { service, skills, reads };
}

export function createFakeDialogs() {
  const saved: { name: string; content: string }[] = [];
  let nextOpen: { name: string; content: string } | null = null;
  const service: FileDialogService = {
    async saveText(defaultName, content) {
      saved.push({ name: defaultName, content });
      return `C:\\Exports\\${defaultName}`;
    },
    async openText() {
      const file = nextOpen;
      nextOpen = null;
      return file;
    },
  };
  return {
    service,
    saved,
    /** The file the next open dialog returns. */
    willOpen: (file: { name: string; content: string } | null) => {
      nextOpen = file;
    },
  };
}
