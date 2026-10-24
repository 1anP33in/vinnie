import { create } from "zustand";
import { toVinnieError, type VinnieError } from "@/lib/errors";
import type { ChangeRecord, RevertOutcome } from "@/lib/ipc/types";
import { getServices } from "@/services";
import { useEditorStore } from "./editorStore";
import { useWorkspaceStore, parentOf } from "./workspaceStore";

interface ChangesState {
  changes: ChangeRecord[];
  loading: boolean;
  error: VinnieError | null;
  refresh(): Promise<void>;
  openDiff(id: number): Promise<void>;
  /** Returns "conflict" when the file changed after the change was made. */
  revert(id: number, force?: boolean): Promise<"ok" | "conflict" | "error">;
  revertTask(taskId: string, force?: boolean): Promise<RevertOutcome[] | null>;
  reset(): void;
}

function affectedPaths(c: ChangeRecord): string[] {
  return c.newPath ? [c.path, c.newPath] : [c.path];
}

async function afterRevert(paths: string[]) {
  await useEditorStore.getState().filesChanged(paths);
  const ws = useWorkspaceStore.getState();
  await Promise.all([...new Set(paths.map(parentOf))].map((d) => ws.loadDir(d)));
  void ws.refreshGit();
}

export const useChangesStore = create<ChangesState>((set, get) => ({
  changes: [],
  loading: false,
  error: null,

  async refresh() {
    set({ loading: true });
    try {
      set({ changes: await getServices().changes.list(), loading: false, error: null });
    } catch (err) {
      set({ loading: false, error: toVinnieError(err) });
    }
  },

  async openDiff(id) {
    try {
      const d = await getServices().changes.detail(id);
      const r = d.record;
      const label = { create: "created", modify: "modified", delete: "deleted", move: "moved" }[r.kind];
      useEditorStore.getState().openDiff({
        id: `change:${id}`,
        title: `${r.path.split("/").pop()} (${label} #${id})`,
        path: r.newPath ?? r.path,
        original: d.before ?? "",
        modified: d.after ?? (r.kind === "move" ? (d.before ?? "") : ""),
      });
    } catch (err) {
      set({ error: toVinnieError(err) });
    }
  },

  async revert(id, force = false) {
    const change = get().changes.find((c) => c.id === id);
    try {
      await getServices().changes.revert(id, force);
      await get().refresh();
      if (change) await afterRevert(affectedPaths(change));
      return "ok";
    } catch (err) {
      const e = toVinnieError(err);
      if (e.kind === "conflict") return "conflict";
      set({ error: e });
      return "error";
    }
  },

  async revertTask(taskId, force = false) {
    const paths = get()
      .changes.filter((c) => c.taskId === taskId)
      .flatMap(affectedPaths);
    try {
      const outcomes = await getServices().changes.revertTask(taskId, force);
      await get().refresh();
      await afterRevert(paths);
      return outcomes;
    } catch (err) {
      set({ error: toVinnieError(err) });
      return null;
    }
  },

  reset() {
    set({ changes: [], error: null });
  },
}));
