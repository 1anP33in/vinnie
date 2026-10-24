// Activity feed: one entry per real operation (search, read, edit, command,
// analysis, approval, model request). Nothing is added speculatively.

import { create } from "zustand";
import { emitDragon, type DragonState } from "@/agent/events";

export type ActivityKind =
  | "search"
  | "read"
  | "write"
  | "command"
  | "install"
  | "analysis"
  | "approval"
  | "model"
  | "error";

export type ActivityStatus = "running" | "success" | "error" | "denied" | "cancelled";

export interface Activity {
  id: string;
  kind: ActivityKind;
  title: string;
  status: ActivityStatus;
  startedAt: number;
  endedAt: number | null;
  details: string | null;
}

const MAX_ACTIVITIES = 300;

const DRAGON_FOR_KIND: Partial<Record<ActivityKind, DragonState>> = {
  search: "reading",
  read: "reading",
  analysis: "reading",
  write: "editing",
  command: "running",
  install: "running",
};

interface ActivityState {
  activities: Activity[];
  start(kind: ActivityKind, title: string, details?: string | null): string;
  finish(id: string, status: Exclude<ActivityStatus, "running">, details?: string | null): void;
  clear(): void;
}

export const useActivityStore = create<ActivityState>((set, get) => ({
  activities: [],

  start(kind, title, details = null) {
    const id = crypto.randomUUID();
    const activity: Activity = {
      id,
      kind,
      title,
      status: "running",
      startedAt: Date.now(),
      endedAt: null,
      details,
    };
    set((s) => ({ activities: [activity, ...s.activities].slice(0, MAX_ACTIVITIES) }));
    const dragon = DRAGON_FOR_KIND[kind];
    if (dragon) emitDragon(dragon, title);
    return id;
  },

  finish(id, status, details) {
    const current = get().activities.find((a) => a.id === id);
    if (!current) return;
    set((s) => ({
      activities: s.activities.map((a) =>
        a.id === id ? { ...a, status, endedAt: Date.now(), details: details ?? a.details } : a,
      ),
    }));
    if (status === "error") {
      emitDragon("error", `${current.title} failed`);
    } else if (!get().activities.some((a) => a.status === "running")) {
      // Nothing else in progress: show completion briefly, then idle.
      emitDragon("success", status === "success" ? `${current.title} — done` : "Idle");
    }
  },

  clear() {
    set((s) => ({ activities: s.activities.filter((a) => a.status === "running") }));
  },
}));
