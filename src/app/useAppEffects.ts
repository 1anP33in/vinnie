import { useEffect } from "react";
import type { Theme } from "@/lib/ipc/types";
import { useConnectionStore } from "@/state/connectionStore";
import { useConversationStore } from "@/state/conversationStore";
import { useSettingsStore } from "@/state/settingsStore";
import { useUiStore } from "@/state/uiStore";

const RECONNECT_INTERVAL_MS = 15_000;

function resolveTheme(theme: Theme): "dark" | "light" {
  if (theme !== "system") return theme;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** Apply theme and visual-effects settings to the document root. */
export function useThemeEffect() {
  const theme = useSettingsStore((s) => s.settings.theme);
  const reduceEffects = useSettingsStore((s) => s.settings.reduceEffects);

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      root.dataset.theme = resolveTheme(theme);
    };
    apply();
    root.dataset.effects = reduceEffects ? "reduced" : "full";
    if (theme !== "system" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-color-scheme: light)");
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [theme, reduceEffects]);
}

/** While Ollama is unreachable, periodically retry so the app recovers on its own. */
export function useReconnectEffect() {
  const status = useConnectionStore((s) => s.status);
  useEffect(() => {
    if (status !== "disconnected") return;
    const timer = setInterval(() => void useConnectionStore.getState().refresh(), RECONNECT_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [status]);
}

/** Global shortcuts: Ctrl+N (new conversation), Ctrl+, (settings). */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        useUiStore.getState().setView("chat");
        useConversationStore.getState().startNew();
      } else if (e.key === ",") {
        e.preventDefault();
        useUiStore.getState().setView("settings");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
