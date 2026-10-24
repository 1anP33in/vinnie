// Explorer tree (lazy loading), project metadata, and Git status for the
// active project. File operations go through the change service so they are
// recorded and can be reverted.

import { create } from "zustand";
import { toVinnieError, type VinnieError } from "@/lib/errors";
import type { DirEntry, FileOperation, GitStatus, ProjectMetadata } from "@/lib/ipc/types";
import { getServices } from "@/services";
import { useActivityStore } from "./activityStore";

export interface DirNode {
  entries: DirEntry[] | null;
  loading: boolean;
  error: VinnieError | null;
  truncated: boolean;
}

interface WorkspaceState {
  /** Root path of the project these nodes belong to. */
  root: string | null;
  nodes: Record<string, DirNode>;
  expanded: Record<string, boolean>;
  metadata: ProjectMetadata | null;
  analyzing: boolean;
  analysisError: VinnieError | null;
  git: GitStatus | null;
  actionError: VinnieError | null;

  reset(root: string | null): void;
  loadDir(path: string): Promise<void>;
  toggle(path: string): void;
  collapseAll(): void;
  refresh(): Promise<void>;
  analyze(): Promise<void>;
  refreshGit(): Promise<void>;
  applyUserChange(op: FileOperation): Promise<boolean>;
  createFolder(path: string): Promise<boolean>;
  dismissError(): void;
}

export function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  root: null,
  nodes: {},
  expanded: { "": true },
  metadata: null,
  analyzing: false,
  analysisError: null,
  git: null,
  actionError: null,

  reset(root) {
    set({
      root,
      nodes: {},
      expanded: { "": true },
      metadata: null,
      analysisError: null,
      git: null,
      actionError: null,
    });
    if (!root) return;
    void get().loadDir("");
    void getServices()
      .analysis.cached()
      .then((m) => {
        if (get().root === root && m) set({ metadata: m, git: m.git });
      })
      .catch(() => {});
    void get().analyze();
  },

  async loadDir(path) {
    const root = get().root;
    set((s) => ({
      nodes: { ...s.nodes, [path]: { entries: s.nodes[path]?.entries ?? null, loading: true, error: null, truncated: false } },
    }));
    try {
      const listing = await getServices().workspace.listDir(path);
      if (get().root !== root) return;
      set((s) => ({
        nodes: { ...s.nodes, [path]: { entries: listing.entries, loading: false, error: null, truncated: listing.truncated } },
      }));
    } catch (err) {
      if (get().root !== root) return;
      set((s) => ({
        nodes: { ...s.nodes, [path]: { entries: null, loading: false, error: toVinnieError(err), truncated: false } },
      }));
    }
  },

  toggle(path) {
    const open = !get().expanded[path];
    set((s) => ({ expanded: { ...s.expanded, [path]: open } }));
    if (open && !get().nodes[path]?.entries) void get().loadDir(path);
  },

  collapseAll() {
    set({ expanded: { "": true } });
  },

  async refresh() {
    const expanded = Object.keys(get().expanded).filter((p) => get().expanded[p]);
    await Promise.all(expanded.map((p) => get().loadDir(p)));
    void get().refreshGit();
  },

  async analyze() {
    const root = get().root;
    if (!root || get().analyzing) return;
    set({ analyzing: true, analysisError: null });
    const activityId = useActivityStore.getState().start("analysis", "Analyzing project structure");
    try {
      const metadata = await getServices().analysis.analyze();
      if (get().root !== root) return;
      set({ metadata, git: metadata.git, analyzing: false });
      const types = metadata.projectTypes.length ? metadata.projectTypes.join(", ") : "No known project type";
      useActivityStore.getState().finish(activityId, "success", `${types} · ${metadata.filesScanned} files scanned`);
    } catch (err) {
      const e = toVinnieError(err);
      set({ analyzing: false, analysisError: e });
      useActivityStore.getState().finish(activityId, "error", e.message);
    }
  },

  async refreshGit() {
    try {
      const git = await getServices().analysis.gitStatus();
      set({ git });
    } catch {
      /* Git status is optional. */
    }
  },

  async applyUserChange(op) {
    try {
      await getServices().changes.apply(op, { access: { actor: "user", approved: true } });
      const dirs = new Set<string>(op.kind === "move" ? [parentOf(op.from), parentOf(op.to)] : [parentOf(op.path)]);
      await Promise.all([...dirs].map((d) => get().loadDir(d)));
      void get().refreshGit();
      return true;
    } catch (err) {
      set({ actionError: toVinnieError(err) });
      return false;
    }
  },

  async createFolder(path) {
    try {
      await getServices().workspace.createDir(path);
      await get().loadDir(parentOf(path));
      return true;
    } catch (err) {
      set({ actionError: toVinnieError(err) });
      return false;
    }
  },

  dismissError() {
    set({ actionError: null });
  },
}));
