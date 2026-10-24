// Service locator for the app's backends. Production code uses the Tauri
// implementations; tests swap in fakes with `setServices`.

import { commands } from "@/lib/ipc/commands";
import type { AppInfo, Settings } from "@/lib/ipc/types";
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
}

export interface Services {
  provider: AIProvider;
  conversations: ConversationRepository;
  project: ProjectProvider;
  settings: SettingsService;
  system: SystemService;
  tools: ToolRegistry;
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
    },
    tools: createToolRegistry(),
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
