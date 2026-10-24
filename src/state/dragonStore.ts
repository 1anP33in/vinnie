// Current dragon state, derived from dragon events. Success and error are
// shown briefly, then the indicator returns to idle.

import { create } from "zustand";
import { onDragon, type DragonState } from "@/agent/events";

const TRANSIENT_MS = 3_000;

interface DragonStoreState {
  state: DragonState;
  label: string;
}

export const useDragonStore = create<DragonStoreState>(() => ({ state: "idle", label: "Idle" }));

let timer: ReturnType<typeof setTimeout> | null = null;

onDragon((event) => {
  if (timer) clearTimeout(timer);
  timer = null;
  useDragonStore.setState({ state: event.state, label: event.label });
  if (event.state === "success" || event.state === "error") {
    timer = setTimeout(() => useDragonStore.setState({ state: "idle", label: "Idle" }), TRANSIENT_MS);
  }
});
