import { create } from "zustand";
import { toVinnieError, type VinnieError } from "@/lib/errors";
import type { ConnectionInfo, ModelInfo } from "@/lib/ipc/types";
import { getServices } from "@/services";
import { useSettingsStore } from "./settingsStore";

export type ConnectionStatus = "unknown" | "checking" | "connected" | "disconnected";
export type ModelsStatus = "idle" | "loading" | "loaded" | "error";

interface ConnectionState {
  status: ConnectionStatus;
  info: ConnectionInfo | null;
  error: VinnieError | null;
  models: ModelInfo[];
  modelsStatus: ModelsStatus;
  modelsError: VinnieError | null;
  selectedModel: string | null;
  /** Check reachability, then reload models when connected. */
  refresh(): Promise<void>;
  check(): Promise<boolean>;
  refreshModels(): Promise<void>;
  selectModel(name: string | null): void;
}

/** Keep the current choice if still installed, else the default, else the first model. */
export function chooseModel(models: ModelInfo[], current: string | null, preferred: string | null): string | null {
  const names = new Set(models.map((m) => m.name));
  if (current && names.has(current)) return current;
  if (preferred && names.has(preferred)) return preferred;
  return models[0]?.name ?? null;
}

let checkSeq = 0;

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  status: "unknown",
  info: null,
  error: null,
  models: [],
  modelsStatus: "idle",
  modelsError: null,
  selectedModel: null,

  async refresh() {
    if (await get().check()) await get().refreshModels();
  },

  async check() {
    const seq = ++checkSeq;
    set({ status: "checking" });
    try {
      const info = await getServices().provider.checkConnection();
      if (seq !== checkSeq) return get().status === "connected";
      set({ status: "connected", info, error: null });
      return true;
    } catch (err) {
      if (seq !== checkSeq) return false;
      set({ status: "disconnected", info: null, error: toVinnieError(err) });
      return false;
    }
  },

  async refreshModels() {
    set({ modelsStatus: "loading", modelsError: null });
    try {
      const models = await getServices().provider.listModels();
      const preferred = useSettingsStore.getState().settings.defaultModel;
      set({
        models,
        modelsStatus: "loaded",
        selectedModel: chooseModel(models, get().selectedModel, preferred),
      });
    } catch (err) {
      const error = toVinnieError(err);
      set({ modelsStatus: "error", modelsError: error });
      if (error.kind === "unreachable" || error.kind === "timeout") {
        set({ status: "disconnected", error, info: null });
      }
    }
  },

  selectModel(name) {
    set({ selectedModel: name });
  },
}));
