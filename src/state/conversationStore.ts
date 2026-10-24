import { create } from "zustand";
import { toVinnieError, type VinnieError } from "@/lib/errors";
import type { Conversation, Message } from "@/lib/ipc/types";
import { getServices } from "@/services";

/** A message as displayed. Unsaved messages exist only in memory. */
export interface UiMessage extends Message {
  localId: string;
  unsaved?: boolean;
  saveError?: string;
}

export function toUiMessage(message: Message): UiMessage {
  return { ...message, localId: `db-${message.id}` };
}

type LoadStatus = "idle" | "loading" | "loaded" | "error";

interface ConversationState {
  conversations: Conversation[];
  listStatus: LoadStatus;
  listError: VinnieError | null;
  query: string;
  results: Conversation[] | null;
  activeId: string | null;
  messages: UiMessage[];
  messagesStatus: LoadStatus;
  messagesError: VinnieError | null;
  actionError: VinnieError | null;

  loadList(): Promise<void>;
  search(query: string): Promise<void>;
  open(id: string): Promise<void>;
  startNew(): void;
  create(title: string, model: string | null): Promise<Conversation>;
  rename(id: string, title: string): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  removeAll(): Promise<number | null>;
  appendMessage(conversationId: string, message: UiMessage): void;
  replaceMessage(conversationId: string, localId: string, message: UiMessage): void;
  dismissActionError(): void;
}

let openSeq = 0;
let searchSeq = 0;

export const useConversationStore = create<ConversationState>((set, get) => {
  const rememberActive = (id: string | null) => {
    getServices()
      .conversations.setLastActive(id)
      .catch(() => {
        /* Non-critical: only affects "reopen last conversation". */
      });
  };

  return {
    conversations: [],
    listStatus: "idle",
    listError: null,
    query: "",
    results: null,
    activeId: null,
    messages: [],
    messagesStatus: "idle",
    messagesError: null,
    actionError: null,

    async loadList() {
      if (get().listStatus !== "loaded") set({ listStatus: "loading" });
      try {
        const conversations = await getServices().conversations.list();
        set({ conversations, listStatus: "loaded", listError: null });
        if (get().query.trim()) await get().search(get().query);
      } catch (err) {
        set({ listStatus: "error", listError: toVinnieError(err) });
      }
    },

    async search(query) {
      const seq = ++searchSeq;
      set({ query });
      if (!query.trim()) {
        set({ results: null });
        return;
      }
      try {
        const results = await getServices().conversations.search(query);
        if (seq === searchSeq) set({ results });
      } catch (err) {
        if (seq === searchSeq) set({ results: [], actionError: toVinnieError(err) });
      }
    },

    async open(id) {
      const seq = ++openSeq;
      set({ activeId: id, messages: [], messagesStatus: "loading", messagesError: null });
      rememberActive(id);
      try {
        const messages = await getServices().conversations.listMessages(id);
        if (seq !== openSeq) return;
        set({ messages: messages.map(toUiMessage), messagesStatus: "loaded" });
      } catch (err) {
        if (seq !== openSeq) return;
        set({ messagesStatus: "error", messagesError: toVinnieError(err) });
      }
    },

    startNew() {
      ++openSeq;
      set({ activeId: null, messages: [], messagesStatus: "idle", messagesError: null });
      rememberActive(null);
    },

    async create(title, model) {
      const conversation = await getServices().conversations.create(title, model);
      ++openSeq;
      set((s) => ({
        conversations: [conversation, ...s.conversations.filter((c) => c.id !== conversation.id)],
        activeId: conversation.id,
        messages: [],
        messagesStatus: "loaded",
        messagesError: null,
      }));
      rememberActive(conversation.id);
      return conversation;
    },

    async rename(id, title) {
      try {
        const updated = await getServices().conversations.rename(id, title);
        const swap = (list: Conversation[]) => list.map((c) => (c.id === id ? updated : c));
        set((s) => ({
          conversations: swap(s.conversations),
          results: s.results ? swap(s.results) : null,
        }));
        return true;
      } catch (err) {
        set({ actionError: toVinnieError(err) });
        return false;
      }
    },

    async remove(id) {
      try {
        await getServices().conversations.remove(id);
        set((s) => ({
          conversations: s.conversations.filter((c) => c.id !== id),
          results: s.results ? s.results.filter((c) => c.id !== id) : null,
        }));
        if (get().activeId === id) get().startNew();
        return true;
      } catch (err) {
        set({ actionError: toVinnieError(err) });
        return false;
      }
    },

    async removeAll() {
      try {
        const count = await getServices().conversations.removeAll();
        set({ conversations: [], results: get().results ? [] : null });
        get().startNew();
        return count;
      } catch (err) {
        set({ actionError: toVinnieError(err) });
        return null;
      }
    },

    appendMessage(conversationId, message) {
      if (get().activeId !== conversationId) return;
      set((s) => ({ messages: [...s.messages, message] }));
    },

    replaceMessage(conversationId, localId, message) {
      if (get().activeId !== conversationId) return;
      set((s) => ({ messages: s.messages.map((m) => (m.localId === localId ? message : m)) }));
    },

    dismissActionError() {
      set({ actionError: null });
    },
  };
});
