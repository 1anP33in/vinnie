// Data shapes exchanged with the Rust backend. Keep in sync with the serde
// types in `src-tauri/src`.

export type Role = "user" | "assistant" | "system";
export type MessageStatus = "complete" | "interrupted" | "error";

export interface Conversation {
  id: string;
  title: string;
  model: string | null;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface Message {
  id: number;
  conversationId: string;
  role: Role;
  content: string;
  thinking: string | null;
  status: MessageStatus;
  model: string | null;
  error: string | null;
  createdAt: number;
}

export interface NewMessage {
  conversationId: string;
  role: Role;
  content: string;
  thinking?: string | null;
  status?: MessageStatus;
  model?: string | null;
  error?: string | null;
}

export interface ModelInfo {
  name: string;
  sizeBytes: number | null;
  modifiedAt: string | null;
  family: string | null;
  parameterSize: string | null;
  quantization: string | null;
}

export interface ConnectionInfo {
  endpoint: string;
  version: string;
}

export interface GenerationStats {
  doneReason: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalDurationMs: number | null;
  loadDurationMs: number | null;
  evalDurationMs: number | null;
}

export type StreamEvent =
  | { type: "started" }
  | { type: "content"; text: string }
  | { type: "thinking"; text: string }
  | { type: "done"; stats: GenerationStats };

export interface GenerationOutcome {
  status: "completed" | "cancelled";
  content: string;
  thinking: string;
  stats: GenerationStats | null;
}

export interface ChatTurn {
  role: Role;
  content: string;
}

export type Theme = "dark" | "light" | "system";
export type StartupBehavior = "newConversation" | "restoreLast";

export interface Settings {
  ollamaEndpoint: string;
  defaultModel: string | null;
  theme: Theme;
  startupBehavior: StartupBehavior;
  showReasoning: boolean;
  reduceEffects: boolean;
  sidebarCollapsed: boolean;
}

export type ProjectStatus = "available" | "missing" | "notADirectory" | "inaccessible";

export interface ProjectInfo {
  path: string;
  name: string;
  status: ProjectStatus;
}

export interface AppInfo {
  name: string;
  version: string;
  tauriVersion: string;
  os: string;
  arch: string;
  dataDir: string;
  databasePath: string;
  logDir: string | null;
}
