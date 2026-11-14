import { useSyncExternalStore } from "react";

/** "now", "12s", "3m", "2h": compact relative times for the activity list. */
export function formatRelative(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 5) return "now";
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.round(m / 60)}h`;
}

const TICK_MS = 5_000;
let tick = Date.now();
const subscribers = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  if (!timer) {
    tick = Date.now();
    timer = setInterval(() => {
      tick = Date.now();
      for (const s of subscribers) s();
    }, TICK_MS);
  }
  return () => {
    subscribers.delete(cb);
    if (!subscribers.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** The current time, refreshed every few seconds while something displays it. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, () => tick);
}
