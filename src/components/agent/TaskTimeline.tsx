import {
  AlertTriangle,
  Ban,
  Brain,
  Check,
  FileText,
  Hand,
  ListChecks,
  PencilLine,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Spinner } from "@/components/common/Spinner";
import type { AgentStep } from "@/agent/runtime/types";
import { formatClock } from "./taskFormat";

function iconFor(step: AgentStep): LucideIcon {
  switch (step.kind) {
    case "thinking":
      return Brain;
    case "planning":
      return ListChecks;
    case "permission":
      return Hand;
    case "retry":
      return RotateCcw;
    case "verification":
      return ShieldCheck;
    case "note":
      return Sparkles;
    case "tool": {
      const n = step.tool?.name ?? "";
      if (n === "search_files") return Search;
      if (n.endsWith("_file") && n !== "read_file") return PencilLine;
      if (n === "run_command" || n === "install_dependency") return Settings2;
      return FileText;
    }
  }
}

function StatusMark({ status }: { status: AgentStep["status"] }) {
  switch (status) {
    case "running":
      return <Spinner size={11} className="text-accent" />;
    case "succeeded":
      return <Check size={12} className="text-success" />;
    case "denied":
    case "cancelled":
      return <Ban size={12} className="text-warning" />;
    case "failed":
    case "timed_out":
      return <AlertTriangle size={12} className="text-danger" />;
    default:
      return null;
  }
}

/** Live task timeline: every row is a real runtime event. */
export function TaskTimeline({ steps, max }: { steps: AgentStep[]; max?: number }) {
  const shown = max ? steps.slice(-max) : steps;
  return (
    <ol className="flex flex-col gap-0.5 font-mono text-[11.5px]" data-testid="task-timeline">
      {max && steps.length > max && <li className="text-faint">… {steps.length - max} earlier events</li>}
      {shown.map((s) => {
        const Icon = iconFor(s);
        return (
          <li key={s.id} className="flex items-center gap-2" title={s.details ?? s.tool?.resultSummary ?? undefined}>
            <span className="w-[62px] shrink-0 text-faint">{formatClock(s.startedAt)}</span>
            <Icon size={12} className="shrink-0 text-muted" />
            <span className={`min-w-0 flex-1 truncate font-sans ${s.status === "failed" || s.status === "timed_out" ? "text-danger" : "text-text"}`}>
              {s.title}
            </span>
            <span className="shrink-0">
              <StatusMark status={s.status} />
            </span>
          </li>
        );
      })}
    </ol>
  );
}
