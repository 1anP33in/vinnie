import {
  AlertTriangle,
  Ban,
  ChevronDown,
  CircleCheck,
  CircleSlash,
  Eye,
  Pause,
  Play,
  Square,
  Undo2,
  X,
} from "lucide-react";
import { useState } from "react";
import { Button, IconButton } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { isRunning, useAgentStore } from "@/state/agentStore";
import { useChangesStore } from "@/state/changesStore";
import { useConversationStore } from "@/state/conversationStore";
import { useUiStore } from "@/state/uiStore";
import type { AgentTask } from "@/agent/runtime/types";
import { PlanView } from "./PlanView";
import { TaskTimeline } from "./TaskTimeline";
import { formatElapsed, liveStatus, STATUS_TEXT, useNow } from "./taskFormat";

function Header({ task, running }: { task: AgentTask; running: boolean }) {
  const pause = useAgentStore((s) => s.pause);
  const resume = useAgentStore((s) => s.resume);
  const stop = useAgentStore((s) => s.stop);
  const now = useNow(running);
  const elapsed = (task.completedAt ?? now) - task.startedAt;
  const status = task.status;
  const icon = running ? (
    status === "paused" ? <Pause size={14} className="text-warning" /> : <Spinner size={14} className="text-accent" />
  ) : status === "completed" ? (
    <CircleCheck size={15} className="text-success" />
  ) : status === "cancelled" ? (
    <Ban size={15} className="text-warning" />
  ) : status === "stopped" ? (
    <CircleSlash size={15} className="text-warning" />
  ) : (
    <AlertTriangle size={15} className="text-danger" />
  );
  return (
    <div className="flex items-center gap-2">
      {icon}
      <span className="min-w-0 flex-1 truncate text-sm font-medium" data-testid="agent-status">
        {running
          ? liveStatus(task)
          : status === "completed" && task.intent === "task" && task.result?.changes.files === 0
            ? "Task finished — no files were changed"
            : STATUS_TEXT[status]}
      </span>
      <span className="text-xs text-faint" title="Elapsed time">
        {formatElapsed(elapsed)}
      </span>
      {running && (
        <>
          {status === "paused" ? (
            <Button size="sm" onClick={resume} icon={<Play size={12} />}>
              Resume
            </Button>
          ) : (
            <Button size="sm" onClick={pause} icon={<Pause size={12} />}>
              Pause
            </Button>
          )}
          <Button size="sm" variant="danger" onClick={stop} icon={<Square size={10} fill="currentColor" />}>
            Stop
          </Button>
        </>
      )}
    </div>
  );
}

function Stats({ task }: { task: AgentTask }) {
  const changed = new Set(task.changes.map((c) => c.newPath ?? c.path)).size;
  const summary = task.result?.changes;
  const verification = task.result?.verification;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-muted" data-testid="agent-stats">
      <span>Step {task.iteration}</span>
      <span>{task.toolCalls} tool call{task.toolCalls === 1 ? "" : "s"}</span>
      <span>
        {summary ? summary.files : changed} file{(summary ? summary.files : changed) === 1 ? "" : "s"} changed
        {summary && summary.files > 0 && (
          <>
            {" "}
            <span className="text-success">+{summary.additions}</span> <span className="text-danger">−{summary.deletions}</span>
          </>
        )}
      </span>
      {task.retries > 0 && <span>{task.retries} retr{task.retries === 1 ? "y" : "ies"}</span>}
      <span>
        Verification:{" "}
        {verification ? (
          <span className={verification.success ? "text-success" : "text-danger"}>{verification.success ? "passed" : "failed"}</span>
        ) : task.status === "verifying" ? (
          "running"
        ) : (
          "not run"
        )}
      </span>
      <span className="text-faint">Mode: {task.mode}</span>
    </div>
  );
}

