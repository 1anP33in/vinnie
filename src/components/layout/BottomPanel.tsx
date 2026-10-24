import { Activity as ActivityIcon, SquareTerminal, X } from "lucide-react";
import { ActivityPanel } from "@/components/activity/ActivityPanel";
import { IconButton } from "@/components/common/Button";
import { TerminalPanel } from "@/components/terminal/TerminalPanel";
import { useActivityStore } from "@/state/activityStore";
import { useTerminalStore } from "@/state/terminalStore";
import { useUiStore, type BottomTab } from "@/state/uiStore";

function Tab({ tab, label, icon, badge }: { tab: BottomTab; label: string; icon: React.ReactNode; badge?: number }) {
  const active = useUiStore((s) => s.bottomTab === tab);
  const showBottom = useUiStore((s) => s.showBottom);
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => showBottom(tab)}
      className={`flex h-full items-center gap-1.5 border-b-2 px-2 text-xs ${
        active ? "border-accent text-text" : "border-transparent text-muted hover:text-text"
      }`}
    >
      {icon}
      {label}
      {badge ? <span className="rounded-full bg-accent-soft px-1.5 text-[10px] text-accent">{badge}</span> : null}
    </button>
  );
}

export function BottomPanel() {
  const tab = useUiStore((s) => s.bottomTab);
  const toggle = useUiStore((s) => s.toggleBottom);
  const running = useTerminalStore((s) => s.runs.filter((r) => r.status === "running").length);
  const activeOps = useActivityStore((s) => s.activities.filter((a) => a.status === "running").length);
  return (
    <div className="flex h-full min-h-0 flex-col border-t border-border bg-bg">
      <div role="tablist" className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-2">
        <Tab tab="terminal" label="Terminal" icon={<SquareTerminal size={13} />} badge={running} />
        <Tab tab="activity" label="Activity" icon={<ActivityIcon size={13} />} badge={activeOps} />
        <IconButton label="Hide panel (Ctrl+`)" className="ml-auto size-6" onClick={toggle}>
          <X size={13} />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1">{tab === "terminal" ? <TerminalPanel /> : <ActivityPanel />}</div>
    </div>
  );
}
