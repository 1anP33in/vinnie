import type { Conversation, Message, NewMessage } from "@/lib/ipc/types";

export type { Conversation, Message, NewMessage };

/** Persistence for conversations and messages. */
export interface ConversationRepository {
  list(): Promise<Conversation[]>;
  search(query: string): Promise<Conversation[]>;
  create(title: string, model: string | null): Promise<Conversation>;
  rename(id: string, title: string): Promise<Conversation>;
  remove(id: string): Promise<void>;
  removeAll(): Promise<number>;
  listMessages(conversationId: string): Promise<Message[]>;
  addMessage(message: NewMessage): Promise<Message>;
  getLastActive(): Promise<string | null>;
  setLastActive(id: string | null): Promise<void>;
}
