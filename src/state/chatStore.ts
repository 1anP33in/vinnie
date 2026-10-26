// Chat orchestration: persists the user's message, then hands the request to
// the AgentRuntime, which plans, calls tools under the permission rules,
// verifies the result, and reports what happened. This store owns the
// conversation side: persistence, the streaming display, and controls.
// Never reports a message as saved unless the repository confirmed it.

import { create } from "zustand";
import { extractKeywords, keywordPattern, type ProjectContextInput } from "@/agent/context";
import { emitDragon } from "@/agent/events";
import { permissionManager } from "@/agent/runtime/permissionManager";
import { AgentRuntime } from "@/agent/runtime/runtime";
import { toVinnieError, VinnieError } from "@/lib/errors";
import type { ChatTurn, NewMessage } from "@/lib/ipc/types";
import { deriveTitle } from "@/lib/titles";
import { getServices } from "@/services";
import { useActivityStore } from "./activityStore";
import { limitsFromSettings, useAgentStore } from "./agentStore";
import { useApprovalStore } from "./approvalStore";
import { useChangesStore } from "./changesStore";
import { useConnectionStore } from "./connectionStore";
import { toUiMessage, useConversationStore, type UiMessage } from "./conversationStore";
import { useEditorStore } from "./editorStore";
import { useProjectStore } from "./projectStore";
import { useSettingsStore } from "./settingsStore";
import { useTerminalStore } from "./terminalStore";
import { useUiStore } from "./uiStore";
import { parentOf, useWorkspaceStore } from "./workspaceStore";

export type GenerationPhase =
  | "preparing"
  | "context"
  | "waiting"
  | "streaming"
  | "tools"
  | "permission"
  | "verifying"
  | "paused"
  | "stopping";

export interface ActiveGeneration {
  conversationId: string | null;
  model: string;
  phase: GenerationPhase;
  content: string;
  thinking: string;
  startedAt: number;
  /** Description of the tool currently running, if any. */
  toolLabel: string | null;
  /** The agent task handling this request. */
  taskId: string | null;
}

export interface ChatError {
  conversationId: string | null;
  error: VinnieError;
  model: string | null;
  /** Whether "Retry" can regenerate a response for the last user message. */
  canRetry: boolean;
}

interface ChatState {
  generation: ActiveGeneration | null;
  error: ChatError | null;
  /** Shown when tools were turned off for this model. */
  notice: string | null;
  /** Resolves `true` once the user's message is saved and generation has started. */
  send(text: string): Promise<boolean>;
  stop(): Promise<void>;
  /** Regenerate a response for the last user message (returns once started). */
  retry(): Promise<void>;
  retrySave(localId: string): Promise<void>;
  dismissError(): void;
  dismissNotice(): void;
}

/** How often streamed tokens are flushed into React state. */
export const FLUSH_INTERVAL_MS = 40;

/** Convert stored messages into model turns, ending at the last user message. */
export function buildHistory(messages: UiMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const m of messages) {
    if (m.role === "tool") {
      turns.push({ role: "tool", content: m.content, ...(m.toolName ? { tool_name: m.toolName } : {}) });
      continue;
    }
    const hasCalls = (m.toolCalls?.length ?? 0) > 0;
    if (!m.content.trim() && !hasCalls) continue;
    turns.push({ role: m.role, content: m.content, ...(hasCalls ? { tool_calls: m.toolCalls! } : {}) });
  }
  while (turns.length > 0 && turns[turns.length - 1]?.role !== "user") turns.pop();
  // A tool result must follow the assistant call that requested it.
  return turns.filter((t, i) => t.role !== "tool" || turns.slice(0, i).some((p) => p.tool_calls?.length));
}

let activeRuntime: AgentRuntime | null = null;
let stopRequested = false;
const runIds = new Set<string>();

function refreshList() {
  void useConversationStore.getState().loadList();
}

