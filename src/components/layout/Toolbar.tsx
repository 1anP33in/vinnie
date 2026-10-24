import { AlertTriangle, ChevronDown, FolderOpen, RefreshCw, Settings as SettingsIcon } from "lucide-react";
import { IconButton } from "@/components/common/Button";
import { formatBytes } from "@/lib/dates";
import { useChatStore } from "@/state/chatStore";
import { useConnectionStore } from "@/state/connectionStore";
import { useConversationStore } from "@/state/conversationStore";
import { useProjectStore } from "@/state/projectStore";
import { useUiStore } from "@/state/uiStore";

function ModelSelector() {
  const models = useConnectionStore((s) => s.models);
  const selected = useConnectionStore((s) => s.selectedModel);
  const modelsStatus = useConnectionStore((s) => s.modelsStatus);
  const status = useConnectionStore((s) => s.status);
  const selectModel = useConnectionStore((s) => s.selectModel);
  const refresh = useConnectionStore((s) => s.refresh);
  const generating = useChatStore((s) => s.generation !== null);

  const loading = modelsStatus === "loading" || status === "checking";
  const placeholder =
    status === "disconnected" ? "Ollama offline" : modelsStatus === "loaded" ? "No models installed" : "Loading models…";

  return (
    <div className="flex items-center gap-1">
      <div className="relative">
        <select
          aria-label="Model"
          value={selected ?? ""}
          disabled={models.length === 0 || generating}
          onChange={(e) => selectModel(e.target.value || null)}
          title={generating ? "The model can be changed after the current response finishes" : "Model"}
          className="h-8 max-w-56 appearance-none truncate rounded-md border border-border bg-surface pl-2.5 pr-7 font-mono text-xs text-text outline-none hover:border-border-strong focus:border-accent disabled:text-faint"
        >
          {models.length === 0 && <option value="">{placeholder}</option>}
          {models.map((m) => (
            <option key={m.name} value={m.name}>
              {m.name}
              {m.parameterSize ? ` · ${m.parameterSize}` : ""}
              {m.sizeBytes ? ` · ${formatBytes(m.sizeBytes)}` : ""}
            </option>
          ))}
        </select>
        <ChevronDown
          size={13}
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-faint"
        />
      </div>
      <IconButton label="Refresh models" onClick={() => void refresh()} disabled={loading}>
        <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
      </IconButton>
    </div>
  );
}

export function ConnectionIndicator() {
  const status = useConnectionStore((s) => s.status);
  const info = useConnectionStore((s) => s.info);
  const refresh = useConnectionStore((s) => s.refresh);

  const config = {
    connected: { dot: "bg-success", label: info ? `Ollama ${info.version}` : "Connected" },
    disconnected: { dot: "bg-danger", label: "Disconnected" },
    checking: { dot: "bg-warning pulse-dot", label: "Connecting…" },
    unknown: { dot: "bg-faint", label: "Not checked" },
  }[status];

  return (
    <button
      type="button"
      onClick={() => void refresh()}
      title={status === "connected" && info ? `Connected to ${info.endpoint}. Click to re-check.` : "Click to re-check"}
      aria-label={`Ollama connection: ${config.label}. Re-check`}
      className="flex h-8 items-center gap-2 rounded-md px-2 text-xs text-muted hover:bg-surface-2 hover:text-text"
    >
      <span className={`size-2 rounded-full ${config.dot}`} aria-hidden="true" />
      {config.label}
    </button>
  );
}

function ProjectChip() {
  const project = useProjectStore((s) => s.project);
  const pick = useProjectStore((s) => s.pick);
  if (!project) return null;
  const ok = project.status === "available";
  return (
    <button
      type="button"
      onClick={() => void pick()}
      title={`${project.path}${ok ? "" : " (not found)"}\nClick to change`}
      className="flex h-8 max-w-48 items-center gap-1.5 rounded-md px-2 text-xs text-muted hover:bg-surface-2 hover:text-text"
    >
      {ok ? <FolderOpen size={13} className="text-accent" /> : <AlertTriangle size={13} className="text-warning" />}
      <span className="truncate">{project.name}</span>
    </button>
  );
}

export function Toolbar() {
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);
  const activeId = useConversationStore((s) => s.activeId);
  const conversations = useConversationStore((s) => s.conversations);
  const title =
    view === "settings"
      ? "Settings"
      : (conversations.find((c) => c.id === activeId)?.title ?? "New conversation");

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-bg px-4">
      <h1 className="min-w-0 flex-1 truncate text-sm font-medium" title={title}>
        {title}
      </h1>
      <ProjectChip />
      <ModelSelector />
      <div className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
      <ConnectionIndicator />
      <IconButton label="Settings" active={view === "settings"} onClick={() => setView(view === "settings" ? "chat" : "settings")}>
        <SettingsIcon size={15} />
      </IconButton>
    </header>
  );
}
