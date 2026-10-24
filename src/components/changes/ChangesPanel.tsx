import { Bot, FileMinus, FilePen, FilePlus, FileSymlink, RefreshCw, Undo2, User } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { IconButton } from "@/components/common/Button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ErrorNotice } from "@/components/common/ErrorNotice";
import { Spinner } from "@/components/common/Spinner";
import { formatTime } from "@/lib/dates";
import type { ChangeKind, ChangeRecord } from "@/lib/ipc/types";
import { useChangesStore } from "@/state/changesStore";
import { useProjectStore } from "@/state/projectStore";
import { groupChanges, type Group } from "./groupChanges";

const KIND_ICON: Record<ChangeKind, typeof FilePen> = {
  create: FilePlus,
  modify: FilePen,
  delete: FileMinus,
  move: FileSymlink,
};

function ChangeRow({ change, onRevert }: { change: ChangeRecord; onRevert(c: ChangeRecord): void }) {
  const openDiff = useChangesStore((s) => s.openDiff);
  const Icon = KIND_ICON[change.kind];
  const reverted = change.status === "reverted";
  return (
    <li className={`group flex items-center gap-1.5 px-3 py-1 text-xs hover:bg-surface-2 ${reverted ? "opacity-50" : ""}`}>
      <button
        type="button"
        onClick={() => void openDiff(change.id)}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        title={`${change.description ?? change.kind} — click to view the diff`}
      >
        <Icon size={13} className="shrink-0 text-accent" />
        <span className={`truncate ${reverted ? "line-through" : "text-text"}`}>
          {change.newPath ? `${change.path} → ${change.newPath}` : change.path}
        </span>
        {change.kind !== "move" && (
          <span className="shrink-0">
            <span className="text-success">+{change.additions}</span> <span className="text-danger">−{change.deletions}</span>
          </span>
        )}
      </button>
      <span className="shrink-0 text-faint">{reverted ? "reverted" : formatTime(change.createdAt)}</span>
      {!reverted && change.status === "applied" && (
        <button
          type="button"
          aria-label={`Revert change to ${change.path}`}
          title="Revert this change"
          onClick={() => onRevert(change)}
          className="hidden rounded p-0.5 text-faint hover:bg-surface-3 hover:text-text group-hover:block"
        >
          <Undo2 size={12} />
        </button>
      )}
    </li>
  );
}

export function ChangesPanel() {
  const { changes, loading, error, refresh, revert, revertTask } = useChangesStore();
  const project = useProjectStore((s) => s.project);
  const [conflict, setConflict] = useState<ChangeRecord | null>(null);
  const [confirmTask, setConfirmTask] = useState<Group | null>(null);
  const [taskResult, setTaskResult] = useState<string | null>(null);

  useEffect(() => {
    if (project?.status === "available") void refresh();
  }, [project, refresh]);

  const groups = useMemo(() => groupChanges(changes), [changes]);

  const onRevert = async (c: ChangeRecord) => {
    const result = await revert(c.id);
    if (result === "conflict") setConflict(c);
  };

  const runRevertTask = async (force = false) => {
    if (!confirmTask?.taskId) return;
    const outcomes = await revertTask(confirmTask.taskId, force);
    setConfirmTask(null);
    if (outcomes) {
      const failed = outcomes.filter((o) => !o.ok);
      setTaskResult(
        failed.length
          ? `Reverted ${outcomes.length - failed.length} of ${outcomes.length}. Not reverted: ${failed
              .map((f) => `${f.path} (${f.error})`)
              .join("; ")}`
          : `Reverted ${outcomes.length} change${outcomes.length === 1 ? "" : "s"}.`,
      );
    }
  };

  if (!project || project.status !== "available") {
    return <p className="px-4 py-6 text-sm text-muted">Choose a project folder to see its change history.</p>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center justify-between px-3 text-[11px] text-faint">
        <span>Changes made through Vinnie</span>
        <IconButton label="Refresh changes" className="size-6" onClick={() => void refresh()}>
          {loading ? <Spinner size={12} /> : <RefreshCw size={12} />}
        </IconButton>
      </div>
      {error && (
        <div className="px-2">
          <ErrorNotice error={error} compact />
        </div>
      )}
      {taskResult && (
        <p className="px-3 pb-1 text-xs text-muted" role="status">
          {taskResult}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-auto pb-2" data-testid="changes-list">
        {changes.length === 0 && !loading && (
          <p className="px-4 py-4 text-xs text-faint">
            No changes yet. File edits made in the editor or by Vinnie appear here and can be reverted.
          </p>
        )}
        {groups.map((g) => {
          const applied = g.changes.filter((c) => c.status === "applied").length;
          return (
            <section key={g.key} className="mb-1.5">
              <div className="flex items-center gap-1.5 px-3 py-0.5 text-[11px] uppercase tracking-wider text-faint">
                {g.source === "assistant" ? <Bot size={11} /> : <User size={11} />}
                {g.source === "assistant" ? "Vinnie" : "You"}
                {g.changes[0]?.description && (
                  <span className="truncate normal-case tracking-normal">· {g.changes[0].description}</span>
                )}
                {g.taskId && g.changes.length > 1 && applied > 0 && (
                  <button
                    type="button"
                    onClick={() => setConfirmTask(g)}
                    className="ml-auto shrink-0 normal-case tracking-normal text-accent hover:underline"
                  >
                    Revert all ({applied})
                  </button>
                )}
              </div>
              <ul>
                {g.changes.map((c) => (
                  <ChangeRow key={c.id} change={c} onRevert={(x) => void onRevert(x)} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <ConfirmDialog
        open={conflict !== null}
        title="File changed since then"
        description={`${conflict?.path} was edited after this change. Reverting anyway will discard those later edits.`}
        confirmLabel="Revert anyway"
        destructive
        onConfirm={() => {
          if (conflict) void revert(conflict.id, true);
          setConflict(null);
        }}
        onCancel={() => setConflict(null)}
      />
      <ConfirmDialog
        open={confirmTask !== null}
        title="Revert all changes from this task?"
        description={`This undoes ${confirmTask?.changes.filter((c) => c.status === "applied").length ?? 0} changes, newest first. Files edited afterwards are skipped and reported.`}
        confirmLabel="Revert all"
        destructive
        onConfirm={() => void runRevertTask()}
        onCancel={() => setConfirmTask(null)}
      />
    </div>
  );
}
