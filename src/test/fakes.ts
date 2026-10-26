// In-memory fakes for every service so tests never need Tauri or Ollama.

import { createToolRegistry } from "@/agent/toolRegistry";
import { VinnieError } from "@/lib/errors";
import type {
  ChangePreview,
  ChangeRecord,
  ChatTurn,
  CommandCheck,
  Conversation,
  DirEntry,
  FileOperation,
  GenerationOutcome,
  ManagerDetection,
  Message,
  ModelInfo,
  NewMessage,
  ProcessEvent,
  ProcessOutcome,
  ProjectInfo,
  ProjectMetadata,
  Requirement,
  RunRequest,
  Settings,
  StreamEvent,
  ToolCall,
} from "@/lib/ipc/types";
import type { AIProvider } from "@/providers/types";
import type { ConversationRepository } from "@/repositories/types";
import {
  setServices,
  type ChangeService,
  type ProcessService,
  type ProjectAnalysisService,
  type SearchService,
  type Services,
  type WorkspaceService,
} from "@/services";
import { DEFAULT_SETTINGS } from "@/settings/validation";
import { permissionManager } from "@/agent/runtime/permissionManager";
import { useActivityStore } from "@/state/activityStore";
import { useAgentStore } from "@/state/agentStore";
import { useApprovalStore } from "@/state/approvalStore";
import { useChangesStore } from "@/state/changesStore";
import { useChatStore } from "@/state/chatStore";
import { useConnectionStore } from "@/state/connectionStore";
import { useConversationStore } from "@/state/conversationStore";
import { useEditorStore } from "@/state/editorStore";
import { useProjectStore } from "@/state/projectStore";
import { useSearchStore } from "@/state/searchStore";
import { useSettingsStore } from "@/state/settingsStore";
import { useTerminalStore } from "@/state/terminalStore";
import { useUiStore } from "@/state/uiStore";
import { useWorkspaceStore } from "@/state/workspaceStore";

// Snapshot pristine store states (including actions) at import time.
const initialStates = [
  [useChatStore, useChatStore.getState()],
  [useConnectionStore, useConnectionStore.getState()],
  [useConversationStore, useConversationStore.getState()],
  [useProjectStore, useProjectStore.getState()],
  [useSettingsStore, useSettingsStore.getState()],
  [useUiStore, useUiStore.getState()],
  [useActivityStore, useActivityStore.getState()],
  [useApprovalStore, useApprovalStore.getState()],
  [useChangesStore, useChangesStore.getState()],
  [useEditorStore, useEditorStore.getState()],
  [useSearchStore, useSearchStore.getState()],
  [useTerminalStore, useTerminalStore.getState()],
  [useWorkspaceStore, useWorkspaceStore.getState()],
  [useAgentStore, useAgentStore.getState()],
] as const;

export function resetStores() {
  for (const [store, state] of initialStates) {
    (store as { setState(s: unknown, replace: true): void }).setState(state, true);
  }
  permissionManager.clearSession();
}

/** A scripted generation that tests drive step by step. */
export class FakeStream {
  content = "";
  thinking = "";
  cancelled = false;
  toolCalls: ToolCall[] = [];
  readonly result: Promise<GenerationOutcome>;
  private resolve!: (o: GenerationOutcome) => void;
  private reject!: (e: unknown) => void;

  constructor(
    readonly model: string,
    readonly messages: ChatTurn[],
    readonly tools: object[] | undefined,
    private readonly onEvent: (e: StreamEvent) => void,
  ) {
    this.result = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }

  emit(event: StreamEvent) {
    if (event.type === "content") this.content += event.text;
    if (event.type === "thinking") this.thinking += event.text;
    this.onEvent(event);
  }

  callTool(name: string, args: Record<string, unknown>) {
    this.toolCalls.push({ function: { name, arguments: args } });
  }

  complete() {
    this.resolve({
      status: "completed",
      content: this.content,
      thinking: this.thinking,
      stats: null,
      toolCalls: this.toolCalls,
    });
  }

  cancel() {
    this.cancelled = true;
    this.resolve({ status: "cancelled", content: this.content, thinking: this.thinking, stats: null, toolCalls: [] });
  }

