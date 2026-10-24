import {
  AlertTriangle,
  Ban,
  Check,
  ChevronRight,
  FileSearch,
  FileText,
  Hand,
  Package,
  PencilLine,
  ScanSearch,
  Sparkles,
  Terminal,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { IconButton } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { formatTime } from "@/lib/dates";
import { useActivityStore, type Activity, type ActivityKind } from "@/state/activityStore";

const ICONS: Record<ActivityKind, LucideIcon> = {
  search: FileSearch,
  read: FileText,
  write: PencilLine,
  command: Terminal,
  install: Package,
  analysis: ScanSearch,
  approval: Hand,
  model: Sparkles,
  error: AlertTriangle,
};

function duration(a: Activity): string | null {
  if (!a.endedAt) return null;
  const ms = a.endedAt - a.startedAt;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function Row({ a }: { a: Activity }) {
  const [open, setOpen] = useState(false);
  const Icon = ICONS[a.kind];
  const status =
    a.status === "running" ? (
      <Spinner size={11} className="text-accent" />
    ) : a.status === "success" ? (
      <Check size={12} className="text-success" />
    ) : a.status === "denied" || a.status === "cancelled" ? (
      <Ban size={12} className="text-warning" />
    ) : (
      <AlertTriangle size={12} className="text-danger" />
    );
  return (
    <li className="border-b border-border/50">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        disabled={!a.details}
        className="flex w-full items-center gap-2 px-3 py-1 text-left text-xs hover:bg-surface-2 disabled:cursor-default disabled:hover:bg-transparent"
      >
        <ChevronRight size={11} className={`shrink-0 text-faint ${a.details ? "" : "invisible"} ${open ? "rotate-90" : ""}`} />
        <span className="w-16 shrink-0 text-faint">{formatTime(a.startedAt)}</span>
        <Icon size={13} className="shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate text-text">{a.title}</span>
        <span className="shrink-0 text-faint">{duration(a)}</span>
        <span className="shrink-0" aria-label={a.status}>
          {status}
        </span>
      </button>
      {open && a.details && (
        <pre className="whitespace-pre-wrap break-words px-10 pb-2 font-mono text-[11px] text-muted">{a.details}</pre>
      )}
    </li>
  );
}

export function ActivityPanel() {
  const activities = useActivityStore((s) => s.activities);
  const clear = useActivityStore((s) => s.clear);
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="activity">
      <div className="flex h-7 shrink-0 items-center justify-between px-3 text-[11px] text-faint">
        <span>Everything Vinnie does, as it happens</span>
        <IconButton label="Clear finished activity" className="size-6" onClick={clear}>
          <Trash2 size={12} />
        </IconButton>
      </div>
      <ul className="min-h-0 flex-1 overflow-auto">
        {activities.length === 0 && <li className="px-3 py-2 text-xs text-faint">No activity yet.</li>}
        {activities.map((a) => (
          <Row key={a.id} a={a} />
        ))}
      </ul>
    </div>
  );
}
