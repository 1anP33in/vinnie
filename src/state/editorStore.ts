// Open editor tabs. Each file tab tracks the saved content, the user's
// draft, and the on-disk version, so external modifications are detected
// and never silently overwrite unsaved edits.

import { create } from "zustand";
import { toVinnieError } from "@/lib/errors";
import type { FileVersion } from "@/lib/ipc/types";
import { getServices } from "@/services";
import { useActivityStore } from "./activityStore";
import { useWorkspaceStore } from "./workspaceStore";

export type FileStatus = "loading" | "saved" | "modified" | "external" | "deleted" | "error" | "binary" | "tooLarge";

export interface FileTab {
  kind: "file";
  id: string;
  path: string;
  title: string;
  savedContent: string | null;
  draft: string | null;
  version: FileVersion | null;
  status: FileStatus;
  /** On-disk version when an external modification was detected. */
  externalVersion: FileVersion | null;
  error: string | null;
  saving: boolean;
}

export interface DiffTab {
  kind: "diff";
  id: string;
  path: string;
  title: string;
  original: string;
  modified: string;
}

export type EditorTab = FileTab | DiffTab;

interface EditorState {
  tabs: EditorTab[];
  activeId: string | null;
  /** Line to reveal once the file's editor mounts. */
  reveal: { path: string; line: number; nonce: number } | null;

  openFile(path: string, line?: number): Promise<void>;
  openDiff(tab: Omit<DiffTab, "kind">): void;
  activate(id: string): void;
  close(id: string): void;
  closeAll(): void;
  setDraft(path: string, text: string): void;
  /** Save the draft. `force` overwrites even if the file changed on disk. */
  save(path: string, force?: boolean): Promise<boolean>;
  reload(path: string): Promise<void>;
  /** Compare the user's draft with the version on disk. */
  compareWithDisk(path: string): Promise<void>;
  checkExternal(): Promise<void>;
  /** Called after Vinnie or a revert changed files on disk. */
  filesChanged(paths: string[]): Promise<void>;
  revealHandled(): void;
}

function titleOf(path: string): string {
  return path.split("/").pop() || path;
}

function fileTab(state: EditorState, path: string): FileTab | undefined {
  return state.tabs.find((t): t is FileTab => t.kind === "file" && t.path === path);
}

export function isDirty(tab: EditorTab): boolean {
  return tab.kind === "file" && tab.draft !== null && tab.draft !== tab.savedContent;
}

