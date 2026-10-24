import { create } from "zustand";
import { toVinnieError, type VinnieError } from "@/lib/errors";
import type { Settings } from "@/lib/ipc/types";
import { getServices } from "@/services";
import { DEFAULT_SETTINGS } from "@/settings/validation";

interface SettingsState {
  settings: Settings;
  loaded: boolean;
  loadError: VinnieError | null;
  load(): Promise<Settings>;
  /** Validate and persist; throws a VinnieError when rejected. */
  save(next: Settings): Promise<Settings>;
  /** Persist a UI preference without surfacing errors to the user. */
  setSidebarCollapsed(collapsed: boolean): Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  loadError: null,

  async load() {
    try {
      const settings = await getServices().settings.load();
      set({ settings, loaded: true, loadError: null });
      return settings;
    } catch (err) {
      set({ loaded: true, loadError: toVinnieError(err) });
      return get().settings;
    }
  },

  async save(next) {
    try {
      const saved = await getServices().settings.save(next);
      set({ settings: saved });
      return saved;
    } catch (err) {
      throw toVinnieError(err);
    }
  },

  async setSidebarCollapsed(collapsed) {
    const previous = get().settings;
    set({ settings: { ...previous, sidebarCollapsed: collapsed } });
    try {
      await getServices().settings.save({ ...previous, sidebarCollapsed: collapsed });
    } catch {
      // Non-critical: the preference simply won't survive a restart.
    }
  },
}));
