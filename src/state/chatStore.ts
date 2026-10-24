// Chat orchestration: persists the user's message, streams the reply through
// the active AI provider, runs any tools the model requests (through the
// tool registry, permissions, and approvals), and persists every step.
// Never reports a message as saved unless the repository confirmed it.
//
// Tool use is a controlled, bounded cycle — the model requests a tool, the
// app executes it according to permissions, the result goes back to the
// model — not an autonomous planning loop.

import { create } from "zustand";
import { buildSystemPrompt, extractKeywords, keywordPattern, type ProjectContextInput } from "@/agent/context";
import { emitDragon } from "@/agent/events";
import { extractTextToolCalls } from "@/agent/textToolCalls";
import type { ToolContext } from "@/agent/types";
import { toVinnieError, VinnieError } from "@/lib/errors";
import type { ChatTurn, MessageStatus, NewMessage, ToolCall } from "@/lib/ipc/types";
import { deriveTitle } from "@/lib/titles";
import type { GenerationHandle, GenerationOutcome } from "@/providers/types";
import { getServices } from "@/services";
import { useActivityStore } from "./activityStore";
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

export type GenerationPhase = "preparing" | "context" | "waiting" | "streaming" | "tools" | "stopping";

export interface ActiveGeneration {
  conversationId: string | null;
  model: string;
  phase: GenerationPhase;
  content: string;
  thinking: string;
  startedAt: number;
  /** Description of the tool currently running, if any. */
  toolLabel: string | null;
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
/** Upper bound on tool rounds per user message. */
export const MAX_TOOL_ROUNDS = 8;

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

function toolArgs(call: ToolCall): unknown {
  return call.function?.arguments ?? {};
}

let activeHandle: GenerationHandle | null = null;
let activeAbort: AbortController | null = null;
let stopRequested = false;

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

  function assistantMessage(
    conversationId: string,
    fields: { content: string; thinking: string; status: MessageStatus; model: string; error?: string; toolCalls?: ToolCall[] },
  ): NewMessage {
    return {
      conversationId,
      role: "assistant",
      content: fields.content,
      thinking: fields.thinking.trim() ? fields.thinking : null,
      status: fields.status,
      model: fields.model,
      error: fields.error ?? null,
      toolCalls: fields.toolCalls?.length ? fields.toolCalls : null,
    };
  }

  /** Stream one model response. */
  async function streamOnce(
    model: string,
    messages: ChatTurn[],
    tools: object[] | undefined,
  ): Promise<{ outcome: GenerationOutcome | null; failure: VinnieError | null }> {
    patchGeneration({ phase: "waiting", content: "", thinking: "", toolLabel: null });
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
      if (get().generation?.phase === "waiting") patchGeneration({ phase: "streaming" });
    };

    const handle = getServices().provider.streamChat({ model, messages, tools }, (event) => {
      switch (event.type) {
        case "started":
          markStreaming();
          break;
        case "content":
          pendingContent += event.text;
          markStreaming();
          schedule();
          break;
        case "thinking":
          pendingThinking += event.text;
          markStreaming();
          schedule();
          break;
        case "done":
          break;
      }
    });
    activeHandle = handle;
    if (stopRequested) void handle.cancel();

