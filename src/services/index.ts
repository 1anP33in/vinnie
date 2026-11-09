// Service locator for the app's backends. Production code uses the Tauri
// implementations; tests swap in fakes with `setServices`. Each service is a
// small interface over one backend system so they stay independent.

import { commands } from "@/lib/ipc/commands";
import type {
  Access,
  Actor,
  AllowedCommand,
  AppInfo,
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
  LaunchResult,
  ManagerDetection,
  McpHttpBodyEvent,
  McpHttpRequest,
  McpHttpResponseHead,
  McpLogEntry,
  McpServerConfig,
  McpServerInput,
  McpStdioEvent,
  SecretChanges,
  SkillBundle,
  SkillDetail,
  SkillMeta,
  SkillSummary,
  ToolSetting,
  ProcessEvent,
  ProjectMetadata,
  ProjectTree,
  RevertOutcome,
  RunRequest,
  RunResult,
  SearchQuery,
  SearchResults,
  Settings,
} from "@/lib/ipc/types";
import { createToolRegistry } from "@/agent/toolRegistry";
import type { ToolRegistry } from "@/agent/types";
import { createTauriProjectProvider } from "@/project/tauriProjectProvider";
import type { ProjectProvider } from "@/project/types";
import { createOllamaProvider } from "@/providers/ollamaProvider";
import type { AIProvider } from "@/providers/types";
import { createTauriConversationRepository } from "@/repositories/tauriConversationRepository";
import type { ConversationRepository } from "@/repositories/types";

export interface SettingsService {
  load(): Promise<Settings>;
  save(settings: Settings): Promise<Settings>;
}

export interface SystemService {
  appInfo(): Promise<AppInfo>;
  openExternalUrl(url: string): Promise<void>;
  copyText(text: string): Promise<void>;
  openLogDir(): Promise<void>;
  /** Start `ollama serve` locally (when the endpoint is on this computer). */
  launchOllama(): Promise<LaunchResult>;
}

/** File and directory operations inside the active project. */
export interface WorkspaceService {
  listDir(path: string): Promise<DirListing>;
  tree(opts: { path?: string; maxDepth?: number; maxEntries?: number; access?: Access }): Promise<ProjectTree>;
  readFile(path: string, access?: Access): Promise<FileContent>;
  statFile(path: string): Promise<FileVersion>;
  createDir(path: string, access?: Access): Promise<void>;
}

export interface SearchService {
  search(searchId: string, query: SearchQuery, access?: Access): Promise<SearchResults>;
  cancel(searchId: string): Promise<boolean>;
}

/** Snapshots, diffs, apply, and revert. */
export interface ChangeService {
  preview(op: FileOperation): Promise<ChangePreview>;
  apply(op: FileOperation, options: ApplyOptions): Promise<ChangeRecord>;
  list(path?: string): Promise<ChangeRecord[]>;
  detail(id: number): Promise<ChangeDetail>;
  revert(id: number, force?: boolean): Promise<ChangeRecord>;
  revertTask(taskId: string, force?: boolean): Promise<RevertOutcome[]>;
}

export interface ProcessService {
  assess(command: string, actor: Actor): Promise<CommandCheck>;
  run(request: RunRequest, onEvent: (event: ProcessEvent) => void): Promise<RunResult>;
  cancel(runId: string): Promise<boolean>;
  allowedCommands(): Promise<AllowedCommand[]>;
  removeAllowedCommand(command: string): Promise<void>;
}

export interface ProjectAnalysisService {
  analyze(): Promise<ProjectMetadata>;
  cached(): Promise<ProjectMetadata | null>;
  gitStatus(): Promise<GitStatus>;
  packageManagers(): Promise<ManagerDetection[]>;
  installCommand(manager: string, packages: string[], dev?: boolean): Promise<InstallCommand>;
}

/** MCP server configuration and the backend side of the transports. */
export interface McpService {
  list(): Promise<McpServerConfig[]>;
  save(server: McpServerInput, secrets: SecretChanges, isNew: boolean): Promise<McpServerConfig>;
  remove(id: string): Promise<void>;
  markConnected(id: string): Promise<void>;
  stdioStart(serverId: string, onEvent: (event: McpStdioEvent) => void): Promise<{ pid: number }>;
  stdioSend(serverId: string, line: string): Promise<void>;
  stdioStop(serverId: string): Promise<boolean>;
  httpFetch(serverId: string, request: McpHttpRequest, onBody: (event: McpHttpBodyEvent) => void): Promise<McpHttpResponseHead>;
  httpAbort(requestId: string): Promise<boolean>;
  logs(serverId: string): Promise<McpLogEntry[]>;
}

