// Dragon events: a tiny event bus describing what Vinnie is doing. Phase 2
// drives a status indicator with it; Phase 5 will connect the same events to
// the animated ice dragon. Events are emitted only by real operations.

export type DragonState = "idle" | "thinking" | "reading" | "editing" | "running" | "error" | "waiting" | "success";

export interface DragonEvent {
  type: `dragon.${DragonState}`;
  state: DragonState;
  label: string;
  at: number;
}

type Listener = (event: DragonEvent) => void;
const listeners = new Set<Listener>();

export function emitDragon(state: DragonState, label: string): void {
  const event: DragonEvent = { type: `dragon.${state}`, state, label, at: Date.now() };
  for (const listener of listeners) listener(event);
}

export function onDragon(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