    let outcome: GenerationOutcome | null = null;
    let failure: VinnieError | null = null;
    try {
      outcome = await handle.result;
    } catch (err) {
      failure = toVinnieError(err);
    }
    if (timer) clearTimeout(timer);
    flush();
    activeHandle = null;
    return { outcome, failure };
  }

  function toolContext(taskId: string, controller: AbortController): ToolContext {
    const project = useProjectStore.getState().project;
    return {
      taskId,
      signal: controller.signal,
      services: getServices(),
      permissions: useSettingsStore.getState().settings.permissions,
      workspaceRoot: project?.path ?? "",
      requestApproval: (request) => useApprovalStore.getState().request(request, controller.signal),
      runCommand: (request) => {
        useUiStore.getState().showBottom("terminal");
        return useTerminalStore.getState().run({ ...request, actor: "assistant" });
      },
      filesChanged: (paths) => {
        void useEditorStore.getState().filesChanged(paths);
        const ws = useWorkspaceStore.getState();
        for (const dir of new Set(paths.map(parentOf))) void ws.loadDir(dir);
        void ws.refreshGit();
        void useChangesStore.getState().refresh();
      },
      projectChanged: () => void useWorkspaceStore.getState().analyze(),
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
    if (history.length === 0) {
      set({ generation: null });
      return;
    }

    emitDragon("thinking", `${model} is thinking…`);
    const settings = useSettingsStore.getState().settings;
    const project = useProjectStore.getState().project;
    const registry = getServices().tools;
    let toolsOn = settings.toolsEnabled && project?.status === "available" && registry.list().length > 0;

    patchGeneration({ phase: "context", conversationId });
    const context = await gatherContext(userText);
    const taskId = crypto.randomUUID();
    const controller = new AbortController();
    activeAbort = controller;
    const ctx = toolContext(taskId, controller);
    const append = (m: UiMessage) => useConversationStore.getState().appendMessage(conversationId, m);

    let failure: VinnieError | null = null;
    for (let round = 0; ; round++) {
      if (stopRequested) break;
      const system: ChatTurn = { role: "system", content: buildSystemPrompt(context, toolsOn) };
      const { outcome, failure: streamFailure } = await streamOnce(
        model,
        [system, ...history],
        toolsOn ? registry.specs() : undefined,
      );

      if (streamFailure?.kind === "tools_unsupported" && toolsOn) {
        toolsOn = false;
        set({ notice: `${model} doesn't support tools, so Vinnie answered without project tools this time.` });
        round--;
        continue;
      }

      const streamed = get().generation;
      let content = outcome?.content ?? streamed?.content ?? "";
      const thinking = outcome?.thinking ?? streamed?.thinking ?? "";
      let calls = toolsOn ? (outcome?.toolCalls ?? []) : [];
      if (toolsOn && calls.length === 0 && outcome?.status === "completed") {
        const recovered = extractTextToolCalls(content, new Set(registry.list().map((t) => t.name)));
        if (recovered.length > 0) {
          calls = recovered;
          content = "";
        }
      }
      const hasOutput = content.length > 0 || thinking.trim().length > 0 || calls.length > 0;

      if (outcome?.status === "completed") {
        append(await persist(assistantMessage(conversationId, { content, thinking, status: "complete", model, toolCalls: calls })));
      } else if (hasOutput) {
        // Cancelled or failed partway: keep what was generated, clearly marked.
        append(
          await persist(
            assistantMessage(conversationId, {
              content,
              thinking,
              status: "interrupted",
              model,
              error: streamFailure?.message,
            }),
          ),
        );
      }
      patchGeneration({ content: "", thinking: "" });

      if (streamFailure) {
        failure = streamFailure;
        break;
      }
      if (outcome?.status !== "completed" || calls.length === 0) break;
      if (round >= MAX_TOOL_ROUNDS) {
        failure = new VinnieError(
          "busy",
          `Stopped after ${MAX_TOOL_ROUNDS} rounds of tool use. Ask Vinnie to continue if more steps are needed.`,
        );
        break;
      }

      history.push({ role: "assistant", content, tool_calls: calls });
      for (const call of calls) {
        const name = call.function?.name ?? "";
        const tool = registry.get(name);
        let resultText: string;
        if (stopRequested) {
          resultText = "Error: the user stopped this request before the tool ran.";
        } else {
          const label = tool ? safeDescribe(tool.describe, toolArgs(call), name) : `Calling ${name}`;
          patchGeneration({ phase: "tools", toolLabel: label });
          const activityId = useActivityStore.getState().start(tool?.activityKind ?? "error", label);
          const result = await registry.execute(name, toolArgs(call), ctx);
          resultText = result.ok ? result.content : `Error: ${result.error}`;
          useActivityStore
            .getState()
            .finish(
              activityId,
              result.ok ? "success" : result.kind === "denied" ? "denied" : "error",
              result.ok ? firstLine(result.content) : result.error,
            );
        }
        append(
          await persist({
            conversationId,
            role: "tool",
            content: resultText,
            toolName: /^[A-Za-z0-9_]{1,64}$/.test(name) ? name : null,
            status: "complete",
          }),
        );
        history.push({ role: "tool", content: resultText, ...(name ? { tool_name: name } : {}) });
      }
      emitDragon("thinking", `${model} is reviewing the results…`);
    }

    activeAbort = null;
    useApprovalStore.getState().denyAll();
    set({
      generation: null,
      error: failure ? { conversationId, error: failure, model, canRetry: failure.kind !== "busy" } : get().error,
    });
    if (failure) emitDragon("error", failure.message);
    else if (!stopRequested) emitDragon("success", "Response complete");
    else emitDragon("idle", "Idle");
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
        activeHandle = null;
        activeAbort = null;
        set({ generation: null, error: { conversationId: id, error: toVinnieError(err), model, canRetry: true } });
      });
      return true;
    },

    async stop() {
      if (!get().generation) return;
      stopRequested = true;
      patchGeneration({ phase: "stopping" });
      activeAbort?.abort();
      useApprovalStore.getState().denyAll();
      const terminal = useTerminalStore.getState();
      for (const run of terminal.runs) {
        if (run.status === "running" && run.actor === "assistant") void terminal.stop(run.id);
      }
      if (activeHandle) await activeHandle.cancel();
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
        },
      });
      void runGeneration(conversationId, model, lastUser?.content ?? "").catch((err: unknown) => {
        activeHandle = null;
        activeAbort = null;
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

function safeDescribe(describe: (input: never) => string, args: unknown, name: string): string {
  try {
    const parsed = typeof args === "string" ? JSON.parse(args) : args;
    return describe(parsed as never);
  } catch {
    return `Calling ${name}`;
  }
}

function firstLine(text: string): string {
  const line = text.split("\n", 1)[0] ?? "";
  return line.length > 160 ? `${line.slice(0, 160)}…` : line;
}