  fail(error: VinnieError) {
    this.reject(error);
  }
}

export interface FakeProvider extends AIProvider {
  streams: FakeStream[];
  /** Context length reported by modelDetails (null = unknown). */
  contextLength: number | null;
  models: ModelInfo[];
  connectionError: VinnieError | null;
  lastStream(): FakeStream;
}

export function model(name: string): ModelInfo {
  return { name, sizeBytes: null, modifiedAt: null, family: null, parameterSize: null, quantization: null };
}

export function createFakeProvider(models: ModelInfo[] = [model("qwen3:8b")]): FakeProvider {
  const provider: FakeProvider = {
    id: "fake",
    displayName: "Fake",
    streams: [],
    models,
    contextLength: null,
    connectionError: null,
    async modelDetails(name) {
      return { name, contextLength: provider.contextLength, capabilities: ["completion", "tools"] };
    },
    async checkConnection(endpoint) {
      if (provider.connectionError) throw provider.connectionError;
      return { endpoint: endpoint ?? "http://localhost:11434", version: "0.0.0-test" };
    },
    async listModels() {
      if (provider.connectionError) throw provider.connectionError;
      return provider.models;
    },
    streamChat(request, onEvent) {
      const stream = new FakeStream(request.model, request.messages, request.tools, onEvent);
      provider.streams.push(stream);
      return {
        requestId: `req-${provider.streams.length}`,
        result: stream.result,
        cancel: async () => stream.cancel(),
      };
    },
    lastStream() {
      const s = provider.streams[provider.streams.length - 1];
      if (!s) throw new Error("no stream started");
      return s;
    },
  };
  return provider;
}

export interface FakeRepository extends ConversationRepository {
  conversations: Conversation[];
  messages: Message[];
  failAddMessage: ((m: NewMessage) => boolean) | null;
  lastActive: string | null;
}

export function createFakeRepository(): FakeRepository {
  let clock = 1_000;
  let nextMessageId = 1;
  const repo: FakeRepository = {
    conversations: [],
    messages: [],
    failAddMessage: null,
    lastActive: null,
    async list() {
      return [...repo.conversations]
        .map((c) => ({ ...c, messageCount: repo.messages.filter((m) => m.conversationId === c.id).length }))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async search(query) {
      const q = query.toLowerCase();
      return (await repo.list()).filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          repo.messages.some((m) => m.conversationId === c.id && m.content.toLowerCase().includes(q)),
      );
    },
    async create(title, modelName) {
      const now = ++clock;
      const c: Conversation = {
        id: `conv-${repo.conversations.length + 1}`,
        title,
        model: modelName,
        createdAt: now,
        updatedAt: now,
        messageCount: 0,
      };
      repo.conversations.push(c);
      return c;
    },
    async rename(id, title) {
      const c = repo.conversations.find((x) => x.id === id);
      if (!c) throw new VinnieError("not_found", "That conversation no longer exists.");
      c.title = title;
      return { ...c };
    },
    async remove(id) {
      const before = repo.conversations.length;
      repo.conversations = repo.conversations.filter((c) => c.id !== id);
      repo.messages = repo.messages.filter((m) => m.conversationId !== id);
      if (repo.conversations.length === before) throw new VinnieError("not_found", "That conversation no longer exists.");
    },
    async removeAll() {
      const n = repo.conversations.length;
      repo.conversations = [];
      repo.messages = [];
      return n;
    },
    async listMessages(conversationId) {
      return repo.messages.filter((m) => m.conversationId === conversationId);
    },
    async addMessage(m) {
      if (repo.failAddMessage?.(m)) throw new VinnieError("database", "disk I/O error");
      const c = repo.conversations.find((x) => x.id === m.conversationId);
      if (!c) throw new VinnieError("not_found", "That conversation no longer exists.");
      const now = ++clock;
      const saved: Message = {
        id: nextMessageId++,
        conversationId: m.conversationId,
        role: m.role,
        content: m.content,
        thinking: m.thinking ?? null,
        status: m.status ?? "complete",
        model: m.model ?? null,
        error: m.error ?? null,
        toolCalls: m.toolCalls ?? null,
        toolName: m.toolName ?? null,
        createdAt: now,
      };
      repo.messages.push(saved);
      c.updatedAt = now;
      return saved;
    },
    async getLastActive() {
      return repo.lastActive;
    },
    async setLastActive(id) {
      repo.lastActive = id;
    },
  };
  return repo;
}

