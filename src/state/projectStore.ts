import { create } from "zustand";
import { toVinnieError, type VinnieError } from "@/lib/errors";
import type { ProjectInfo } from "@/lib/ipc/types";
import { getServices } from "@/services";

interface ProjectState {
  project: ProjectInfo | null;
  busy: boolean;
  error: VinnieError | null;
  load(): Promise<void>;
  /** Open the folder picker; keeps the current project when cancelled. */
  pick(): Promise<void>;
  clear(): Promise<void>;
  dismissError(): void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  project: null,
  busy: false,
  error: null,

  async load() {
    try {
      set({ project: await getServices().project.getActive(), error: null });
    } catch (err) {
      set({ error: toVinnieError(err) });
    }
  },

  async pick() {
    set({ busy: true, error: null });
    try {
      const picked = await getServices().project.pickFolder();
      if (picked) set({ project: picked });
    } catch (err) {
      set({ error: toVinnieError(err) });
    } finally {
      set({ busy: false });
    }
  },

  async clear() {
    set({ busy: true, error: null });
    try {
      await getServices().project.clear();
      set({ project: null });
    } catch (err) {
      set({ error: toVinnieError(err) });
    } finally {
      set({ busy: false });
    }
  },

  dismissError() {
    set({ error: null });
  },
}));
