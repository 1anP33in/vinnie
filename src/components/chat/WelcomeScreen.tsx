import { FolderOpen, RefreshCw, Settings as SettingsIcon } from "lucide-react";
import { Button } from "@/components/common/Button";
import { ErrorNotice } from "@/components/common/ErrorNotice";
import { Logo } from "@/components/common/Logo";
import { Spinner } from "@/components/common/Spinner";
import { useConnectionStore } from "@/state/connectionStore";
import { useProjectStore } from "@/state/projectStore";
import { useSettingsStore } from "@/state/settingsStore";
import { useUiStore } from "@/state/uiStore";
import { DragonPlaceholder } from "./DragonPlaceholder";
import { NoModelsNotice } from "./NoModelsNotice";

const SUGGESTIONS = [
  "Explain the difference between a process and a thread.",
  "Write a TypeScript function that debounces another function.",
  "Review this error message and suggest likely causes:",
  "Help me plan the folder structure for a new Rust CLI.",
];

function ConnectionPanel() {
  const status = useConnectionStore((s) => s.status);
  const error = useConnectionStore((s) => s.error);
  const models = useConnectionStore((s) => s.models);
  const modelsStatus = useConnectionStore((s) => s.modelsStatus);
  const modelsError = useConnectionStore((s) => s.modelsError);
  const refresh = useConnectionStore((s) => s.refresh);
  const refreshModels = useConnectionStore((s) => s.refreshModels);
  const endpoint = useSettingsStore((s) => s.settings.ollamaEndpoint);
  const setView = useUiStore((s) => s.setView);
  const fillComposer = useUiStore((s) => s.fillComposer);

  if (status === "unknown" || status === "checking") {
    return (
      <div className="flex items-center justify-center gap-2 text-sm text-muted">
        <Spinner /> Connecting to Ollama…
      </div>
    );
  }
  if (status === "disconnected") {
    return (
      <ErrorNotice
        error={error}
        context={{ endpoint }}
        actions={
          <>
            <Button size="sm" onClick={() => void refresh()} icon={<RefreshCw size={13} />}>
              Try again
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setView("settings")} icon={<SettingsIcon size={13} />}>
              Open settings
            </Button>
          </>
        }
      />
    );
  }
  if (modelsStatus === "loading" && models.length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 text-sm text-muted">
        <Spinner /> Loading installed models…
      </div>
    );
  }
  if (modelsStatus === "error") {
    return (
      <ErrorNotice
        error={modelsError}
        context={{ endpoint }}
        actions={
          <Button size="sm" onClick={() => void refreshModels()} icon={<RefreshCw size={13} />}>
            Try again
          </Button>
        }
      />
    );
  }
  if (modelsStatus === "loaded" && models.length === 0) {
    return <NoModelsNotice onRefresh={() => void refreshModels()} />;
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {SUGGESTIONS.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => fillComposer(s)}
          className="rounded-lg border border-border bg-surface px-3.5 py-3 text-left text-sm text-muted transition-colors hover:border-border-strong hover:text-text"
        >
          {s}
        </button>
      ))}
    </div>
  );
}

export function WelcomeScreen() {
  const project = useProjectStore((s) => s.project);
  const selectedModel = useConnectionStore((s) => s.selectedModel);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-12 text-center">
        <div className="flex flex-col items-center">
          <div className="rounded-2xl border border-border bg-surface p-3 shadow-glow">
            <Logo size={52} />
          </div>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">Welcome to Vinnie</h1>
          <p className="mt-2 text-muted">A local AI assistant running on your machine through Ollama.</p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-xs text-faint">
            {selectedModel && (
              <span className="rounded-full border border-border px-2.5 py-0.5">
                Model: <span className="font-mono text-muted">{selectedModel}</span>
              </span>
            )}
            {project && (
              <span className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5">
                <FolderOpen size={11} /> {project.name}
              </span>
            )}
          </div>
        </div>
        <ConnectionPanel />
        {project && (
          <p className="text-xs text-faint">
            Project folder selected. Vinnie doesn't read project files yet; workspace awareness arrives in the next
            phase.
          </p>
        )}
        <DragonPlaceholder />
      </div>
    </div>
  );
}
