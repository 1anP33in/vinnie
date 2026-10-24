import { ChevronRight, GitBranch, Package, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Spinner } from "@/components/common/Spinner";
import { describeError } from "@/lib/errors";
import type { ManagerDetection } from "@/lib/ipc/types";
import { getServices } from "@/services";
import { useEditorStore } from "@/state/editorStore";
import { useTerminalStore } from "@/state/terminalStore";
import { useUiStore } from "@/state/uiStore";
import { useWorkspaceStore } from "@/state/workspaceStore";

function FileLink({ path }: { path: string }) {
  const openFile = useEditorStore((s) => s.openFile);
  return (
    <button type="button" onClick={() => void openFile(path)} className="font-mono text-accent hover:underline">
      {path}
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-faint">{label}</dt>
      <dd className="min-w-0 flex-1 break-words">{children}</dd>
    </div>
  );
}

function ManagerRow({ d }: { d: ManagerDetection }) {
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState(d.manager ?? d.candidates[0] ?? "");
  const install = async () => {
    setBusy(true);
    try {
      const cmd = await getServices().analysis.installCommand(choice, []);
      if (!window.confirm(`Run "${cmd.display}" in the project folder?`)) return;
      useUiStore.getState().showBottom("terminal");
      await useTerminalStore.getState().run({ command: cmd.display, actor: "user" }).catch(() => {});
      void useWorkspaceStore.getState().analyze();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Package size={12} className="text-faint" />
      {d.ambiguous ? (
        <>
          <select
            aria-label={`Package manager for ${d.ecosystem}`}
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            className="rounded border border-border bg-bg px-1 text-xs"
          >
            {d.candidates.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <span className="text-warning" title={d.reason}>
            unclear
          </span>
        </>
      ) : (
        <span title={d.reason}>{d.manager}</span>
      )}
      <button
        type="button"
        onClick={() => void install()}
        disabled={busy || !choice}
        className="rounded px-1.5 text-accent hover:bg-surface-3 disabled:opacity-50"
        title="Install the project's dependencies"
      >
        Install
      </button>
    </div>
  );
}

export function ProjectInfo() {
  const metadata = useWorkspaceStore((s) => s.metadata);
  const analyzing = useWorkspaceStore((s) => s.analyzing);
  const error = useWorkspaceStore((s) => s.analysisError);
  const git = useWorkspaceStore((s) => s.git);
  const analyze = useWorkspaceStore((s) => s.analyze);
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-border px-3 py-2 text-xs">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1 text-left text-muted hover:text-text"
        >
          <ChevronRight size={12} className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
          <span className="truncate">
            {analyzing && !metadata
              ? "Analyzing project…"
              : metadata?.projectTypes.length
                ? metadata.projectTypes.join(" · ")
                : metadata
                  ? "No known project type detected"
                  : "Project details"}
          </span>
        </button>
        {analyzing ? (
          <Spinner size={12} className="text-faint" />
        ) : (
          <button type="button" aria-label="Re-analyze project" title="Re-analyze project" onClick={() => void analyze()} className="text-faint hover:text-text">
            <RefreshCw size={12} />
          </button>
        )}
      </div>
      {git?.isRepo && (
        <div className="mt-1 flex items-center gap-1 pl-4 text-faint" title={git.upstream ? `Tracking ${git.upstream}` : undefined}>
          <GitBranch size={11} />
          <span className="text-muted">{git.branch ?? "detached HEAD"}</span>
          {(git.modified.length > 0 || git.untracked.length > 0) && (
            <span>
              · {git.modified.length} modified · {git.untracked.length} untracked
            </span>
          )}
          {git.ahead > 0 && <span>· ↑{git.ahead}</span>}
          {git.behind > 0 && <span>· ↓{git.behind}</span>}
        </div>
      )}
      {error && <p className="mt-1 text-danger">{describeError(error).detail}</p>}
      {open && metadata && (
        <dl className="mt-2 flex flex-col gap-1.5 pl-4 text-muted" data-testid="project-details">
          <Row label="Languages">
            {metadata.languages.length
              ? metadata.languages.slice(0, 6).map((l) => `${l.name} (${l.files})`).join(", ")
              : "none detected"}
          </Row>
          {metadata.frameworks.length > 0 && <Row label="Frameworks">{metadata.frameworks.join(", ")}</Row>}
          {metadata.packageManagers.length > 0 && (
            <Row label="Packages">
              <div className="flex flex-col gap-1">
                {metadata.packageManagers.map((d) => (
                  <ManagerRow key={d.ecosystem} d={d} />
                ))}
              </div>
            </Row>
          )}
          {metadata.entryPoints.length > 0 && (
            <Row label="Entry points">
              <div className="flex flex-wrap gap-x-2">
                {metadata.entryPoints.map((p) => (
                  <FileLink key={p} path={p} />
                ))}
              </div>
            </Row>
          )}
          {metadata.configFiles.length > 0 && (
            <Row label="Config">
              <div className="flex flex-wrap gap-x-2">
                {metadata.configFiles.map((p) => (
                  <FileLink key={p} path={p} />
                ))}
              </div>
            </Row>
          )}
          {(metadata.readme || metadata.instructionFiles.length > 0) && (
            <Row label="Docs">
              <div className="flex flex-wrap gap-x-2">
                {[metadata.readme, ...metadata.instructionFiles].filter(Boolean).map((p) => (
                  <FileLink key={p} path={p!} />
                ))}
              </div>
            </Row>
          )}
          {metadata.fivem && (
            <Row label="FiveM">
              {metadata.fivem.fxVersion ?? "fx_version ?"} · {metadata.fivem.clientScripts.length} client ·{" "}
              {metadata.fivem.serverScripts.length} server · {metadata.fivem.sharedScripts.length} shared
              {metadata.fivem.uiPage ? ` · UI: ${metadata.fivem.uiPage}` : ""}
            </Row>
          )}
          <p className="text-[11px] text-faint">
            Detected from {metadata.filesScanned.toLocaleString()} files{metadata.scanTruncated ? " (scan limit reached)" : ""}. Detection is based on
            file names and manifests, so it may be incomplete.
          </p>
        </dl>
      )}
    </div>
  );
}
