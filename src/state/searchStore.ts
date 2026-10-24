import { create } from "zustand";
import { toVinnieError, type VinnieError } from "@/lib/errors";
import type { SearchResults } from "@/lib/ipc/types";
import { getServices } from "@/services";
import { useActivityStore } from "./activityStore";

interface SearchState {
  query: string;
  mode: "text" | "filename";
  caseSensitive: boolean;
  regex: boolean;
  include: string;
  results: SearchResults | null;
  running: boolean;
  error: VinnieError | null;
  set(patch: Partial<Pick<SearchState, "query" | "mode" | "caseSensitive" | "regex" | "include">>): void;
  run(): Promise<void>;
  cancel(): void;
  clear(): void;
}

let currentId: string | null = null;

export const useSearchStore = create<SearchState>((set, get) => ({
  query: "",
  mode: "text",
  caseSensitive: false,
  regex: false,
  include: "",
  results: null,
  running: false,
  error: null,

  set(patch) {
    set(patch);
  },

  async run() {
    const { query, mode, caseSensitive, regex, include } = get();
    get().cancel();
    if (!query.trim()) {
      set({ results: null, error: null, running: false });
      return;
    }
    const id = crypto.randomUUID();
    currentId = id;
    set({ running: true, error: null });
    const activityId = useActivityStore.getState().start("search", `Searching for "${query}"`);
    try {
      const results = await getServices().search.search(id, {
        query,
        mode,
        caseSensitive,
        regex,
        include: include
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        maxResults: 500,
      });
      if (currentId !== id) {
        useActivityStore.getState().finish(activityId, "cancelled", "Replaced by a newer search");
        return;
      }
      currentId = null;
      set({ results, running: false });
      useActivityStore
        .getState()
        .finish(activityId, "success", `${results.matches.length} matches in ${results.filesSearched} files`);
    } catch (err) {
      if (currentId !== id) return;
      currentId = null;
      const error = toVinnieError(err);
      set({ error, running: false, results: null });
      useActivityStore.getState().finish(activityId, "error", error.message);
    }
  },

  cancel() {
    if (currentId) {
      void getServices().search.cancel(currentId);
      currentId = null;
      set({ running: false });
    }
  },

  clear() {
    get().cancel();
    set({ query: "", results: null, error: null });
  },
}));
