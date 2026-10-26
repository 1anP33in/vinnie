// Data shapes exchanged with the Rust backend. Keep in sync with the serde
// types in `src-tauri/src`.

export type Role = "user" | "assistant" | "system" | "tool";
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
  /** Tool calls requested by an assistant message (Ollama format). */
  toolCalls: ToolCall[] | null;
  /** For `tool` messages: which tool produced the content. */
  toolName: string | null;
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
  toolCalls?: ToolCall[] | null;
  toolName?: string | null;
}

/** A tool call as produced by Ollama: `{ function: { name, arguments } }`. */
export interface ToolCall {
  id?: string;
  function: { name: string; arguments: Record<string, unknown> | string; index?: number };
}

export interface ModelInfo {
  name: string;
  sizeBytes: number | null;
  modifiedAt: string | null;
  family: string | null;
  parameterSize: string | null;
  quantization: string | null;
}

export interface ModelDetails {
  name: string;
  contextLength: number | null;
  capabilities: string[];
}

export interface LaunchResult {
  status: "started" | "alreadyRunning";
  executable: string | null;
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
  toolCalls: ToolCall[];
}

/** A message sent to the model. Field names follow Ollama's API. */
export interface ChatTurn {
  role: Role;
  content: string;
  tool_calls?: ToolCall[];
  tool_name?: string;
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
  permissions: PermissionSettings;
  ignoredDirectories: string[];
  toolsEnabled: boolean;
  projectContextEnabled: boolean;
  agent: AgentSettings;
}

export type AgentModeSetting = "ask" | "assist" | "agent";

export interface AgentSettings {
  mode: AgentModeSetting;
  maxIterations: number;
  maxToolCalls: number;
  maxRetries: number;
  commandTimeoutSecs: number;
  taskTimeoutMins: number;
  maxChangedFiles: number;
  /** Tokens; 0 = automatic. */
  contextBudget: number;
  autoVerify: boolean;
  debugView: boolean;
}

export type PermissionLevel = "allowed" | "approval" | "denied";

export interface PermissionSettings {
  read: PermissionLevel;
  write: PermissionLevel;
  execute: PermissionLevel;
  installDependencies: PermissionLevel;
}

export type Actor = "user" | "assistant";

export interface Access {
  actor: Actor;
  /** The user approved this specific request in the approval UI. */
  approved: boolean;
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

// ---- Workspace -------------------------------------------------------------

export type EntryKind = "file" | "directory" | "link";

export interface DirEntry {
  name: string;
  path: string;
  kind: EntryKind;
  size: number | null;
  ignored: boolean;
}

export interface DirListing {
  path: string;
  entries: DirEntry[];
  truncated: boolean;
}

export interface FileVersion {
  size: number;
  modifiedMs: number;
  hash: string;
}

export interface FileContent {
  path: string;
  content: string | null;
  binary: boolean;
  tooLarge: boolean;
  version: FileVersion;
}

export interface ProjectTree {
  text: string;
  entries: number;
  truncated: boolean;
}

export type FileOperation =
  | { kind: "write"; path: string; content: string }
  | { kind: "create"; path: string; content: string }
  | { kind: "delete"; path: string }
  | { kind: "move"; from: string; to: string };

export type ChangeKind = "create" | "modify" | "delete" | "move";

export interface ChangePreview {
  kind: ChangeKind;
  path: string;
  newPath: string | null;
  before: string | null;
  after: string | null;
  diff: string;
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface ChangeRecord {
  id: number;
  taskId: string | null;
  source: Actor;
  kind: ChangeKind;
  path: string;
  newPath: string | null;
  description: string | null;
  status: "applied" | "reverted" | "untracked";
  createdAt: number;
  revertedAt: number | null;
  additions: number;
  deletions: number;
}

export interface ChangeDetail {
  record: ChangeRecord;
  before: string | null;
  after: string | null;
  diff: string;
  binary: boolean;
}

export interface RevertOutcome {
  id: number;
  path: string;
  ok: boolean;
  error: string | null;
}

export interface ApplyOptions {
  access?: Access;
  expectedHash?: string | null;
  taskId?: string | null;
  description?: string | null;
}

export interface SearchQuery {
  query: string;
  mode?: "text" | "filename";
  caseSensitive?: boolean;
  regex?: boolean;
  include?: string[];
  maxResults?: number;
}

export interface SearchMatch {
  path: string;
  line: number;
  column: number;
  preview: string;
}

export interface SearchResults {
  matches: SearchMatch[];
  filesSearched: number;
  truncated: boolean;
  timedOut: boolean;
  cancelled: boolean;
}

// ---- Processes -------------------------------------------------------------

export type RiskLevel = "low" | "approval" | "blocked";
export type Requirement = "allowed" | "approval" | "denied" | "blocked";

export interface CommandAssessment {
  command: string;
  program: string;
  args: string[];
  risk: RiskLevel;
  installsDependencies: boolean;
  reason: string;
}

export interface CommandCheck {
  assessment: CommandAssessment;
  requirement: Requirement;
  alwaysAllowed: boolean;
  workspace: string;
}

export type ProcessEvent =
  | { type: "started"; pid: number | null; programPath: string; startedAt: number }
  | { type: "stdout"; text: string }
  | { type: "stderr"; text: string };

export interface ProcessOutcome {
  exitCode: number | null;
  success: boolean;
  timedOut: boolean;
  cancelled: boolean;
  durationMs: number;
  startedAt: number;
  stdoutTail: string;
  stderrTail: string;
  truncated: boolean;
}

export interface RunRequest {
  runId: string;
  command: string;
  cwd?: string | null;
  timeoutSecs?: number | null;
  actor: Actor;
  approved: boolean;
  remember: boolean;
}

export interface RunResult {
  assessment: CommandAssessment;
  outcome: ProcessOutcome;
}

export interface AllowedCommand {
  command: string;
  createdAt: number;
}

// ---- Project analysis ------------------------------------------------------

export interface ManagerDetection {
  ecosystem: "node" | "python" | "rust" | "dotNet" | "go";
  manager: string | null;
  candidates: string[];
  ambiguous: boolean;
  reason: string;
  evidence: string[];
}

export interface InstallCommand {
  manager: string;
  program: string;
  args: string[];
  display: string;
  packages: string[];
}

export interface GitStatus {
  isRepo: boolean;
  gitAvailable: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  modified: string[];
  staged: string[];
  untracked: string[];
  deleted: string[];
  truncated: boolean;
}

export interface FiveMManifest {
  manifestFile: string;
  fxVersion: string | null;
  games: string[];
  clientScripts: string[];
  serverScripts: string[];
  sharedScripts: string[];
  uiPage: string | null;
  files: string[];
  dependencies: string[];
}

export interface ProjectMetadata {
  name: string;
  root: string;
  projectTypes: string[];
  languages: { name: string; files: number }[];
  frameworks: string[];
  packageManagers: ManagerDetection[];
  configFiles: string[];
  entryPoints: string[];
  readme: string | null;
  instructionFiles: string[];
  fivem: FiveMManifest | null;
  git: GitStatus;
  filesScanned: number;
  scanTruncated: boolean;
  analyzedAt: number;
}
