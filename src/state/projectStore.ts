import { create } from "zustand";
import { toVinnieError, type VinnieError } from "@/lib/errors";
import type { ProjectInfo } from "@/lib/ipc/types";
import { getServices } from "@/services";
import { useChangesStore } from "./changesStore";
import { useEditorStore } from "./editorStore";
import { useWorkspaceStore } from "./workspaceStore";

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

/** Reset workspace-dependent state when the active project changes. */
function projectChanged(previous: ProjectInfo | null, next: ProjectInfo | null) {
  if (previous?.path === next?.path && previous?.status === next?.status) return;
  if (previous?.path !== next?.path) useEditorStore.getState().closeAll();
  const available = next?.status === "available" ? next.path : null;
  useWorkspaceStore.getState().reset(available);
  useChangesStore.getState().reset();
  if (available) void useChangesStore.getState().refresh();
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  busy: false,
  error: null,

  async load() {
    try {
      const previous = get().project;
      const project = await getServices().project.getActive();
      set({ project, error: null });
      projectChanged(previous, project);
    } catch (err) {
      set({ error: toVinnieError(err) });
    }
  },

  async pick() {
    set({ busy: true, error: null });
    try {
      const previous = get().project;
      const picked = await getServices().project.pickFolder();
      if (picked) {
        set({ project: picked });
        projectChanged(previous, picked);
      }
    } catch (err) {
      set({ error: toVinnieError(err) });
    } finally {
      set({ busy: false });
    }
  },

  async clear() {
    set({ busy: true, error: null });
    try {
      const previous = get().project;
      await getServices().project.clear();
      set({ project: null });
      projectChanged(previous, null);
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
