// Typed wrappers around the backend commands. This is the only module that
// talks to Tauri directly; everything else goes through the provider,
// repository, and service interfaces.

import { Channel, invoke } from "@tauri-apps/api/core";
import { toVinnieError } from "@/lib/errors";
import type {
  AppInfo,
  ChatTurn,
  ConnectionInfo,
  Conversation,
  GenerationOutcome,
  Message,
  ModelInfo,
  NewMessage,
  ProjectInfo,
  Settings,
  StreamEvent,
} from "./types";

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (err) {
    throw toVinnieError(err);
  }
}

export const commands = {
  getAppInfo: () => call<AppInfo>("get_app_info"),
  openExternalUrl: (url: string) => call<void>("open_external_url", { url }),
  copyText: (text: string) => call<void>("copy_text", { text }),

  getSettings: () => call<Settings>("get_settings"),
  saveSettings: (settings: Settings) => call<Settings>("save_settings", { settings }),

  checkConnection: (endpoint?: string) =>
    call<ConnectionInfo>("check_connection", { endpoint: endpoint ?? null }),
  listModels: (endpoint?: string) => call<ModelInfo[]>("list_models", { endpoint: endpoint ?? null }),
  chatStream: (
    request: { requestId: string; model: string; messages: ChatTurn[] },
    onEvent: (event: StreamEvent) => void,
  ) => {
    const channel = new Channel<StreamEvent>();
    channel.onmessage = onEvent;
    return call<GenerationOutcome>("chat_stream", { request, onEvent: channel });
  },
  cancelGeneration: (requestId: string) => call<boolean>("cancel_generation", { requestId }),

  listConversations: () => call<Conversation[]>("list_conversations"),
  searchConversations: (query: string) => call<Conversation[]>("search_conversations", { query }),
  createConversation: (title: string, model: string | null) =>
    call<Conversation>("create_conversation", { title, model }),
  renameConversation: (id: string, title: string) =>
    call<Conversation>("rename_conversation", { id, title }),
  deleteConversation: (id: string) => call<void>("delete_conversation", { id }),
  deleteAllConversations: () => call<number>("delete_all_conversations"),
  listMessages: (conversationId: string) => call<Message[]>("list_messages", { conversationId }),
  addMessage: (message: NewMessage) => call<Message>("add_message", { message }),
  setLastConversation: (id: string | null) => call<void>("set_last_conversation", { id }),
  getLastConversation: () => call<string | null>("get_last_conversation"),

  getProject: () => call<ProjectInfo | null>("get_project"),
  pickProjectFolder: () => call<ProjectInfo | null>("pick_project_folder"),
  clearProject: () => call<void>("clear_project"),
};
