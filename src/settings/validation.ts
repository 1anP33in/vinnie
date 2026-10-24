// Client-side mirror of the backend settings validation, used for instant
// feedback. The backend remains authoritative.

import type { Settings } from "@/lib/ipc/types";

export const DEFAULT_ENDPOINT = "http://localhost:11434";

export const DEFAULT_SETTINGS: Settings = {
  ollamaEndpoint: DEFAULT_ENDPOINT,
  defaultModel: null,
  theme: "dark",
  startupBehavior: "newConversation",
  showReasoning: true,
  reduceEffects: false,
  sidebarCollapsed: false,
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

export function validateSettings(settings: Settings): SettingsErrors {
  const errors: SettingsErrors = {};
  const endpoint = validateEndpoint(settings.ollamaEndpoint);
  if (endpoint) errors.ollamaEndpoint = endpoint;
  const model = validateModelName(settings.defaultModel);
  if (model) errors.defaultModel = model;
  return errors;
}
