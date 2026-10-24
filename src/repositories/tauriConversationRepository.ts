import { commands } from "@/lib/ipc/commands";
import type { ConversationRepository } from "./types";

export function createTauriConversationRepository(): ConversationRepository {
  return {
    list: commands.listConversations,
    search: commands.searchConversations,
    create: commands.createConversation,
    rename: commands.renameConversation,
    remove: commands.deleteConversation,
    removeAll: commands.deleteAllConversations,
    listMessages: commands.listMessages,
    addMessage: commands.addMessage,
    getLastActive: commands.getLastConversation,
    setLastActive: commands.setLastConversation,
  };
}