function Outcome({ task }: { task: AgentTask }) {
  const accept = useAgentStore((s) => s.accept);
  const revertTask = useAgentStore((s) => s.revertTask);
  const revertFile = useAgentStore((s) => s.revertFile);
  const setSideView = useUiStore((s) => s.setSideView);
  const openDiff = useChangesStore((s) => s.openDiff);
  const [message, setMessage] = useState<string | null>(null);
  const result = task.result!;
  const verification = result.verification;

  return (
    <div className="flex flex-col gap-2">
      {result.status !== "completed" && <p className="text-xs text-warning">{result.reason}</p>}
      {verification && (
        <div data-testid="verification-checks">
          <div className="mb-0.5 text-[11px] uppercase tracking-wider text-faint">Verification</div>
          <ul className="flex flex-col gap-0.5 text-xs">
            {verification.checks.map((c) => (
              <li key={c.id} className="flex items-start gap-1.5" title={c.details}>
                <span className={c.status === "passed" ? "text-success" : c.status === "failed" ? "text-danger" : "text-faint"}>
                  {c.status === "passed" ? "✓" : c.status === "failed" ? "✗" : "–"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={c.kind === "command" ? "font-mono" : ""}>{c.name}</span>
                  {c.status !== "passed" && <span className="block truncate text-faint">{c.details.split("\n", 1)[0]}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {result.changes.files > 0 && (
        <div>
          <div className="mb-0.5 text-[11px] uppercase tracking-wider text-faint">
            {result.changes.files} file{result.changes.files === 1 ? "" : "s"} changed{" "}
            <span className="normal-case text-success">+{result.changes.additions}</span>{" "}
            <span className="normal-case text-danger">−{result.changes.deletions}</span>
          </div>
          <ul className="flex flex-col gap-0.5 text-xs">
            {result.changes.paths.map((p) => {
              const change = [...task.changes].reverse().find((c) => (c.newPath ?? c.path) === p);
              return (
                <li key={p} className="group flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate font-mono">{p}</span>
                  {change?.changeId && (
                    <button type="button" className="text-accent hover:underline" onClick={() => void openDiff(change.changeId!)}>
                      View
                    </button>
                  )}
                  {!task.accepted && (
                    <button
                      type="button"
                      className="text-faint hover:text-text"
                      onClick={() => void revertFile(task.id, p).then(setMessage)}
                      aria-label={`Revert ${p}`}
                    >
                      Revert file
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" icon={<Eye size={12} />} onClick={() => setSideView("changes")}>
              View changes
            </Button>
            {!task.accepted && (
              <>
                <Button size="sm" icon={<Undo2 size={12} />} onClick={() => void revertTask(task.id).then(setMessage)}>
                  Revert task
                </Button>
                <Button size="sm" variant="primary" onClick={() => accept(task.id)}>
                  Accept changes
                </Button>
              </>
            )}
            {task.accepted && <span className="self-center text-xs text-success">Accepted</span>}
          </div>
        </div>
      )}
      {message && (
        <p className="text-xs text-muted" role="status">
          {message}
        </p>
      )}
    </div>
  );
}

/**
 * The agent panel above the composer: the running (or most recent) task in
 * this conversation, with its plan, progress, controls, and outcome.
 */
export function AgentPanel() {
  const activeConversation = useConversationStore((s) => s.activeId);
  const task = useAgentStore((s) => {
    for (let i = s.order.length - 1; i >= 0; i--) {
      const t = s.tasks[s.order[i]!];
      if (t && t.conversationId === activeConversation) return t;
    }
    return undefined;
  });
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [showTimeline, setShowTimeline] = useState(false);
  if (!task || dismissed === task.id) return null;
  const running = isRunning(task);
  // Simple answers don't need a panel once they're done.
  if (!running && task.intent === "question" && task.changes.length === 0 && task.status === "completed") return null;
  const current = [...task.steps].reverse().find((s) => s.status === "running");

  return (
    <div className="mx-auto mb-2 w-full max-w-3xl px-6" data-testid="agent-panel">
      <div className="max-h-[42vh] overflow-y-auto rounded-xl border border-border-strong bg-surface p-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <Header task={task} running={running} />
          </div>
          {!running && (
            <IconButton label="Dismiss task panel" className="size-6" onClick={() => setDismissed(task.id)}>
              <X size={13} />
            </IconButton>
          )}
        </div>
        {running && current && (
          <p className="mt-1 truncate text-xs text-muted" data-testid="agent-current-step">
            Current step: {current.title}
          </p>
        )}
        <div className="mt-2">
          <Stats task={task} />
        </div>
        {task.plan && task.plan.steps.length > 0 && (
          <div className="mt-2.5">
            <PlanView plan={task.plan} editable={running} />
          </div>
        )}
        {!running && task.result && (
          <div className="mt-2.5">
            <Outcome task={task} />
          </div>
        )}
        <button
          type="button"
          onClick={() => setShowTimeline((v) => !v)}
          aria-expanded={showTimeline}
          className="mt-2 flex items-center gap-1 text-[11px] text-faint hover:text-text"
        >
          <ChevronDown size={11} className={showTimeline ? "" : "-rotate-90"} /> Timeline ({task.steps.length})
        </button>
        {showTimeline && (
          <div className="mt-1 max-h-56 overflow-auto">
            <TaskTimeline steps={task.steps} />
          </div>
        )}
      </div>
    </div>
  );
}
