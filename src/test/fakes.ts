// In-memory fakes for every service so tests never need Tauri or Ollama.

import { createToolRegistry } from "@/agent/toolRegistry";
import { VinnieError } from "@/lib/errors";
import type {
  ChatTurn,
  Conversation,
  GenerationOutcome,
  Message,
  ModelInfo,
  NewMessage,
  ProjectInfo,
  Settings,
  StreamEvent,
} from "@/lib/ipc/types";
import type { AIProvider } from "@/providers/types";
import type { ConversationRepository } from "@/repositories/types";
import { setServices, type Services } from "@/services";
import { DEFAULT_SETTINGS } from "@/settings/validation";
import { useChatStore } from "@/state/chatStore";
import { useConnectionStore } from "@/state/connectionStore";
import { useConversationStore } from "@/state/conversationStore";
import { useProjectStore } from "@/state/projectStore";
import { useSettingsStore } from "@/state/settingsStore";
import { useUiStore } from "@/state/uiStore";

// Snapshot pristine store states (including actions) at import time.
const initialStates = [
  [useChatStore, useChatStore.getState()],
  [useConnectionStore, useConnectionStore.getState()],
  [useConversationStore, useConversationStore.getState()],
  [useProjectStore, useProjectStore.getState()],
  [useSettingsStore, useSettingsStore.getState()],
  [useUiStore, useUiStore.getState()],
] as const;

export function resetStores() {
  for (const [store, state] of initialStates) {
    (store as { setState(s: unknown, replace: true): void }).setState(state, true);
  }
}

/** A scripted generation that tests drive step by step. */
export class FakeStream {
  content = "";
  thinking = "";
  cancelled = false;
  readonly result: Promise<GenerationOutcome>;
  private resolve!: (o: GenerationOutcome) => void;
  private reject!: (e: unknown) => void;

  constructor(
    readonly model: string,
    readonly messages: ChatTurn[],
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

  complete() {
    this.resolve({ status: "completed", content: this.content, thinking: this.thinking, stats: null });
  }

  cancel() {
    this.cancelled = true;
    this.resolve({ status: "cancelled", content: this.content, thinking: this.thinking, stats: null });
  }

  fail(error: VinnieError) {
    this.reject(error);
  }
}

export interface FakeProvider extends AIProvider {
  streams: FakeStream[];
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
    connectionError: null,
    async checkConnection(endpoint) {
      if (provider.connectionError) throw provider.connectionError;
      return { endpoint: endpoint ?? "http://localhost:11434", version: "0.0.0-test" };
    },
    async listModels() {
      if (provider.connectionError) throw provider.connectionError;
      return provider.models;
    },
    streamChat(request, onEvent) {
      const stream = new FakeStream(request.model, request.messages, onEvent);
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

export function installFakes(overrides: Partial<Services> = {}) {
  const provider = createFakeProvider();
  const conversations = createFakeRepository();
  const project = createFakeProject();
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
  };
  setServices({
    provider,
    conversations,
    project: project.service,
    settings,
    system,
    tools: createToolRegistry(),
    ...overrides,
  });
  return { provider, conversations, project, settings, opened, copied, getStoredSettings: () => stored };
}
