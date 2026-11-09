// Client-side mirror of the backend settings validation, used for instant
// feedback. The backend remains authoritative.

import type { Settings } from "@/lib/ipc/types";

export const DEFAULT_ENDPOINT = "http://localhost:11434";

export const DEFAULT_IGNORED_DIRECTORIES = [
  "node_modules",
  ".git",
  ".vscode",
  ".idea",
  "bin",
  "obj",
  "dist",
  "build",
  "__pycache__",
  "target",
];

export const DEFAULT_SETTINGS: Settings = {
  ollamaEndpoint: DEFAULT_ENDPOINT,
  defaultModel: null,
  theme: "dark",
  startupBehavior: "newConversation",
  showReasoning: true,
  reduceEffects: false,
  sidebarCollapsed: false,
  permissions: { read: "allowed", write: "approval", execute: "approval", installDependencies: "approval" },
  ignoredDirectories: DEFAULT_IGNORED_DIRECTORIES,
  toolsEnabled: true,
  projectContextEnabled: true,
  agent: {
    mode: "agent",
    maxIterations: 25,
    maxToolCalls: 60,
    maxRetries: 2,
    commandTimeoutSecs: 600,
    taskTimeoutMins: 30,
    maxChangedFiles: 20,
    contextBudget: 0,
    autoVerify: true,
    debugView: false,
  },
};

export type SettingsErrors = Partial<Record<keyof Settings, string>>;

export function validateEndpoint(raw: string): string | null {
  const value = raw.trim();
  if (!value) return "The Ollama endpoint cannot be empty.";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "Enter a full URL, such as http://localhost:11434.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "The endpoint must start with http:// or https://.";
  }
  if (!url.hostname) return "The endpoint must include a host name.";
  if (url.username || url.password) return "The endpoint must not contain credentials.";
  if (url.search || url.hash) return "The endpoint must not contain a query string or fragment.";
  return null;
}

export function validateModelName(raw: string | null): string | null {
  if (raw == null || raw.trim() === "") return null;
  const name = raw.trim();
  if (name.length > 200 || /\s/.test(name)) return "That model name is not valid.";
  return null;
}

export function validateIgnoredDirectories(names: string[]): string | null {
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    if (name.length > 100 || /[\\/:*?]/.test(name) || name === "." || name === "..") {
      return `"${name}" is not a valid folder name to ignore. Use plain names like node_modules.`;
    }
  }
  return null;
}

const AGENT_RANGES: [keyof Settings["agent"], string, number, number][] = [
  ["maxIterations", "Maximum iterations", 1, 200],
  ["maxToolCalls", "Maximum tool calls", 1, 500],
  ["maxRetries", "Maximum retries", 0, 10],
  ["commandTimeoutSecs", "Command timeout", 5, 3600],
  ["taskTimeoutMins", "Task timeout", 1, 240],
  ["maxChangedFiles", "Maximum changed files", 1, 500],
];

export function validateAgentSettings(agent: Settings["agent"]): string | null {
  for (const [key, label, min, max] of AGENT_RANGES) {
    const v = agent[key] as number;
    if (!Number.isInteger(v) || v < min || v > max) return `${label} must be between ${min} and ${max}.`;
  }
  if (![0, 4096, 8192, 16384, 32768].includes(agent.contextBudget)) return "Choose a supported context budget.";
  return null;
}

export function validateSettings(settings: Settings): SettingsErrors {
  const errors: SettingsErrors = {};
  const agent = validateAgentSettings(settings.agent);
  if (agent) errors.agent = agent;
  const ignored = validateIgnoredDirectories(settings.ignoredDirectories);
  if (ignored) errors.ignoredDirectories = ignored;
  const endpoint = validateEndpoint(settings.ollamaEndpoint);
  if (endpoint) errors.ollamaEndpoint = endpoint;
  const model = validateModelName(settings.defaultModel);
  if (model) errors.defaultModel = model;
  return errors;
}
