// Chat orchestration: persists the user's message, streams the reply through
// the active AI provider, and persists the outcome. Never reports a message
// as saved unless the repository confirmed it.

import { create } from "zustand";
import { toVinnieError, VinnieError } from "@/lib/errors";
import type { ChatTurn, MessageStatus } from "@/lib/ipc/types";
import { deriveTitle } from "@/lib/titles";
import type { GenerationHandle, GenerationOutcome } from "@/providers/types";
import { getServices } from "@/services";
import { useConnectionStore } from "./connectionStore";
import { toUiMessage, useConversationStore, type UiMessage } from "./conversationStore";

export type GenerationPhase = "preparing" | "waiting" | "streaming" | "stopping";

export interface ActiveGeneration {
  conversationId: string | null;
  model: string;
  phase: GenerationPhase;
  content: string;
  thinking: string;
  startedAt: number;
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
  /** Resolves `true` once the user's message is saved and generation has started. */
  send(text: string): Promise<boolean>;
  stop(): Promise<void>;
  /** Regenerate a response for the last user message (returns once started). */
  retry(): Promise<void>;
  retrySave(localId: string): Promise<void>;
  dismissError(): void;
}

/** How often streamed tokens are flushed into React state. */
export const FLUSH_INTERVAL_MS = 40;

/** Convert stored messages into model turns, ending at the last user message. */
export function buildHistory(messages: UiMessage[]): ChatTurn[] {
  const turns = messages
    .filter((m) => m.content.trim().length > 0)
    .map((m) => ({ role: m.role, content: m.content }));
  while (turns.length > 0 && turns[turns.length - 1]?.role !== "user") turns.pop();
  return turns;
}

let activeHandle: GenerationHandle | null = null;
let stopRequested = false;

function refreshList() {
  void useConversationStore.getState().loadList();
}

export const useChatStore = create<ChatState>((set, get) => {
  const patchGeneration = (patch: Partial<ActiveGeneration>) =>
    set((s) => (s.generation ? { generation: { ...s.generation, ...patch } } : s));

  /** Save an assistant message; on failure keep it on screen marked unsaved. */
  async function persistAssistant(
    conversationId: string,
    fields: { content: string; thinking: string; status: MessageStatus; model: string; error?: string },
  ): Promise<UiMessage> {
    const { conversations } = getServices();
    try {
      const saved = await conversations.addMessage({
        conversationId,
        role: "assistant",
        content: fields.content,
        thinking: fields.thinking.trim() ? fields.thinking : null,
        status: fields.status,
        model: fields.model,
        error: fields.error ?? null,
      });
      refreshList();
      return toUiMessage(saved);
    } catch (err) {
      return {
        id: -1,
        localId: `local-${crypto.randomUUID()}`,
        conversationId,
        role: "assistant",
        content: fields.content,
        thinking: fields.thinking || null,
        status: fields.status,
        model: fields.model,
        error: fields.error ?? null,
        createdAt: Date.now(),
        unsaved: true,
        saveError: toVinnieError(err).message,
      };
    }
  }

  async function runGeneration(conversationId: string, model: string): Promise<void> {
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

    patchGeneration({ phase: "waiting", conversationId });

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

    const handle = getServices().provider.streamChat({ model, messages: history }, (event) => {
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

    const streamed = get().generation;
    const content = outcome?.content ?? streamed?.content ?? "";
    const thinking = outcome?.thinking ?? streamed?.thinking ?? "";
    const hasOutput = content.length > 0 || thinking.trim().length > 0;

    let message: UiMessage | null = null;
    if (outcome?.status === "completed") {
      message = await persistAssistant(conversationId, { content, thinking, status: "complete", model });
    } else if (hasOutput) {
      // Cancelled or failed partway: keep what was generated, clearly marked.
      message = await persistAssistant(conversationId, {
        content,
        thinking,
        status: "interrupted",
        model,
        error: failure?.message,
      });
    }

    // Apply in the same tick so the streaming bubble is replaced, not duplicated.
    if (message) useConversationStore.getState().appendMessage(conversationId, message);
    set({
      generation: null,
      error: failure ? { conversationId, error: failure, model, canRetry: true } : get().error,
    });
  }

  return {
    generation: null,
    error: null,

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
      void runGeneration(id, model).catch((err: unknown) => {
        activeHandle = null;
        set({ generation: null, error: { conversationId: id, error: toVinnieError(err), model, canRetry: true } });
      });
      return true;
    },

    async stop() {
      if (!get().generation) return;
      stopRequested = true;
      patchGeneration({ phase: "stopping" });
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
        },
      });
      void runGeneration(conversationId, model).catch((err: unknown) => {
        activeHandle = null;
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
  };
});
