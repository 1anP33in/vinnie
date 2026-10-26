import { create } from "zustand";

export type View = "chat" | "settings";
export type SideView = "explorer" | "search" | "changes" | "chats";
export type BottomTab = "terminal" | "activity" | "task";

interface UiState {
  view: View;
  sideView: SideView;
  bottomOpen: boolean;
  bottomTab: BottomTab;
  /** Text to place into the composer (e.g. from a welcome-screen suggestion). */
  composerDraft: { text: string; nonce: number } | null;
  setView(view: View): void;
  setSideView(view: SideView): void;
  showBottom(tab: BottomTab): void;
  toggleBottom(): void;
  fillComposer(text: string): void;
}

export const useUiStore = create<UiState>((set) => ({
  view: "chat",
  sideView: "chats",
  bottomOpen: false,
  bottomTab: "terminal",
  composerDraft: null,
  setView: (view) => set({ view }),
  setSideView: (sideView) => set({ sideView }),
  showBottom: (bottomTab) => set({ bottomOpen: true, bottomTab }),
  toggleBottom: () => set((s) => ({ bottomOpen: !s.bottomOpen })),
  fillComposer: (text) => set({ composerDraft: { text, nonce: Date.now() } }),
}));