export function createFakeProject() {
  const state = {
    saved: null as ProjectInfo | null,
    nextPick: null as ProjectInfo | null,
    pickError: null as VinnieError | null,
  };
  return {
    state,
    service: {
      getActive: async () => state.saved,
      pickFolder: async () => {
        if (state.pickError) throw state.pickError;
        if (state.nextPick) state.saved = state.nextPick;
        return state.nextPick;
      },
      clear: async () => {
        state.saved = null;
      },
    },
  };
}

// ---- Workspace fakes -------------------------------------------------------

function hash(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  return `h${h}:${text.length}`;
}

const SENSITIVE = /(^|\/)\.env($|\.(?!example))/;

/** An in-memory project file system behind the workspace/change services. */
export function createFakeWorkspace(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const changes: (ChangeRecord & { before: string | null; after: string | null })[] = [];
  let nextChange = 1;

  const exists = (p: string) => files.has(p);
  const assertInside = (p: string) => {
    if (p.includes("..") || p.startsWith("/") || /^[a-zA-Z]:/.test(p)) {
      throw new VinnieError("forbidden", "Paths cannot use '..' to leave the project folder.");
    }
  };

  const workspace: WorkspaceService = {
    async listDir(path) {
      const prefix = path ? `${path}/` : "";
      const names = new Map<string, DirEntry>();
      for (const p of files.keys()) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        const [head, ...tail] = rest.split("/");
        const full = prefix + head;
        names.set(head!, {
          name: head!,
          path: full,
          kind: tail.length ? "directory" : "file",
          size: tail.length ? null : files.get(p)!.length,
          ignored: head === "node_modules",
        });
      }
      const entries = [...names.values()].sort(
        (a, b) => Number(b.kind === "directory") - Number(a.kind === "directory") || a.name.localeCompare(b.name),
      );
      return { path, entries, truncated: false };
    },
    async tree() {
      return { text: [...files.keys()].sort().join("\n") + "\n", entries: files.size, truncated: false };
    },
    async readFile(path, access) {
      assertInside(path);
      if (access?.actor === "assistant" && SENSITIVE.test(path) && !access.approved) {
        throw new VinnieError("approval_required", `${path} may contain secrets.`);
      }
      const content = files.get(path);
      if (content === undefined) throw new VinnieError("not_found", `${path} does not exist.`);
      if (content.includes("\0")) {
        return { path, content: null, binary: true, tooLarge: false, version: { size: content.length, modifiedMs: 0, hash: hash(content) } };
      }
      return { path, content, binary: false, tooLarge: false, version: { size: content.length, modifiedMs: 0, hash: hash(content) } };
    },
    async statFile(path) {
      const content = files.get(path);
      if (content === undefined) throw new VinnieError("not_found", `${path} does not exist.`);
      return { size: content.length, modifiedMs: 0, hash: hash(content) };
    },
    async createDir() {},
  };

  const preview = async (op: FileOperation): Promise<ChangePreview> => {
    if (op.kind === "move") {
      assertInside(op.from);
      assertInside(op.to);
      return { kind: "move", path: op.from, newPath: op.to, before: null, after: null, diff: "", additions: 0, deletions: 0, binary: false };
    }
    assertInside(op.path);
    const before = files.get(op.path) ?? null;
    if (op.kind === "delete") {
      if (before === null) throw new VinnieError("not_found", `${op.path} does not exist.`);
      return { kind: "delete", path: op.path, newPath: null, before, after: null, diff: `-${before}`, additions: 0, deletions: before.split("\n").length, binary: false };
    }
    if (op.kind === "create" && before !== null) throw new VinnieError("validation", `${op.path} already exists.`);
    return {
      kind: before === null ? "create" : "modify",
      path: op.path,
      newPath: null,
      before,
      after: op.content,
      diff: `-${before ?? ""}\n+${op.content}`,
      additions: op.content.split("\n").length,
      deletions: before ? before.split("\n").length : 0,
      binary: false,
    };
  };

  const changeService: ChangeService = {
    preview,
    async apply(op, options) {
      const p = await preview(op);
      if (op.kind !== "move" && options.expectedHash && hash(files.get(op.path) ?? "") !== options.expectedHash) {
        throw new VinnieError("conflict", `${op.path} was changed outside Vinnie since it was opened.`);
      }
      if (op.kind === "write" || op.kind === "create") files.set(op.path, op.content);
      if (op.kind === "delete") files.delete(op.path);
      if (op.kind === "move") {
        if (!exists(op.from)) throw new VinnieError("not_found", `${op.from} does not exist.`);
        files.set(op.to, files.get(op.from)!);
        files.delete(op.from);
      }
      const record = {
        id: nextChange++,
        taskId: options.taskId ?? null,
        source: options.access?.actor ?? "user",
        kind: p.kind,
        path: p.path,
        newPath: p.newPath,
        description: options.description ?? null,
        status: "applied" as const,
        createdAt: Date.now(),
        revertedAt: null,
        additions: p.additions,
        deletions: p.deletions,
        before: p.before,
        after: p.after,
      };
      changes.unshift(record);
      return record;
    },
    async list() {
      return changes.map(({ before: _b, after: _a, ...r }) => r);
    },
    async detail(id) {
      const c = changes.find((x) => x.id === id);
      if (!c) throw new VinnieError("not_found", "That change no longer exists.");
      const { before, after, ...record } = c;
      return { record, before, after, diff: "", binary: false };
    },
    async revert(id) {
      const c = changes.find((x) => x.id === id);
      if (!c) throw new VinnieError("not_found", "That change no longer exists.");
      if (c.kind === "create") files.delete(c.path);
      else if (c.kind === "move") {
        files.set(c.path, files.get(c.newPath!)!);
        files.delete(c.newPath!);
      } else files.set(c.path, c.before ?? "");
      Object.assign(c, { status: "reverted", revertedAt: Date.now() });
      return c;
    },
    async revertTask(taskId) {
      const out = [];
      for (const c of changes.filter((x) => x.taskId === taskId && x.status === "applied")) {
        await changeService.revert(c.id);
        out.push({ id: c.id, path: c.path, ok: true, error: null });
      }
      return out;
    },
  };

  const search: SearchService = {
    async search(_id, query) {
      const matches = [];
      const re = new RegExp(query.regex ? query.query : query.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), query.caseSensitive ? "" : "i");
      for (const [path, content] of files) {
        if (query.mode === "filename") {
          if (re.test(path)) matches.push({ path, line: 0, column: 1, preview: path });
          continue;
        }
        content.split("\n").forEach((line, i) => {
          if (re.test(line)) matches.push({ path, line: i + 1, column: 1, preview: line.trim() });
        });
      }
      return { matches: matches.slice(0, query.maxResults ?? 200), filesSearched: files.size, truncated: false, timedOut: false, cancelled: false };
    },
    async cancel() {
      return true;
    },
  };

  return { files, changes, workspace, changeService, search };
}

