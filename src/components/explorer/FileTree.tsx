import { ChevronRight, Pencil, Trash2 } from "lucide-react";
import { memo, useMemo } from "react";
import { Spinner } from "@/components/common/Spinner";
import { describeError } from "@/lib/errors";
import type { DirEntry } from "@/lib/ipc/types";
import { useEditorStore } from "@/state/editorStore";
import { useWorkspaceStore } from "@/state/workspaceStore";
import { fileIcon } from "./fileIcons";
import { gitMarks, type GitMarks } from "./gitMarks";

interface TreeProps {
  marks: GitMarks;
  activePath: string | null;
  onRename(entry: DirEntry): void;
  onDelete(entry: DirEntry): void;
}

const Row = memo(function Row({ entry, depth, ...props }: TreeProps & { entry: DirEntry; depth: number }) {
  const expanded = useWorkspaceStore((s) => !!s.expanded[entry.path]);
  const toggle = useWorkspaceStore((s) => s.toggle);
  const openFile = useEditorStore((s) => s.openFile);
  const isDir = entry.kind === "directory";
  const { Icon, className } = fileIcon(entry.name, entry.kind, expanded);
  const active = props.activePath === entry.path;
  const mark = props.marks.untracked.has(entry.path)
    ? { letter: "U", tone: "text-success" }
    : props.marks.modified.has(entry.path)
      ? { letter: "M", tone: "text-warning" }
      : isDir && props.marks.dirty.has(entry.path)
        ? { letter: "•", tone: "text-warning" }
        : null;

  return (
    <li>
      <div
        role="treeitem"
        aria-expanded={isDir ? expanded : undefined}
        aria-selected={active}
        tabIndex={0}
        title={entry.path}
        onClick={() => (isDir ? toggle(entry.path) : entry.kind === "file" && void openFile(entry.path))}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (isDir) toggle(entry.path);
            else if (entry.kind === "file") void openFile(entry.path);
          }
        }}
        style={{ paddingLeft: 8 + depth * 12 }}
        className={`group flex h-6 cursor-pointer items-center gap-1 pr-2 text-[13px] ${
          active ? "bg-accent-soft text-text" : "text-muted hover:bg-surface-2 hover:text-text"
        } ${entry.ignored ? "opacity-50" : ""}`}
      >
        <ChevronRight
          size={12}
          className={`shrink-0 transition-transform ${isDir ? "" : "invisible"} ${expanded ? "rotate-90" : ""}`}
        />
        <Icon size={14} className={`shrink-0 ${className}`} />
        <span className={`truncate ${mark?.tone ?? ""}`}>{entry.name}</span>
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            aria-label={`Rename ${entry.name}`}
            onClick={(e) => {
              e.stopPropagation();
              props.onRename(entry);
            }}
            className="hidden rounded p-0.5 text-faint hover:bg-surface-3 hover:text-text group-hover:block"
          >
            <Pencil size={11} />
          </button>
          <button
            type="button"
            aria-label={`Delete ${entry.name}`}
            onClick={(e) => {
              e.stopPropagation();
              props.onDelete(entry);
            }}
            className="hidden rounded p-0.5 text-faint hover:bg-danger-soft hover:text-danger group-hover:block"
          >
            <Trash2 size={11} />
          </button>
          {mark && <span className={`w-3 text-center text-[10px] font-semibold ${mark.tone}`}>{mark.letter}</span>}
        </span>
      </div>
      {isDir && expanded && <Children path={entry.path} depth={depth + 1} {...props} />}
    </li>
  );
});

function Children({ path, depth, ...props }: TreeProps & { path: string; depth: number }) {
  const node = useWorkspaceStore((s) => s.nodes[path]);
  const loadDir = useWorkspaceStore((s) => s.loadDir);
  if (!node || (node.loading && !node.entries)) {
    return (
      <div className="flex h-6 items-center gap-1.5 text-xs text-faint" style={{ paddingLeft: 20 + depth * 12 }}>
        <Spinner size={11} /> Loading…
      </div>
    );
  }
  if (node.error) {
    return (
      <div className="py-1 text-xs text-danger" style={{ paddingLeft: 20 + depth * 12 }}>
        {describeError(node.error).detail}{" "}
        <button type="button" className="underline" onClick={() => void loadDir(path)}>
          Retry
        </button>
      </div>
    );
  }
  if (node.entries && node.entries.length === 0) {
    return (
      <div className="h-6 text-xs italic text-faint" style={{ paddingLeft: 20 + depth * 12 }}>
        Empty folder
      </div>
    );
  }
  return (
    <ul role="group">
      {node.entries?.map((e) => <Row key={e.path} entry={e} depth={depth} {...props} />)}
      {node.truncated && (
        <li className="h-6 text-xs text-warning" style={{ paddingLeft: 20 + depth * 12 }}>
          Showing the first 5,000 entries.
        </li>
      )}
    </ul>
  );
}

export function FileTree({ onRename, onDelete }: { onRename(entry: DirEntry): void; onDelete(entry: DirEntry): void }) {
  const git = useWorkspaceStore((s) => s.git);
  const activePath = useEditorStore((s) => {
    const t = s.tabs.find((x) => x.id === s.activeId);
    return t?.kind === "file" ? t.path : null;
  });
  const marks = useMemo(() => gitMarks(git?.modified ?? [], git?.untracked ?? []), [git]);
  return (
    <ul role="tree" aria-label="Project files" className="py-1">
      <Children path="" depth={0} marks={marks} activePath={activePath} onRename={onRename} onDelete={onDelete} />
    </ul>
  );
}
