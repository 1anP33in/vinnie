import { Logo } from "@/components/common/Logo";
import type { DragonState } from "@/agent/events";
import { useDragonStore } from "@/state/dragonStore";

const TONE: Record<DragonState, string> = {
  idle: "text-faint",
  thinking: "text-accent",
  reading: "text-accent",
  editing: "text-accent-strong",
  running: "text-accent-strong",
  working: "text-accent-strong",
  waiting: "text-warning",
  error: "text-danger",
  success: "text-success",
};

/**
 * Status indicator driven by dragon events. Phase 5 replaces this with the
 * animated ice dragon, listening to the same events.
 */
export function DragonIndicator() {
  const { state, label } = useDragonStore();
  const busy = state !== "idle" && state !== "error" && state !== "success";
  return (
    <span className="flex min-w-0 items-center gap-1.5" data-testid="dragon-indicator" data-state={state} title={`dragon.${state}`}>
      <Logo size={14} className={busy ? "pulse-dot" : "opacity-80"} />
      <span className={`truncate ${TONE[state]}`}>Vinnie: {state === "idle" ? "Idle" : label}</span>
    </span>
  );
}