/** Process fake: commands get a configurable requirement and outcome. */
export function createFakeProcess() {
  const requirements = new Map<string, Requirement>();
  const outcomes = new Map<string, Partial<ProcessOutcome> & { stdout?: string; stderr?: string }>();
  const runs: RunRequest[] = [];
  const service: ProcessService = {
    async assess(command) {
      const requirement = requirements.get(command) ?? "allowed";
      const check: CommandCheck = {
        assessment: {
          command,
          program: command.split(" ")[0]!,
          args: command.split(" ").slice(1),
          risk: requirement === "blocked" ? "blocked" : requirement === "approval" ? "approval" : "low",
          installsDependencies: /\b(install|add)\b/.test(command),
          reason: requirement === "blocked" ? "`del` can delete data, so it is blocked." : "Not on the low-risk list.",
        },
        requirement,
        alwaysAllowed: false,
        workspace: "C:\\Projects\\demo",
      };
      return check;
    },
    async run(request, onEvent: (e: ProcessEvent) => void) {
      const requirement = requirements.get(request.command) ?? "allowed";
      if (requirement === "blocked") throw new VinnieError("blocked", "Blocked by policy.");
      if (requirement === "approval" && request.actor === "assistant" && !request.approved) {
        throw new VinnieError("approval_required", "Needs approval.");
      }
      runs.push(request);
      const o = outcomes.get(request.command) ?? {};
      onEvent({ type: "started", pid: 1, programPath: "C:\\bin\\x.exe", startedAt: Date.now() });
      if (o.stdout) onEvent({ type: "stdout", text: o.stdout });
      if (o.stderr) onEvent({ type: "stderr", text: o.stderr });
      const exitCode = o.exitCode ?? 0;
      return {
        assessment: (await service.assess(request.command, request.actor)).assessment,
        outcome: {
          exitCode,
          success: o.success ?? exitCode === 0,
          timedOut: o.timedOut ?? false,
          cancelled: o.cancelled ?? false,
          durationMs: o.durationMs ?? 1200,
          startedAt: Date.now(),
          stdoutTail: o.stdout ?? "",
          stderrTail: o.stderr ?? "",
          truncated: false,
        },
      };
    },
    async cancel() {
      return true;
    },
    async allowedCommands() {
      return [];
    },
    async removeAllowedCommand() {},
  };
  return { service, requirements, outcomes, runs };
}

