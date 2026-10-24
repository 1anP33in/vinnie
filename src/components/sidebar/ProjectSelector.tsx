import { AlertTriangle, FolderOpen, FolderPlus, X } from "lucide-react";
import { Spinner } from "@/components/common/Spinner";
import { describeError } from "@/lib/errors";
import { PROJECT_STATUS_TEXT } from "@/project/status";
import { useProjectStore } from "@/state/projectStore";

export function ProjectSelector({ collapsed }: { collapsed: boolean }) {
  const project = useProjectStore((s) => s.project);
  const busy = useProjectStore((s) => s.busy);
  const error = useProjectStore((s) => s.error);
  const pick = useProjectStore((s) => s.pick);
  const clear = useProjectStore((s) => s.clear);
  const dismissError = useProjectStore((s) => s.dismissError);

  const problem = project && project.status !== "available" ? PROJECT_STATUS_TEXT[project.status] : null;
  const icon = busy ? (
    <Spinner size={15} />
  ) : problem ? (
    <AlertTriangle size={15} className="text-warning" />
  ) : project ? (
    <FolderOpen size={15} className="text-accent" />
  ) : (
    <FolderPlus size={15} />
  );

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => void pick()}
        disabled={busy}
        aria-label={project ? `Project: ${project.name}. Change folder` : "Choose project folder"}
        title={project ? `${project.name}\n${project.path}` : "Choose project folder"}
        className="mx-auto flex size-9 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-text"
      >
        {icon}
      </button>
    );
  }

  return (
    <div className="px-2">
      <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-faint">Project</div>
      <div className="group flex items-center gap-1">
        <button
          type="button"
          onClick={() => void pick()}
          disabled={busy}
          title={project ? `${project.path}\nClick to change folder` : "Choose a local project folder"}
          aria-label={project ? `Project: ${project.name}. Change folder` : "Choose project folder"}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted hover:bg-surface-2 hover:text-text disabled:opacity-60"
        >
          {icon}
          <span className="truncate">{project ? project.name : "Choose folder…"}</span>
        </button>
        {project && (
          <button
            type="button"
            onClick={() => void clear()}
            disabled={busy}
            aria-label="Forget project folder"
            title="Forget project folder (files are not touched)"
            className="rounded p-1 text-faint opacity-0 hover:bg-surface-3 hover:text-text focus:opacity-100 group-hover:opacity-100"
          >
            <X size={13} />
          </button>
        )}
      </div>
      {problem && <p className="px-2 pt-1 text-xs text-warning">{problem}</p>}
      {error && (
        <p className="flex items-start gap-1 px-2 pt-1 text-xs text-danger" role="alert">
          <span className="flex-1">{describeError(error).detail}</span>
          <button type="button" onClick={dismissError} aria-label="Dismiss" className="hover:text-text">
            <X size={12} />
          </button>
        </p>
      )}
    </div>
  );
}
