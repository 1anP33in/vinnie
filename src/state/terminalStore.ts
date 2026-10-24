// Terminal runs: every command the user types or the assistant runs, with
// streamed output, timing, exit code, and a diagnosis on failure.

import { create } from "zustand";
import { emitDragon } from "@/agent/events";
import { diagnose, type Diagnosis } from "@/lib/diagnose";
import { toVinnieError } from "@/lib/errors";
import type { Actor, RunResult } from "@/lib/ipc/types";
import { getServices } from "@/services";
import { useActivityStore } from "./activityStore";

export type OutputStream = "stdout" | "stderr";

export interface OutputLine {
  stream: OutputStream;
  text: string;
}

export type RunStatus = "running" | "succeeded" | "failed" | "cancelled" | "timedOut" | "rejected";

export interface TerminalRun {
  id: string;
  command: string;
  cwd: string | null;
  actor: Actor;
  reason: string | null;
  startedAt: number;
  endedAt: number | null;
  status: RunStatus;
  exitCode: number | null;
  durationMs: number | null;
  lines: OutputLine[];
  /** Whether the last line is still being written (no trailing newline yet). */
  openLine: boolean;
  droppedLines: number;
  error: string | null;
  diagnosis: Diagnosis | null;
}

export interface RunOptions {
  command: string;
  actor: Actor;
  cwd?: string | null;
  approved?: boolean;
  remember?: boolean;
  timeoutSecs?: number | null;
  reason?: string | null;
}

const MAX_LINES = 5_000;
const MAX_RUNS = 50;

/**
 * Append streamed text to output lines. Handles `\r\n`, and bare `\r`
 * (progress bars) by rewriting the current line.
 */
export function appendOutput(
  run: Pick<TerminalRun, "lines" | "openLine" | "droppedLines">,
  stream: OutputStream,
  text: string,
): Pick<TerminalRun, "lines" | "openLine" | "droppedLines"> {
  const lines = run.lines.slice();
  let open = run.openLine;
  const segments = text.replace(/\r\n/g, "\n").split("\n");
  segments.forEach((segment, i) => {
    const isLast = i === segments.length - 1;
    // A bare carriage return returns to the start of the line.
    const cr = segment.lastIndexOf("\r");
    const value = cr >= 0 ? segment.slice(cr + 1) : segment;
    const touches = value.length > 0 || cr >= 0;
    if (open && lines.length > 0) {
      if (touches) {
        const last = lines[lines.length - 1]!;
        lines[lines.length - 1] = { stream, text: cr >= 0 ? value : last.text + value };
      }
    } else if (touches || !isLast) {
      lines.push({ stream, text: value });
    }
    // Every segment except the last is followed by a newline.
    open = isLast ? open || touches : false;
  });
  let dropped = run.droppedLines;
  if (lines.length > MAX_LINES) {
    dropped += lines.length - MAX_LINES;
    lines.splice(0, lines.length - MAX_LINES);
  }
  return { lines, openLine: open, droppedLines: dropped };
}

interface TerminalState {
  runs: TerminalRun[];
  history: string[];
  run(options: RunOptions): Promise<RunResult>;
  stop(id: string): Promise<void>;
  clear(): void;
}

export const useTerminalStore = create<TerminalState>((set, get) => {
  const patch = (id: string, fn: (r: TerminalRun) => Partial<TerminalRun>) =>
    set((s) => ({ runs: s.runs.map((r) => (r.id === id ? { ...r, ...fn(r) } : r)) }));

  return {
    runs: [],
    history: [],

    async run(options) {
      const id = crypto.randomUUID();
      const command = options.command.trim();
      const run: TerminalRun = {
        id,
        command,
        cwd: options.cwd ?? null,
        actor: options.actor,
        reason: options.reason ?? null,
        startedAt: Date.now(),
        endedAt: null,
        status: "running",
        exitCode: null,
        durationMs: null,
        lines: [],
        openLine: false,
        droppedLines: 0,
        error: null,
        diagnosis: null,
      };
      set((s) => ({
        runs: [...s.runs, run].slice(-MAX_RUNS),
        history:
          options.actor === "user" ? [...s.history.filter((h) => h !== command), command].slice(-100) : s.history,
      }));
      const install = /\b(install|add|i|ci|sync|restore|fetch)\b/.test(command.split(" ").slice(1, 2).join(" "));
      const activityId = useActivityStore
        .getState()
        .start(install ? "install" : "command", `Running ${command}`, options.reason ?? null);

      // Batch output into state at most every 50 ms.
      let pending: { stream: OutputStream; text: string }[] = [];
      let timer: ReturnType<typeof setTimeout> | null = null;
      const flush = () => {
        timer = null;
        if (pending.length === 0) return;
        const chunks = pending;
        pending = [];
        patch(id, (r) => {
          let next: Pick<TerminalRun, "lines" | "openLine" | "droppedLines"> = r;
          for (const c of chunks) next = appendOutput(next, c.stream, c.text);
          return next;
        });
      };

      try {
        const result = await getServices().process.run(
          {
            runId: id,
            command,
            cwd: options.cwd ?? null,
            timeoutSecs: options.timeoutSecs ?? null,
            actor: options.actor,
            approved: options.approved ?? false,
            remember: options.remember ?? false,
          },
          (event) => {
            if (event.type === "stdout" || event.type === "stderr") {
              pending.push({ stream: event.type, text: event.text });
              timer ??= setTimeout(flush, 50);
            }
          },
        );
        if (timer) clearTimeout(timer);
        flush();
        const o = result.outcome;
        const status: RunStatus = o.timedOut ? "timedOut" : o.cancelled ? "cancelled" : o.success ? "succeeded" : "failed";
        const diagnosis = status === "failed" ? diagnose(`${o.stderrTail}\n${o.stdoutTail}`) : null;
        patch(id, () => ({
          status,
          exitCode: o.exitCode,
          durationMs: o.durationMs,
          endedAt: Date.now(),
          diagnosis,
        }));
        const summary = `Exit code ${o.exitCode ?? "none"} · ${(o.durationMs / 1000).toFixed(1)}s`;
        useActivityStore
          .getState()
          .finish(activityId, status === "succeeded" ? "success" : status === "cancelled" ? "cancelled" : "error", summary);
        if (status === "succeeded") emitDragon("success", `${command} completed`);
        return result;
      } catch (err) {
        if (timer) clearTimeout(timer);
        flush();
        const e = toVinnieError(err);
        patch(id, () => ({
          status: "rejected",
          error: e.message,
          endedAt: Date.now(),
          diagnosis: diagnose(e.message),
        }));
        useActivityStore.getState().finish(activityId, e.kind === "blocked" ? "denied" : "error", e.message);
        throw e;
      }
    },

    async stop(id) {
      if (get().runs.find((r) => r.id === id)?.status !== "running") return;
      await getServices().process.cancel(id);
    },

    clear() {
      set((s) => ({ runs: s.runs.filter((r) => r.status === "running") }));
    },
  };
});
