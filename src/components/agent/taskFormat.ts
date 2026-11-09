import { useEffect, useState } from "react";
import type { AgentStatus, AgentTask } from "@/agent/runtime/types";

export const STATUS_TEXT: Record<AgentStatus, string> = {
  idle: "Starting…",
  thinking: "Vinnie is thinking…",
  planning: "Vinnie is planning…",
  executing: "Vinnie is working…",
  waiting_for_permission: "Vinnie is waiting for your permission…",
  verifying: "Vinnie is verifying…",
  paused: "Vinnie paused.",
  completed: "Task completed",
  failed: "Task failed",
  stopped: "Task stopped safely",
  cancelled: "Task cancelled",
};

/** Present-tense description of what the agent is doing right now. */
export function liveStatus(task: AgentTask): string {
  const running = [...task.steps].reverse().find((s) => s.status === "running");
  if (task.status === "executing" && running) {
    const name = running.tool?.name ?? "";
    if (name === "read_file" || name === "get_project_structure" || name === "get_project_info") return "Vinnie is reading files…";
    if (name === "search_files") return "Vinnie is searching the project…";
    if (name.endsWith("_file")) return "Vinnie is preparing changes…";
    if (name === "run_command" || name === "install_dependency") return "Vinnie is running a command…";
  }
  return STATUS_TEXT[task.status];
}

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${(s % 60).toString().padStart(2, "0")}s`;
}

export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** The current time, ticking every second while `active`. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}
