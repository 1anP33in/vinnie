// Typed wrappers around the backend commands. This is the only module that
// talks to Tauri directly; everything else goes through the provider,
// repository, and service interfaces.

import { Channel, invoke } from "@tauri-apps/api/core";
import { toVinnieError } from "@/lib/errors";
import type {
  Access,
  Actor,
  AllowedCommand,
  ApplyOptions,
  ChangeDetail,
  ChangePreview,
  ChangeRecord,
  CommandCheck,
  DirListing,
  FileContent,
  FileOperation,
  FileVersion,
  GitStatus,
  InstallCommand,
  ManagerDetection,
  ProcessEvent,
  ProjectMetadata,
  ProjectTree,
  RevertOutcome,
  RunRequest,
  RunResult,
  SearchQuery,
  SearchResults,
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
  openLogDir: () => call<void>("open_log_dir"),

  getSettings: () => call<Settings>("get_settings"),
  saveSettings: (settings: Settings) => call<Settings>("save_settings", { settings }),

  checkConnection: (endpoint?: string) =>
    call<ConnectionInfo>("check_connection", { endpoint: endpoint ?? null }),
  listModels: (endpoint?: string) => call<ModelInfo[]>("list_models", { endpoint: endpoint ?? null }),
  chatStream: (
    request: { requestId: string; model: string; messages: ChatTurn[]; tools?: object[] },
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

  listDir: (path: string) => call<DirListing>("ws_list_dir", { path }),
  projectTree: (opts: { path?: string; maxDepth?: number; maxEntries?: number; access?: Access }) =>
    call<ProjectTree>("ws_project_tree", {
      path: opts.path ?? null,
      maxDepth: opts.maxDepth ?? null,
      maxEntries: opts.maxEntries ?? null,
      access: opts.access ?? null,
    }),
  readFile: (path: string, access?: Access) => call<FileContent>("ws_read_file", { path, access: access ?? null }),
  statFile: (path: string) => call<FileVersion>("ws_stat_file", { path }),
  createDir: (path: string, access?: Access) => call<void>("ws_create_dir", { path, access: access ?? null }),
  previewChange: (operation: FileOperation) => call<ChangePreview>("ws_preview_change", { operation }),
  applyChange: (operation: FileOperation, options: ApplyOptions) =>
    call<ChangeRecord>("ws_apply_change", { operation, options }),
  search: (searchId: string, query: SearchQuery, access?: Access) =>
    call<{ searchId: string; results: SearchResults }>("ws_search", { searchId, query, access: access ?? null }),
  cancelSearch: (searchId: string) => call<boolean>("ws_cancel_search", { searchId }),

  listChanges: (path?: string, limit?: number) =>
    call<ChangeRecord[]>("changes_list", { path: path ?? null, limit: limit ?? null }),
  changeDetail: (id: number) => call<ChangeDetail>("changes_detail", { id }),
  revertChange: (id: number, force = false) => call<ChangeRecord>("changes_revert", { id, force }),
  revertTask: (taskId: string, force = false) => call<RevertOutcome[]>("changes_revert_task", { taskId, force }),

  assessCommand: (command: string, actor: Actor) => call<CommandCheck>("assess_command", { command, actor }),
  runCommand: (request: RunRequest, onEvent: (event: ProcessEvent) => void) => {
    const channel = new Channel<ProcessEvent>();
    channel.onmessage = onEvent;
    return call<RunResult>("run_command", { request, onEvent: channel });
  },
  cancelCommand: (runId: string) => call<boolean>("cancel_command", { runId }),
  listAllowedCommands: () => call<AllowedCommand[]>("allowlist_list"),
  removeAllowedCommand: (command: string) => call<void>("allowlist_remove", { command }),

  analyzeProject: () => call<ProjectMetadata>("analyze_project"),
  getProjectMetadata: () => call<ProjectMetadata | null>("get_project_metadata"),
  gitStatus: () => call<GitStatus>("git_status"),
  detectPackageManagers: () => call<ManagerDetection[]>("detect_package_managers"),
  buildInstallCommand: (manager: string, packages: string[], dev = false) =>
    call<InstallCommand>("build_install_command", { manager, packages, dev }),
};

