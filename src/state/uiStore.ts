import { create } from "zustand";

export type View = "chat" | "settings";

interface UiState {
  view: View;
  /** Text to place into the composer (e.g. from a welcome-screen suggestion). */
  composerDraft: { text: string; nonce: number } | null;
  setView(view: View): void;
  fillComposer(text: string): void;
}

export const useUiStore = create<UiState>((set) => ({
  view: "chat",
  composerDraft: null,
  setView: (view) => set({ view }),
  fillComposer: (text) => set({ composerDraft: { text, nonce: Date.now() } }),
}));