/** Gather the compact project context for this request. */
async function gatherContext(userText: string): Promise<ProjectContextInput | null> {
  const settings = useSettingsStore.getState().settings;
  const project = useProjectStore.getState().project;
  if (!project || project.status !== "available" || !settings.projectContextEnabled) return null;
  if (settings.permissions.read === "denied") return null;
  const services = getServices();
  const activityId = useActivityStore.getState().start("read", "Gathering project context");
  const access = { actor: "assistant" as const, approved: false };
  const [tree, relevant] = await Promise.all([
    services.workspace.tree({ maxDepth: 2, maxEntries: 150, access }).catch(() => null),
    (async () => {
      const pattern = keywordPattern(extractKeywords(userText));
      if (!pattern) return [];
      const results = await services.search
        .search(crypto.randomUUID(), { query: pattern, mode: "filename", regex: true, maxResults: 10 }, access)
        .catch(() => null);
      return results?.matches.map((m) => m.path) ?? [];
    })(),
  ]);
  const editor = useEditorStore.getState();
  const active = editor.tabs.find((t) => t.id === editor.activeId);
  const activeFile =
    active?.kind === "file" && active.draft != null ? { path: active.path, content: active.draft } : null;
  useActivityStore
    .getState()
    .finish(
      activityId,
      "success",
      [tree ? "project tree" : null, relevant.length ? `${relevant.length} matching files` : null, activeFile?.path]
        .filter(Boolean)
        .join(" · ") || "summary only",
    );
  return {
    projectName: project.name,
    root: project.path,
    metadata: useWorkspaceStore.getState().metadata,
    tree: tree?.text ?? null,
    activeFile,
    relevantFiles: relevant,
  };
}

