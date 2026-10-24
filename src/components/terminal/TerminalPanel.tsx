import { Bot, ChevronRight, Lightbulb, ShieldAlert, Square, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { IconButton } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { formatTime } from "@/lib/dates";
import { describeError } from "@/lib/errors";
import { useProjectStore } from "@/state/projectStore";
import { useTerminalStore, type TerminalRun } from "@/state/terminalStore";

const STATUS: Record<TerminalRun["status"], { label: string; tone: string }> = {
  running: { label: "Running", tone: "text-accent" },
  succeeded: { label: "Completed", tone: "text-success" },
  failed: { label: "Failed", tone: "text-danger" },
  cancelled: { label: "Stopped", tone: "text-warning" },
  timedOut: { label: "Timed out", tone: "text-warning" },
  rejected: { label: "Not run", tone: "text-danger" },
};

function RunBlock({ run }: { run: TerminalRun }) {
  const stop = useTerminalStore((s) => s.stop);
  const [showRaw, setShowRaw] = useState(false);
  const status = STATUS[run.status];
  const output = run.lines;
  const hasDiagnosis = run.diagnosis && (run.status === "failed" || run.status === "rejected");

  return (
    <div className="border-b border-border/60 py-2" data-testid="terminal-run">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 font-mono text-[12px]">
        <span className="text-accent">$</span>
        <span className="text-text">{run.command}</span>
        {run.actor === "assistant" && (
          <span className="inline-flex items-center gap-0.5 rounded bg-accent-soft px-1 font-sans text-[10px] text-accent" title={run.reason ?? undefined}>
            <Bot size={10} /> Vinnie
          </span>
        )}
        <span className="ml-auto flex items-center gap-2 font-sans text-[11px] text-faint">
          <span>{formatTime(run.startedAt)}</span>
          <span className={`flex items-center gap-1 ${status.tone}`}>
            {run.status === "running" && <Spinner size={10} />}
            {status.label}
          </span>
          {run.exitCode !== null && <span>Code: {run.exitCode}</span>}
          {run.durationMs !== null && <span>{(run.durationMs / 1000).toFixed(1)}s</span>}
          {run.status === "running" && (
            <button
              type="button"
              onClick={() => void stop(run.id)}
              className="inline-flex items-center gap-1 rounded border border-border px-1.5 text-text hover:bg-surface-3"
            >
              <Square size={9} fill="currentColor" /> Stop
            </button>
          )}
        </span>
      </div>
      {run.droppedLines > 0 && (
        <div className="px-3 pt-1 font-mono text-[11px] text-faint">… {run.droppedLines} earlier lines not shown</div>
      )}
      {output.length > 0 && (
        <pre className="mt-1 max-h-[480px] overflow-auto whitespace-pre-wrap break-words px-3 font-mono text-[12px] leading-[1.45]">
          {output.map((l, i) => (
            <span key={i} className={l.stream === "stderr" ? "text-danger/90" : "text-muted"}>
              {l.text}
              {"\n"}
            </span>
          ))}
        </pre>
      )}
      {run.status === "rejected" && run.error && (
        <div className="mx-3 mt-1 flex items-start gap-1.5 text-xs text-danger" role="alert">
          <ShieldAlert size={13} className="mt-px shrink-0" />
          {run.error}
        </div>
      )}
      {run.status !== "running" && run.status !== "rejected" && (
        <div className="px-3 pt-1 font-mono text-[11px] text-faint">
          {run.status === "timedOut"
            ? "Process timed out and was stopped"
            : run.status === "cancelled"
              ? "Process stopped"
              : `Process exited with code ${run.exitCode ?? "unknown"}`}
        </div>
      )}
      {hasDiagnosis && run.diagnosis && (
        <div className="mx-3 mt-1.5 rounded-md border border-warning/30 bg-warning-soft px-2.5 py-1.5 text-xs" data-testid="diagnosis">
          <div className="flex items-center gap-1.5 font-medium text-text">
            <Lightbulb size={12} className="text-warning" />
            {run.status === "rejected" ? "Unable to run the command" : `Unable to run ${run.command}`}
          </div>
          <div className="mt-0.5 text-muted">The command failed because: {run.diagnosis.cause}</div>
          <div className="text-muted">Suggested next step: {run.diagnosis.suggestion}</div>
          {output.length > 0 && (
            <button type="button" className="mt-0.5 text-accent hover:underline" onClick={() => setShowRaw((v) => !v)}>
              {showRaw ? "Hide" : "Show"} raw output details
            </button>
          )}
          {showRaw && (
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-faint">
              {output.map((l) => l.text).join("\n")}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export function TerminalPanel() {
  const runs = useTerminalStore((s) => s.runs);
  const history = useTerminalStore((s) => s.history);
  const run = useTerminalStore((s) => s.run);
  const clear = useTerminalStore((s) => s.clear);
  const project = useProjectStore((s) => s.project);
  const [input, setInput] = useState("");
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const available = project?.status === "available";

  const lastLines = runs.at(-1)?.lines.length ?? 0;
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [runs.length, lastLines]);

  const submit = () => {
    const command = input.trim();
    if (!command) return;
    setInput("");
    setHistoryIndex(null);
    setError(null);
    void run({ command, actor: "user" }).catch((err) => setError(describeError(err).detail));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "ArrowUp" && history.length) {
      e.preventDefault();
      const next = historyIndex === null ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(next);
      setInput(history[next] ?? "");
    } else if (e.key === "ArrowDown" && historyIndex !== null) {
      e.preventDefault();
      const next = historyIndex + 1;
      if (next >= history.length) {
        setHistoryIndex(null);
        setInput("");
      } else {
        setHistoryIndex(next);
        setInput(history[next] ?? "");
      }
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-code" data-testid="terminal">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        {runs.length === 0 && (
          <p className="px-3 py-3 font-mono text-[12px] text-faint">
            {available
              ? `Commands run in ${project?.name}. Pipes, redirects, and destructive commands like del or rmdir are blocked.`
              : "Choose a project folder to run commands."}
          </p>
        )}
        {runs.map((r) => (
          <RunBlock key={r.id} run={r} />
        ))}
      </div>
      {error && (
        <div className="border-t border-border px-3 py-1 text-xs text-danger" role="alert">
          {error}
        </div>
      )}
      <div className="flex h-9 shrink-0 items-center gap-2 border-t border-border px-3">
        <ChevronRight size={14} className="text-accent" />
        <span className="font-mono text-[12px] text-faint">{project?.name ?? "no project"}</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={!available}
          placeholder={available ? "Type a command, e.g. npm test" : ""}
          aria-label="Terminal command"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent font-mono text-[12.5px] text-text outline-none placeholder:text-faint"
        />
        <IconButton label="Clear terminal" className="size-6" onClick={clear}>
          <Trash2 size={13} />
        </IconButton>
      </div>
    </div>
  );
}