export interface ToolSettingsService {
  list(): Promise<ToolSetting[]>;
  save(setting: Pick<ToolSetting, "key" | "enabled" | "policy">): Promise<ToolSetting>;
  recordRun(key: string, outcome: string): Promise<void>;
}

export interface SkillService {
  list(): Promise<SkillSummary[]>;
  read(id: string): Promise<SkillDetail>;
  save(meta: SkillMeta, instructions: string, isNew: boolean): Promise<SkillSummary>;
  remove(id: string): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  readReference(id: string, name: string): Promise<string>;
  saveReference(id: string, name: string, content: string): Promise<void>;
  deleteReference(id: string, name: string): Promise<void>;
  exportBundle(id: string): Promise<SkillBundle>;
  importBundle(bundle: SkillBundle, overwrite: boolean): Promise<SkillSummary>;
}

/** Small text files chosen by the user through native dialogs. */
export interface FileDialogService {
  saveText(defaultName: string, content: string): Promise<string | null>;
  openText(): Promise<{ name: string; content: string } | null>;
}

export interface Services {
  provider: AIProvider;
  conversations: ConversationRepository;
  project: ProjectProvider;
  settings: SettingsService;
  system: SystemService;
  tools: ToolRegistry;
  workspace: WorkspaceService;
  search: SearchService;
  changes: ChangeService;
  process: ProcessService;
  analysis: ProjectAnalysisService;
  mcp: McpService;
  toolSettings: ToolSettingsService;
  skills: SkillService;
  dialogs: FileDialogService;
}

function createDefaultServices(): Services {
  return {
    provider: createOllamaProvider(),
    conversations: createTauriConversationRepository(),
    project: createTauriProjectProvider(),
    settings: { load: commands.getSettings, save: commands.saveSettings },
    system: {
      appInfo: commands.getAppInfo,
      openExternalUrl: commands.openExternalUrl,
      copyText: commands.copyText,
      openLogDir: commands.openLogDir,
      launchOllama: commands.launchOllama,
    },
    tools: createToolRegistry(),
    workspace: {
      listDir: commands.listDir,
      tree: commands.projectTree,
      readFile: commands.readFile,
      statFile: commands.statFile,
      createDir: commands.createDir,
    },
    search: {
      search: async (id, query, access) => (await commands.search(id, query, access)).results,
      cancel: commands.cancelSearch,
    },
    changes: {
      preview: commands.previewChange,
      apply: commands.applyChange,
      list: (path) => commands.listChanges(path),
      detail: commands.changeDetail,
      revert: commands.revertChange,
      revertTask: commands.revertTask,
    },
    process: {
      assess: commands.assessCommand,
      run: commands.runCommand,
      cancel: commands.cancelCommand,
      allowedCommands: commands.listAllowedCommands,
      removeAllowedCommand: commands.removeAllowedCommand,
    },
    analysis: {
      analyze: commands.analyzeProject,
      cached: commands.getProjectMetadata,
      gitStatus: commands.gitStatus,
      packageManagers: commands.detectPackageManagers,
      installCommand: commands.buildInstallCommand,
    },
    mcp: {
      list: commands.mcpListServers,
      save: commands.mcpSaveServer,
      remove: commands.mcpDeleteServer,
      markConnected: commands.mcpMarkConnected,
      stdioStart: commands.mcpStdioStart,
      stdioSend: commands.mcpStdioSend,
      stdioStop: commands.mcpStdioStop,
      httpFetch: commands.mcpHttpFetch,
      httpAbort: commands.mcpHttpAbort,
      logs: commands.mcpServerLogs,
    },
    toolSettings: {
      list: commands.toolSettingsList,
      save: commands.toolSettingsSave,
      recordRun: commands.toolSettingsRecordRun,
    },
    skills: {
      list: commands.skillsList,
      read: commands.skillsRead,
      save: commands.skillsSave,
      remove: commands.skillsDelete,
      setEnabled: commands.skillsSetEnabled,
      readReference: commands.skillsReadReference,
      saveReference: commands.skillsSaveReference,
      deleteReference: commands.skillsDeleteReference,
      exportBundle: commands.skillsExport,
      importBundle: commands.skillsImport,
    },
    dialogs: { saveText: commands.saveTextFile, openText: commands.openTextFile },
  };
}

let services: Services | null = null;

export function getServices(): Services {
  services ??= createDefaultServices();
  return services;
}

export function setServices(overrides: Partial<Services>): void {
  services = { ...getServices(), ...overrides };
}