export const useChatStore = create<ChatState>((set, get) => {
  const patchGeneration = (patch: Partial<ActiveGeneration>) =>
    set((s) => (s.generation ? { generation: { ...s.generation, ...patch } } : s));

  /** Save a message; on failure keep it on screen marked unsaved. */
  async function persist(message: NewMessage): Promise<UiMessage> {
    try {
      const saved = await getServices().conversations.addMessage(message);
      refreshList();
      return toUiMessage(saved);
    } catch (err) {
      return {
        id: -1,
        localId: `local-${crypto.randomUUID()}`,
        conversationId: message.conversationId,
        role: message.role,
        content: message.content,
        thinking: message.thinking ?? null,
        status: message.status ?? "complete",
        model: message.model ?? null,
        error: message.error ?? null,
        toolCalls: message.toolCalls ?? null,
        toolName: message.toolName ?? null,
        createdAt: Date.now(),
        unsaved: true,
        saveError: toVinnieError(err).message,
      };
    }
  }

  /** Streams model output into the generation bubble, batched for React. */
  function createStreamSink() {
    let pendingContent = "";
    let pendingThinking = "";
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      if (!pendingContent && !pendingThinking) return;
      const content = pendingContent;
      const thinking = pendingThinking;
      pendingContent = "";
      pendingThinking = "";
      set((s) =>
        s.generation
          ? {
              generation: {
                ...s.generation,
                content: s.generation.content + content,
                thinking: s.generation.thinking + thinking,
              },
            }
          : s,
      );
    };
    const schedule = () => {
      timer ??= setTimeout(flush, FLUSH_INTERVAL_MS);
    };
    const markStreaming = () => {
      const phase = get().generation?.phase;
      if (phase === "waiting" || phase === "context") patchGeneration({ phase: "streaming" });
    };
    return {
      reset() {
        if (timer) clearTimeout(timer);
        timer = null;
        pendingContent = "";
        pendingThinking = "";
        patchGeneration({ phase: "waiting", content: "", thinking: "", toolLabel: null });
      },
      started: markStreaming,
      content(text: string) {
        pendingContent += text;
        markStreaming();
        schedule();
      },
      thinking(text: string) {
        pendingThinking += text;
        markStreaming();
        schedule();
      },
      flush() {
        if (timer) clearTimeout(timer);
        flush();
      },
    };
  }

  async function runGeneration(conversationId: string, model: string, userText: string): Promise<void> {
    if (stopRequested) {
      set({ generation: null });
      return;
    }
    const convs = useConversationStore.getState();
    const source =
      convs.activeId === conversationId
        ? convs.messages
        : (await getServices().conversations.listMessages(conversationId)).map(toUiMessage);
    const history = buildHistory(source);
    // The runtime adds the request itself.
    if (history.at(-1)?.role === "user" && history.at(-1)?.content === userText) history.pop();

    patchGeneration({ phase: "context", conversationId });
    const context = await gatherContext(userText);
    if (stopRequested) {
      set({ generation: null });
      return;
    }
    const settings = useSettingsStore.getState().settings;
    const project = useProjectStore.getState().project;
    const sink = createStreamSink();
    const append = (m: UiMessage) => useConversationStore.getState().appendMessage(conversationId, m);

    const runtime = new AgentRuntime(
      {
        provider: getServices().provider,
        registry: getServices().tools,
        services: getServices(),
        permissions: permissionManager,
        settings: () => useSettingsStore.getState().settings,
        prompt: (request, signal) => useApprovalStore.getState().request(request, signal),
        runCommand: async (request) => {
          useUiStore.getState().showBottom("terminal");
          const before = new Set(useTerminalStore.getState().runs.map((r) => r.id));
          const promise = useTerminalStore.getState().run({ ...request, actor: "assistant" });
          const started = useTerminalStore.getState().runs.find((r) => !before.has(r.id));
          if (started) runIds.add(started.id);
          return promise;
        },
        stopCommands: () => {
          const terminal = useTerminalStore.getState();
          for (const run of terminal.runs) {
            if (run.status === "running" && runIds.has(run.id)) void terminal.stop(run.id);
          }
        },
        filesChanged: (paths) => {
          void useEditorStore.getState().filesChanged(paths);
          const ws = useWorkspaceStore.getState();
          for (const dir of new Set(paths.map(parentOf))) void ws.loadDir(dir);
          void ws.refreshGit();
          void useChangesStore.getState().refresh();
        },
        projectChanged: () => void useWorkspaceStore.getState().analyze(),
        metadata: () => useWorkspaceStore.getState().metadata,
        refreshMetadata: async () => {
          await useWorkspaceStore.getState().analyze();
          return useWorkspaceStore.getState().metadata;
        },
        persist: async (message) => {
          sink.flush();
          const saved = await persist(message);
          // Show the saved message and clear the live bubble in the same tick.
          append(saved);
          patchGeneration({ content: "", thinking: "" });
        },
        stream: sink,
        modelContextLength: async (m) => (await getServices().provider.modelDetails(m)).contextLength,
        onUpdate: (task) => {
          useAgentStore.getState().update(task);
          const running = [...task.steps].reverse().find((s) => s.status === "running");
          switch (task.status) {
            case "executing":
              patchGeneration({ phase: "tools", toolLabel: running?.title ?? null });
              break;
            case "waiting_for_permission":
              patchGeneration({ phase: "permission", toolLabel: "Waiting for your approval" });
              break;
            case "verifying":
              patchGeneration({ phase: "verifying", toolLabel: running?.title ?? "Verifying changes" });
              break;
            case "paused":
              patchGeneration({ phase: "paused", toolLabel: "Paused" });
              break;
            default:
              break;
          }
        },
        notice: (text) => set({ notice: text }),
      },
      {
        conversationId,
        request: userText,
        model,
        history,
        project: context,
        workspaceRoot: project?.status === "available" ? project.path : null,
        mode: settings.agent.mode,
        limits: limitsFromSettings(settings.agent),
        autoVerify: settings.agent.autoVerify,
        toolsEnabled: settings.toolsEnabled,
      },
    );
    activeRuntime = runtime;
    useAgentStore.getState().begin(runtime);
    patchGeneration({ taskId: runtime.task.id });

    const task = await runtime.run();
    activeRuntime = null;
    runIds.clear();
    useAgentStore.getState().end(task.id);
    useApprovalStore.getState().denyAll();
    const modelError = runtime.modelError;
    set({
      generation: null,
      error: modelError ? { conversationId, error: modelError, model, canRetry: true } : get().error,
    });
    if (task.status === "cancelled") emitDragon("idle", "Idle");
  }

  return {
    generation: null,
    error: null,
    notice: null,

    async send(text) {
      const content = text.trim();
      if (!content || get().generation) return false;

      const convs = useConversationStore.getState();
      const model = useConnectionStore.getState().selectedModel;
      if (!model) {
        set({
          error: {
            conversationId: convs.activeId,
            error: new VinnieError("validation", "Choose a model before sending a message."),
            model: null,
            canRetry: false,
          },
        });
        return false;
      }

      stopRequested = false;
      set({
        error: null,
        generation: {
          conversationId: convs.activeId,
          model,
          phase: "preparing",
          content: "",
          thinking: "",
          startedAt: Date.now(),
          toolLabel: null,
          taskId: null,
        },
      });

      let conversationId = convs.activeId;
      let createdHere = false;
      try {
        if (!conversationId) {
          conversationId = (await convs.create(deriveTitle(content), model)).id;
          createdHere = true;
          patchGeneration({ conversationId });
        }
        const saved = await getServices().conversations.addMessage({
          conversationId,
          role: "user",
          content,
          status: "complete",
        });
        useConversationStore.getState().appendMessage(conversationId, toUiMessage(saved));
      } catch (err) {
        if (createdHere && conversationId) {
          // Don't leave an empty conversation behind for a message that wasn't saved.
          void useConversationStore.getState().remove(conversationId);
        }
        set({
          generation: null,
          error: { conversationId, error: toVinnieError(err), model, canRetry: false },
        });
        return false;
      }

      refreshList();
      const id = conversationId;
      void runGeneration(id, model, content).catch((err: unknown) => {
        activeRuntime = null;
        set({ generation: null, error: { conversationId: id, error: toVinnieError(err), model, canRetry: true } });
      });
      return true;
    },

    async stop() {
      if (!get().generation) return;
      stopRequested = true;
      patchGeneration({ phase: "stopping" });
      useApprovalStore.getState().denyAll();
      activeRuntime?.cancel();
    },

    async retry() {
      const conversationId = useConversationStore.getState().activeId;
      if (get().generation || !conversationId) return;
      const model = useConnectionStore.getState().selectedModel ?? get().error?.model ?? null;
      if (!model) {
        set({
          error: {
            conversationId,
            error: new VinnieError("validation", "Choose a model before retrying."),
            model: null,
            canRetry: true,
          },
        });
        return;
      }
      const lastUser = [...useConversationStore.getState().messages].reverse().find((m) => m.role === "user");
      stopRequested = false;
      set({
        error: null,
        generation: {
          conversationId,
          model,
          phase: "waiting",
          content: "",
          thinking: "",
          startedAt: Date.now(),
          toolLabel: null,
          taskId: null,
        },
      });
      void runGeneration(conversationId, model, lastUser?.content ?? "").catch((err: unknown) => {
        activeRuntime = null;
        set({ generation: null, error: { conversationId, error: toVinnieError(err), model, canRetry: true } });
      });
    },

    async retrySave(localId) {
      const convs = useConversationStore.getState();
      const message = convs.messages.find((m) => m.localId === localId);
      if (!message?.unsaved) return;
      try {
        const saved = await getServices().conversations.addMessage({
          conversationId: message.conversationId,
          role: message.role,
          content: message.content,
          thinking: message.thinking,
          status: message.status,
          model: message.model,
          error: message.error,
          toolCalls: message.toolCalls,
          toolName: message.toolName,
        });
        convs.replaceMessage(message.conversationId, localId, toUiMessage(saved));
        refreshList();
      } catch (err) {
        convs.replaceMessage(message.conversationId, localId, {
          ...message,
          saveError: toVinnieError(err).message,
        });
      }
    },

    dismissError() {
      set({ error: null });
    },

    dismissNotice() {
      set({ notice: null });
    },
  };
});