export const useEditorStore = create<EditorState>((set, get) => {
  const patchFile = (path: string, patch: Partial<FileTab>) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.kind === "file" && t.path === path ? { ...t, ...patch } : t)),
    }));

  async function load(path: string) {
    try {
      const file = await getServices().workspace.readFile(path);
      if (file.binary) {
        patchFile(path, { status: "binary", savedContent: null, draft: null, version: file.version, error: null });
      } else if (file.tooLarge) {
        patchFile(path, { status: "tooLarge", savedContent: null, draft: null, version: file.version, error: null });
      } else {
        patchFile(path, {
          status: "saved",
          savedContent: file.content,
          draft: file.content,
          version: file.version,
          externalVersion: null,
          error: null,
        });
      }
    } catch (err) {
      const e = toVinnieError(err);
      patchFile(path, { status: e.kind === "not_found" ? "deleted" : "error", error: e.message });
    }
  }

  return {
    tabs: [],
    activeId: null,
    reveal: null,

    async openFile(path, line) {
      const existing = fileTab(get(), path);
      if (line) set({ reveal: { path, line, nonce: Date.now() } });
      if (existing) {
        set({ activeId: existing.id });
        return;
      }
      const tab: FileTab = {
        kind: "file",
        id: `file:${path}`,
        path,
        title: titleOf(path),
        savedContent: null,
        draft: null,
        version: null,
        status: "loading",
        externalVersion: null,
        error: null,
        saving: false,
      };
      set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
      await load(path);
    },

    openDiff(tab) {
      set((s) => ({
        tabs: s.tabs.some((t) => t.id === tab.id)
          ? s.tabs.map((t) => (t.id === tab.id ? { ...tab, kind: "diff" } : t))
          : [...s.tabs, { ...tab, kind: "diff" }],
        activeId: tab.id,
      }));
    },

    activate(id) {
      set({ activeId: id });
    },

    close(id) {
      set((s) => {
        const index = s.tabs.findIndex((t) => t.id === id);
        const tabs = s.tabs.filter((t) => t.id !== id);
        const activeId =
          s.activeId === id ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? null) : s.activeId;
        return { tabs, activeId };
      });
    },

    closeAll() {
      set({ tabs: [], activeId: null, reveal: null });
    },

    setDraft(path, text) {
      const tab = fileTab(get(), path);
      if (!tab || tab.draft === text) return;
      const status: FileStatus =
        tab.status === "external" || tab.status === "deleted"
          ? tab.status
          : text === tab.savedContent
            ? "saved"
            : "modified";
      patchFile(path, { draft: text, status });
    },

    async save(path, force = false) {
      const tab = fileTab(get(), path);
      if (!tab || tab.draft === null || tab.saving) return false;
      // Nothing to save: don't touch the disk or add an empty history entry.
      if (!force && !isDirty(tab) && tab.status === "saved") return true;
      patchFile(path, { saving: true });
      const activityId = useActivityStore.getState().start("write", `Saving ${path}`);
      try {
        const services = getServices();
        await services.changes.apply(
          { kind: "write", path, content: tab.draft },
          {
            access: { actor: "user", approved: true },
            expectedHash: force || tab.status === "deleted" ? null : (tab.version?.hash ?? null),
            description: "Saved in the editor",
          },
        );
        const version = await services.workspace.statFile(path);
        patchFile(path, {
          saving: false,
          savedContent: tab.draft,
          version,
          externalVersion: null,
          status: "saved",
          error: null,
        });
        useActivityStore.getState().finish(activityId, "success", "Saved");
        void useWorkspaceStore.getState().refreshGit();
        return true;
      } catch (err) {
        const e = toVinnieError(err);
        patchFile(path, {
          saving: false,
          status: e.kind === "conflict" ? "external" : tab.status,
          error: e.kind === "conflict" ? null : e.message,
        });
        useActivityStore.getState().finish(activityId, "error", e.message);
        return false;
      }
    },

    async reload(path) {
      patchFile(path, { status: "loading" });
      await load(path);
    },

    async compareWithDisk(path) {
      const tab = fileTab(get(), path);
      if (!tab) return;
      try {
        const disk = await getServices().workspace.readFile(path);
        get().openDiff({
          id: `compare:${path}`,
          path,
          title: `${titleOf(path)} (disk ↔ yours)`,
          original: disk.content ?? "",
          modified: tab.draft ?? "",
        });
      } catch (err) {
        patchFile(path, { error: toVinnieError(err).message });
      }
    },

    async checkExternal() {
      const tabs = get().tabs.filter(
        (t): t is FileTab => t.kind === "file" && (t.status === "saved" || t.status === "modified"),
      );
      await Promise.all(
        tabs.map(async (tab) => {
          try {
            const version = await getServices().workspace.statFile(tab.path);
            if (version.hash === tab.version?.hash) return;
            if (!isDirty(tab)) {
              await load(tab.path); // nothing to lose: show the new content
            } else {
              patchFile(tab.path, { status: "external", externalVersion: version });
            }
          } catch (err) {
            if (toVinnieError(err).kind === "not_found") {
              patchFile(tab.path, { status: "deleted", error: "This file was deleted or moved outside the editor." });
            }
          }
        }),
      );
    },

    async filesChanged(paths) {
      const set_ = new Set(paths);
      const tabs = get().tabs.filter((t): t is FileTab => t.kind === "file" && set_.has(t.path));
      await Promise.all(
        tabs.map(async (tab) => {
          if (isDirty(tab)) {
            try {
              const version = await getServices().workspace.statFile(tab.path);
              patchFile(tab.path, { status: "external", externalVersion: version });
            } catch {
              patchFile(tab.path, { status: "deleted", error: "This file was deleted or moved." });
            }
          } else {
            await load(tab.path);
          }
        }),
      );
    },

    revealHandled() {
      set({ reveal: null });
    },
  };
});
