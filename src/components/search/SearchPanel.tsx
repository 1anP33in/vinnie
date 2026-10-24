import { CaseSensitive, FileSearch, Regex, X } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Spinner } from "@/components/common/Spinner";
import { describeError } from "@/lib/errors";
import type { SearchMatch } from "@/lib/ipc/types";
import { useEditorStore } from "@/state/editorStore";
import { useProjectStore } from "@/state/projectStore";
import { useSearchStore } from "@/state/searchStore";
import { fileIcon } from "../explorer/fileIcons";

const DEBOUNCE_MS = 300;

function Toggle({ on, label, onClick, children }: { on: boolean; label: string; onClick(): void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`inline-flex size-6 items-center justify-center rounded ${
        on ? "bg-accent-soft text-accent" : "text-faint hover:bg-surface-3 hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

function group(matches: SearchMatch[]): [string, SearchMatch[]][] {
  const map = new Map<string, SearchMatch[]>();
  for (const m of matches) {
    const list = map.get(m.path) ?? [];
    list.push(m);
    map.set(m.path, list);
  }
  return [...map.entries()];
}

export function SearchPanel() {
  const s = useSearchStore();
  const project = useProjectStore((p) => p.project);
  const openFile = useEditorStore((e) => e.openFile);
  const { query, mode, caseSensitive, regex, include, run } = s;

  // Search as the user types (debounced); a new search cancels the previous one.
  useEffect(() => {
    if (!project || project.status !== "available") return;
    const t = setTimeout(() => void run(), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, mode, caseSensitive, regex, include, project, run]);

  const groups = useMemo(() => group(s.results?.matches ?? []), [s.results]);

  if (!project || project.status !== "available") {
    return <p className="px-4 py-6 text-sm text-muted">Choose a project folder to search its files.</p>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-1.5 px-3 pb-2 pt-1">
        <div className="relative">
          <input
            value={query}
            onChange={(e) => s.set({ query: e.target.value })}
            placeholder={mode === "filename" ? "Search file names" : "Search in files"}
            aria-label="Search query"
            spellCheck={false}
            className="h-8 w-full rounded-md border border-border bg-surface pl-2.5 pr-[84px] text-sm outline-none focus:border-accent"
          />
          <div className="absolute right-1 top-1/2 flex -translate-y-1/2 gap-0.5">
            <Toggle on={caseSensitive} label="Match case" onClick={() => s.set({ caseSensitive: !caseSensitive })}>
              <CaseSensitive size={14} />
            </Toggle>
            <Toggle on={regex} label="Use regular expression" onClick={() => s.set({ regex: !regex })}>
              <Regex size={13} />
            </Toggle>
            <Toggle
              on={mode === "filename"}
              label="Search file names instead of contents"
              onClick={() => s.set({ mode: mode === "filename" ? "text" : "filename" })}
            >
              <FileSearch size={13} />
            </Toggle>
          </div>
        </div>
        <input
          value={include}
          onChange={(e) => s.set({ include: e.target.value })}
          placeholder="Files to include, e.g. lua, *.ts"
          aria-label="File types to include"
          spellCheck={false}
          className="h-7 w-full rounded-md border border-border bg-surface px-2.5 text-xs outline-none focus:border-accent"
        />
        <div className="flex h-4 items-center gap-1.5 text-[11px] text-faint" aria-live="polite">
          {s.running && (
            <>
              <Spinner size={11} /> Searching…
              <button type="button" onClick={s.cancel} className="ml-auto inline-flex items-center hover:text-text" aria-label="Cancel search">
                <X size={11} />
              </button>
            </>
          )}
          {!s.running && s.results && (
            <span>
              {s.results.matches.length} result{s.results.matches.length === 1 ? "" : "s"} in {groups.length} file
              {groups.length === 1 ? "" : "s"}
              {s.results.truncated ? " (limit reached — refine your search)" : ""}
              {s.results.timedOut ? " (stopped: took too long)" : ""}
            </span>
          )}
        </div>
      </div>
      {s.error && <p className="px-3 text-xs text-danger" role="alert">{describeError(s.error).detail}</p>}
      <div className="min-h-0 flex-1 overflow-auto pb-2" data-testid="search-results">
        {groups.map(([path, matches]) => {
          const name = path.split("/").pop() ?? path;
          const { Icon, className } = fileIcon(name, "file");
          return (
            <div key={path} className="mb-1">
              <button
                type="button"
                onClick={() => void openFile(path, matches[0]?.line || undefined)}
                className="flex w-full items-center gap-1.5 px-3 py-0.5 text-left text-xs hover:bg-surface-2"
                title={path}
              >
                <Icon size={13} className={`shrink-0 ${className}`} />
                <span className="truncate text-text">{name}</span>
                <span className="truncate text-faint">{path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""}</span>
                {mode === "text" && <span className="ml-auto shrink-0 text-faint">{matches.length}</span>}
              </button>
              {mode === "text" &&
                matches.map((m) => (
                  <button
                    key={`${m.line}:${m.column}`}
                    type="button"
                    onClick={() => void openFile(m.path, m.line)}
                    className="flex w-full gap-2 py-0.5 pl-8 pr-3 text-left font-mono text-[11.5px] text-muted hover:bg-surface-2 hover:text-text"
                    title={`${m.path}:${m.line}`}
                  >
                    <span className="w-8 shrink-0 text-right text-faint">{m.line}</span>
                    <span className="truncate">{m.preview}</span>
                  </button>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
