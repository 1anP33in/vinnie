// The dragon's activity panel. Every line comes from the companion store,
// which is filled only by real agent runtime events.

import { BEHAVIOR_LABEL, activityForCategory } from "@/dragon/behavior";
import { useCompanionStore, type EventTone } from "@/dragon/companionStore";
import { formatRelative, useNow } from "./time";

const TONE_CLASS: Record<EventTone, string> = {
  info: "bg-faint",
  active: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  error: "bg-danger",
};

const BEHAVIOR_CLASS: Record<string, string> = {
  idle: "text-faint",
  waiting: "text-warning",
  paused: "text-warning",
  completed: "text-success",
  failed: "text-danger",
  cancelled: "text-muted",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 gap-2">
      <dt className="w-16 shrink-0 text-faint">{label}</dt>
      <dd className="min-w-0 flex-1 truncate">{children}</dd>
    </div>
  );
}

export function DragonActivity({ compact = false }: { compact?: boolean }) {
  const s = useCompanionStore();
  const now = useNow();

  if (!s.connected) {
    return (
      <div className="p-3 text-xs text-warning" role="status">
        The dragon isn't connected to the agent{s.connectionError ? `: ${s.connectionError}` : ""}. Vinnie itself is
        unaffected.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-2 p-3 text-xs" data-testid="dragon-activity">
      <dl className="flex flex-col gap-1">
        <Row label="State">
          <span className={BEHAVIOR_CLASS[s.behavior] ?? "text-accent"} data-testid="dragon-state">
            {BEHAVIOR_LABEL[s.behavior]}
          </span>
          {s.agentStatus && <span className="ml-1.5 font-mono text-[10px] text-faint">({s.agentStatus})</span>}
        </Row>
        <Row label="Task">
          {s.task ? (
            <span title={s.task}>{s.task}</span>
          ) : s.lastResult ? (
            <span className="text-faint" title={s.lastResult.label}>
              Last task: {BEHAVIOR_LABEL[s.lastResult.behavior]} · {formatRelative(s.lastResult.at, now)}
            </span>
          ) : (
            <span className="text-faint">No task running</span>
          )}
        </Row>
        <Row label="Activity">
          {s.activity ? <span title={s.activity}>{s.activity}</span> : <span className="text-faint">—</span>}
        </Row>
        <Row label="Tool">
          {s.tool ? (
            <span title={s.tool.category ? activityForCategory(s.tool.category) : undefined}>
              <span className="font-mono">{s.tool.name}</span>
              {s.behavior === "waiting" ? (
                <span className="ml-1.5 text-warning">awaiting your approval</span>
              ) : (
                s.tool.category && <span className="ml-1.5 text-faint">{activityForCategory(s.tool.category)}</span>
              )}
            </span>
          ) : (
            <span className="text-faint">—</span>
          )}
        </Row>
      </dl>

      {!compact && (
        <div className="min-h-0">
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-faint">Recent</div>
          {s.recent.length === 0 ? (
            <div className="text-faint">Nothing yet. Activity appears here when Vinnie works on a task.</div>
          ) : (
            <ol className="flex flex-col gap-0.5" aria-label="Recent agent events">
              {s.recent.map((e) => (
                <li key={e.id} className="flex min-w-0 items-center gap-2">
                  <span className={`size-1.5 shrink-0 rounded-full ${TONE_CLASS[e.tone]}`} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate" title={e.label}>
                    {e.label}
                  </span>
                  <span className="shrink-0 tabular-nums text-faint">{formatRelative(e.at, now)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
