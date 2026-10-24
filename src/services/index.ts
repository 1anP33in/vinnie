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
  ManagerDetection,
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
