import { FilePlus, FolderOpen, FolderPlus, ListCollapse, RefreshCw } from "lucide-react";
import { useState } from "react";
import { IconButton, Button } from "@/components/common/Button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ErrorNotice } from "@/components/common/ErrorNotice";
import { PromptDialog } from "@/components/common/PromptDialog";
import type { DirEntry } from "@/lib/ipc/types";
import { PROJECT_STATUS_TEXT } from "@/project/status";
import { useEditorStore } from "@/state/editorStore";
import { useProjectStore } from "@/state/projectStore";
import { useWorkspaceStore, parentOf } from "@/state/workspaceStore";
import { FileTree } from "./FileTree";
import { ProjectInfo } from "./ProjectInfo";

type Prompt =
  | { kind: "file" | "folder"; base: string }
  | { kind: "rename"; entry: DirEntry };

export function ExplorerPanel() {
  const project = useProjectStore((s) => s.project);
  const pick = useProjectStore((s) => s.pick);
  const refresh = useWorkspaceStore((s) => s.refresh);
  const collapseAll = useWorkspaceStore((s) => s.collapseAll);
  const applyUserChange = useWorkspaceStore((s) => s.applyUserChange);
  const createFolder = useWorkspaceStore((s) => s.createFolder);
  const actionError = useWorkspaceStore((s) => s.actionError);
  const dismissError = useWorkspaceStore((s) => s.dismissError);
  const openFile = useEditorStore((s) => s.openFile);
  const closeTab = useEditorStore((s) => s.close);

  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [toDelete, setToDelete] = useState<DirEntry | null>(null);

  if (!project) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-8 text-center text-sm text-muted">
        <FolderOpen size={28} className="text-faint" />
        <p>Choose a project folder to browse, search, and edit its files.</p>
        <Button variant="primary" size="sm" onClick={() => void pick()}>
          Choose folder…
        </Button>
      </div>
    );
  }
  if (project.status !== "available") {
    return (
      <div className="px-4 py-6 text-sm">
        <p className="text-warning">{PROJECT_STATUS_TEXT[project.status]}</p>
        <p className="mt-1 break-all font-mono text-xs text-faint">{project.path}</p>
        <Button className="mt-3" size="sm" onClick={() => void pick()}>
          Choose another folder…
        </Button>
      </div>
    );
  }

  const confirmPrompt = async (value: string) => {
    if (!prompt) return;
    let ok = false;
    if (prompt.kind === "rename") {
      const target = prompt.entry.path.includes("/") ? `${parentOf(prompt.entry.path)}/${value}` : value;
      ok = await applyUserChange({ kind: "move", from: prompt.entry.path, to: target });
      if (ok) closeTab(`file:${prompt.entry.path}`);
    } else {
      const path = prompt.base ? `${prompt.base}/${value}` : value;
      if (prompt.kind === "folder") ok = await createFolder(path);
      else {
        ok = await applyUserChange({ kind: "create", path, content: "" });
        if (ok) void openFile(path);
      }
    }
    if (ok) setPrompt(null);
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    const ok = await applyUserChange({ kind: "delete", path: toDelete.path });
    if (ok) closeTab(`file:${toDelete.path}`);
    setToDelete(null);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-0.5 px-3">
        <button
          type="button"
          onClick={() => void pick()}
          title={`${project.path}\nClick to choose another folder`}
          className="min-w-0 flex-1 truncate text-left text-xs font-semibold uppercase tracking-wider text-muted hover:text-text"
        >
          {project.name}
        </button>
        <IconButton label="New file" className="size-6" onClick={() => setPrompt({ kind: "file", base: "" })}>
          <FilePlus size={14} />
        </IconButton>
        <IconButton label="New folder" className="size-6" onClick={() => setPrompt({ kind: "folder", base: "" })}>
          <FolderPlus size={14} />
        </IconButton>
        <IconButton label="Refresh explorer" className="size-6" onClick={() => void refresh()}>
          <RefreshCw size={13} />
        </IconButton>
        <IconButton label="Collapse folders" className="size-6" onClick={collapseAll}>
          <ListCollapse size={14} />
        </IconButton>
      </div>
      <ProjectInfo />
      {actionError && (
        <div className="p-2">
          <ErrorNotice error={actionError} compact onDismiss={dismissError} />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <FileTree onRename={(entry) => setPrompt({ kind: "rename", entry })} onDelete={setToDelete} />
      </div>

      <PromptDialog
        open={prompt !== null}
        title={prompt?.kind === "rename" ? "Rename" : prompt?.kind === "folder" ? "New folder" : "New file"}
        label={prompt?.kind === "rename" ? "New name" : "Path relative to the project root"}
        initialValue={prompt?.kind === "rename" ? prompt.entry.name : ""}
        confirmLabel={prompt?.kind === "rename" ? "Rename" : "Create"}
        error={actionError ? null : undefined}
        onConfirm={(v) => void confirmPrompt(v)}
        onCancel={() => setPrompt(null)}
      />
      <ConfirmDialog
        open={toDelete !== null}
        title={`Delete ${toDelete?.name ?? ""}?`}
        description={
          toDelete?.kind === "directory"
            ? "Only empty folders can be deleted."
            : "The file will be deleted. You can restore it from the Changes panel."
        }
        confirmLabel="Delete"
        destructive
        onConfirm={() => void confirmDelete()}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