export function createFakeAnalysis(detections: ManagerDetection[] = []) {
  const state = { detections, metadata: null as ProjectMetadata | null };
  const service: ProjectAnalysisService = {
    analyze: async () => {
      if (!state.metadata) throw new VinnieError("no_workspace", "No project");
      return state.metadata;
    },
    cached: async () => state.metadata,
    gitStatus: async () => ({ isRepo: false, gitAvailable: true, branch: null, upstream: null, ahead: 0, behind: 0, modified: [], staged: [], untracked: [], deleted: [], truncated: false }),
    packageManagers: async () => state.detections,
    installCommand: async (manager, packages, dev) => {
      const base: Record<string, string> = { npm: "npm install", pnpm: "pnpm add", yarn: "yarn add", pip: "python -m pip install", cargo: "cargo add" };
      const display = [base[manager] ?? `${manager} install`, dev ? "-D" : "", ...packages].filter(Boolean).join(" ");
      return { manager, program: manager, args: [], display, packages };
    },
  };
  return { state, service };
}

export function installFakes(overrides: Partial<Services> = {}) {
  const provider = createFakeProvider();
  const conversations = createFakeRepository();
  const project = createFakeProject();
  const ws = createFakeWorkspace({ "README.md": "# Demo\n" });
  const process = createFakeProcess();
  const analysis = createFakeAnalysis();
  let stored: Settings = { ...DEFAULT_SETTINGS };
  const settings = {
    load: async () => stored,
    save: async (next: Settings) => {
      if (!/^https?:\/\//.test(next.ollamaEndpoint)) {
        throw new VinnieError("validation", "The Ollama endpoint must start with http:// or https://.");
      }
      stored = { ...next, ollamaEndpoint: next.ollamaEndpoint.trim().replace(/\/+$/, "") };
      return stored;
    },
  };
  const opened: string[] = [];
  const copied: string[] = [];
  const system = {
    copyText: async (text: string) => {
      copied.push(text);
    },
    appInfo: async () => ({
      name: "Vinnie",
      version: "0.1.0",
      tauriVersion: "2.x",
      os: "windows",
      arch: "x86_64",
      dataDir: "C:\\data",
      databasePath: "C:\\data\\vinnie.db",
      logDir: "C:\\logs",
    }),
    openExternalUrl: async (url: string) => {
      opened.push(url);
    },
    openLogDir: async () => {},
    launchOllama: async () => ({ status: "started" as const, executable: "C:\\Ollama\\ollama.exe" }),
  };
  setServices({
    provider,
    conversations,
    project: project.service,
    settings,
    system,
    tools: createToolRegistry(),
    workspace: ws.workspace,
    search: ws.search,
    changes: ws.changeService,
    process: process.service,
    analysis: analysis.service,
    ...overrides,
  });
  return {
    provider,
    conversations,
    project,
    settings,
    system,
    opened,
    copied,
    ws,
    process,
    analysis,
    getStoredSettings: () => stored,
  };
}
