// Agent task state for the UI. The runtime owns the task; this store keeps
// snapshots for rendering and forwards user controls (pause, resume, stop,
// plan edits, accept/revert) to the active runtime.

import { create } from "zustand";
import type { AgentRuntime } from "@/agent/runtime/runtime";
import { TERMINAL_STATUSES, type AgentLimits, type AgentTask } from "@/agent/runtime/types";
import type { AgentSettings } from "@/lib/ipc/types";
import { getServices } from "@/services";
import { useChangesStore } from "./changesStore";

const MAX_TASKS = 50;

interface AgentState {
  tasks: Record<string, AgentTask>;
  /** Task ids, oldest first. */
  order: string[];
  activeTaskId: string | null;
  begin(runtime: AgentRuntime): void;
  update(task: AgentTask): void;
  end(taskId: string): void;
  pause(): void;
  resume(): void;
  stop(): void;
  editPlanStep(stepId: string, title: string): void;
  removePlanStep(stepId: string): void;
  accept(taskId: string): void;
  revertTask(taskId: string): Promise<string>;
  revertFile(taskId: string, path: string): Promise<string>;
}

let activeRuntime: AgentRuntime | null = null;

export function limitsFromSettings(a: AgentSettings): AgentLimits {
  return {
    maxIterations: a.maxIterations,
    maxToolCalls: a.maxToolCalls,
    maxRetries: a.maxRetries,
    commandTimeoutSecs: a.commandTimeoutSecs,
    taskTimeoutMs: a.taskTimeoutMins * 60_000,
    maxChangedFiles: a.maxChangedFiles,
    contextBudget: a.contextBudget,
    maxToolResultChars: 8_000,
  };
}

export function isRunning(task: AgentTask | undefined): boolean {
  return !!task && !TERMINAL_STATUSES.includes(task.status);
}

export const useAgentStore = create<AgentState>((set, get) => ({
  tasks: {},
  order: [],
  activeTaskId: null,

  begin(runtime) {
    activeRuntime = runtime;
    const task = runtime.task;
    set((s) => {
      const order = [...s.order.filter((id) => id !== task.id), task.id];
      const dropped = order.length > MAX_TASKS ? order.splice(0, order.length - MAX_TASKS) : [];
      const tasks = { ...s.tasks, [task.id]: task };
      for (const id of dropped) delete tasks[id];
      return { tasks, order, activeTaskId: task.id };
    });
  },

  update(task) {
    set((s) => ({ tasks: { ...s.tasks, [task.id]: task } }));
  },

  end(taskId) {
    if (activeRuntime?.task.id === taskId) activeRuntime = null;
    if (get().activeTaskId === taskId) set({ activeTaskId: null });
  },

  pause() {
    activeRuntime?.pause();
  },

  resume() {
    activeRuntime?.resume();
  },

  stop() {
    activeRuntime?.cancel();
  },

  editPlanStep(stepId, title) {
    activeRuntime?.editPlanStep(stepId, title);
  },

  removePlanStep(stepId) {
    activeRuntime?.removePlanStep(stepId);
  },

  accept(taskId) {
    const task = get().tasks[taskId];
    if (task) set((s) => ({ tasks: { ...s.tasks, [taskId]: { ...task, accepted: true } } }));
  },

  async revertTask(taskId) {
    const outcomes = await useChangesStore.getState().revertTask(taskId);
    if (!outcomes) return "Could not revert the task's changes.";
    const failed = outcomes.filter((o) => !o.ok);
    return failed.length
      ? `Reverted ${outcomes.length - failed.length} of ${outcomes.length} changes. Not reverted: ${failed.map((f) => f.path).join(", ")}`
      : `Reverted ${outcomes.length} change${outcomes.length === 1 ? "" : "s"}.`;
  },

  async revertFile(taskId, path) {
    const all = await getServices().changes.list();
    const mine = all.filter((c) => c.taskId === taskId && c.status === "applied" && (c.path === path || c.newPath === path));
    let reverted = 0;
    for (const c of mine) {
      const result = await useChangesStore.getState().revert(c.id);
      if (result === "ok") reverted++;
      else return `${path} was changed after Vinnie edited it; revert it from the Changes panel to confirm.`;
    }
    return reverted ? `Reverted ${path}.` : `No applied changes to ${path} in this task.`;
  },
}));
