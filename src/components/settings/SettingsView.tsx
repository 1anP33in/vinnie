import { CheckCircle2, FolderOpen, PlugZap, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/common/Button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { CopyButton } from "@/components/common/CopyButton";
import { ErrorNotice } from "@/components/common/ErrorNotice";
import { Spinner } from "@/components/common/Spinner";
import { PROJECT_STATUS_TEXT } from "@/project/status";
import { describeError, toVinnieError, type VinnieError } from "@/lib/errors";
import type { AppInfo, ConnectionInfo, ModelInfo, Settings, StartupBehavior, Theme } from "@/lib/ipc/types";
import { getServices } from "@/services";
import { DEFAULT_ENDPOINT, validateSettings, type SettingsErrors } from "@/settings/validation";
import { useConnectionStore } from "@/state/connectionStore";
import { useConversationStore } from "@/state/conversationStore";
import { useProjectStore } from "@/state/projectStore";
import { useSettingsStore } from "@/state/settingsStore";
import { AllowedCommands, PermissionEditor } from "./WorkspaceSettings";

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

function Field({ label, htmlFor, error, hint, children }: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-faint">{hint}</p>
      )}
    </div>
  );
}

function Toggle({ checked, onChange, label, description }: {
  checked: boolean;
  onChange(value: boolean): void;
  label: string;
  description: string;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span>
        <span className="block text-sm">{label}</span>
        <span className="block text-xs text-faint">{description}</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 size-4 shrink-0 accent-[var(--accent-strong)]"
      />
    </label>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: { value: T; label: string }[];
  onChange(value: T): void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex w-fit rounded-lg border border-border bg-bg p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
            value === o.value ? "bg-surface-3 text-text" : "text-muted hover:text-text"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function IgnoredDirsInput({ value, onChange }: { value: string[]; onChange(v: string[]): void }) {
  const parse = (text: string) =>
    text
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  const [text, setText] = useState(value.join(", "));
  // Resync when the list changes from outside (save, discard).
  const [synced, setSynced] = useState(value);
  if (synced !== value && JSON.stringify(parse(text)) !== JSON.stringify(value)) {
    setSynced(value);
    setText(value.join(", "));
  }
  return (
    <textarea
      id="ignored-dirs"
      rows={3}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const next = parse(e.target.value);
        setSynced(next);
        onChange(next);
      }}
      spellCheck={false}
      className="rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs outline-none focus:border-accent"
    />
  );
}

const inputClass =
  "h-9 rounded-md border border-border bg-bg px-3 text-sm outline-none focus:border-accent aria-[invalid=true]:border-danger";

type TestState =
  | { state: "idle" }
  | { state: "testing" }
  | { state: "ok"; info: ConnectionInfo }
  | { state: "error"; error: VinnieError };

export function SettingsView() {
  const saved = useSettingsStore((s) => s.settings);
  const save = useSettingsStore((s) => s.save);
  const connection = useConnectionStore();
  const conversations = useConversationStore((s) => s.conversations);
  const removeAll = useConversationStore((s) => s.removeAll);
  const project = useProjectStore((s) => s.project);
  const pickProject = useProjectStore((s) => s.pick);
  const clearProject = useProjectStore((s) => s.clear);

  const [draft, setDraft] = useState<Settings>(saved);
  const [errors, setErrors] = useState<SettingsErrors>({});
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [saveError, setSaveError] = useState<VinnieError | null>(null);
  const [test, setTest] = useState<TestState>({ state: "idle" });
  const [draftModels, setDraftModels] = useState<ModelInfo[] | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<VinnieError | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [deleteResult, setDeleteResult] = useState<string | null>(null);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    getServices()
      .system.appInfo()
      .then(setAppInfo)
      .catch(() => setAppInfo(null));
  }, []);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
    setSaveState("idle");
    if (key === "ollamaEndpoint") {
      setTest({ state: "idle" });
      setDraftModels(null);
    }
  };

  const models = draftModels ?? connection.models;
  const defaultModelMissing = !!draft.defaultModel && !models.some((m) => m.name === draft.defaultModel);

  const testConnection = async () => {
    const endpointError = validateSettings(draft).ollamaEndpoint;
    if (endpointError) {
      setErrors((e) => ({ ...e, ollamaEndpoint: endpointError }));
      return;
    }
    setTest({ state: "testing" });
    try {
      const info = await getServices().provider.checkConnection(draft.ollamaEndpoint.trim());
      setTest({ state: "ok", info });
    } catch (err) {
      setTest({ state: "error", error: toVinnieError(err) });
    }
  };

  const refreshModels = async () => {
    const endpointError = validateSettings(draft).ollamaEndpoint;
    if (endpointError) {
      setErrors((e) => ({ ...e, ollamaEndpoint: endpointError }));
      return;
    }
    setModelsLoading(true);
    setModelsError(null);
    try {
      setDraftModels(await getServices().provider.listModels(draft.ollamaEndpoint.trim()));
    } catch (err) {
      setModelsError(toVinnieError(err));
    } finally {
      setModelsLoading(false);
    }
  };

  const onSave = async () => {
    const validation = validateSettings(draft);
    setErrors(validation);
    if (Object.values(validation).some(Boolean)) return;
    setSaveState("saving");
    setSaveError(null);
    try {
      const endpointChanged = draft.ollamaEndpoint.trim().replace(/\/+$/, "") !== saved.ollamaEndpoint;
      const result = await save(draft);
      setDraft(result);
      setSaveState("saved");
      if (endpointChanged) void connection.refresh();
      else if (result.defaultModel && result.defaultModel !== saved.defaultModel) {
        if (connection.models.some((m) => m.name === result.defaultModel)) {
          connection.selectModel(result.defaultModel);
        }
      }
    } catch (err) {
      const error = toVinnieError(err);
      setSaveState("idle");
      if (error.kind === "validation" && /endpoint/i.test(error.message)) {
        setErrors((e) => ({ ...e, ollamaEndpoint: error.message }));
      } else if (error.kind === "validation" && /model/i.test(error.message)) {
        setErrors((e) => ({ ...e, defaultModel: error.message }));
      } else {
        setSaveError(error);
      }
    }
  };

  const onDeleteAll = async () => {
    setDeletingAll(true);
    const count = await removeAll();
    setDeletingAll(false);
    setConfirmDeleteAll(false);
    setDeleteResult(count === null ? null : `Deleted ${count} conversation${count === 1 ? "" : "s"}.`);
  };

  const diagnostics = () =>
    [
      `Vinnie ${appInfo?.version ?? "unknown"}`,
      `Tauri ${appInfo?.tauriVersion ?? "unknown"}`,
      `OS: ${appInfo ? `${appInfo.os} (${appInfo.arch})` : "unknown"}`,
      `Ollama endpoint: ${saved.ollamaEndpoint}`,
      `Ollama status: ${connection.status}${connection.info ? ` (version ${connection.info.version})` : ""}`,
      connection.error ? `Last connection error: ${connection.error.kind}: ${connection.error.message}` : null,
      `Installed models: ${connection.models.length}`,
      `Conversations: ${conversations.length}`,
      `Data folder: ${appInfo?.dataDir ?? "unknown"}`,
      `Log folder: ${appInfo?.logDir ?? "unknown"}`,
    ]
      .filter(Boolean)
      .join("\n");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-5 px-6 py-6">
          <Section title="Ollama connection" description="Vinnie talks to a locally running Ollama server.">
            <Field
              label="Endpoint"
              htmlFor="endpoint"
              error={errors.ollamaEndpoint}
              hint={`Default: ${DEFAULT_ENDPOINT}`}
            >
              <div className="flex gap-2">
                <input
                  id="endpoint"
                  value={draft.ollamaEndpoint}
                  onChange={(e) => update("ollamaEndpoint", e.target.value)}
                  aria-invalid={!!errors.ollamaEndpoint}
                  spellCheck={false}
                  className={`${inputClass} flex-1 font-mono`}
                />
                <Button
                  onClick={() => update("ollamaEndpoint", DEFAULT_ENDPOINT)}
                  disabled={draft.ollamaEndpoint === DEFAULT_ENDPOINT}
                  icon={<RotateCcw size={13} />}
                  title="Reset to default"
                >
                  Reset
                </Button>
              </div>
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={() => void testConnection()}
                disabled={test.state === "testing"}
                icon={test.state === "testing" ? <Spinner size={14} /> : <PlugZap size={14} />}
              >
                Test connection
              </Button>
              {test.state === "ok" && (
                <span className="flex items-center gap-1.5 text-xs text-success">
                  <CheckCircle2 size={14} /> Connected to Ollama {test.info.version}
                </span>
              )}
            </div>
            {test.state === "error" && (
              <ErrorNotice error={test.error} context={{ endpoint: draft.ollamaEndpoint }} compact />
            )}
          </Section>

          <Section title="Models" description="Models are managed by Ollama. Vinnie never downloads models itself.">
            <Field
              label="Default model"
              htmlFor="default-model"
              error={errors.defaultModel}
              hint={
                defaultModelMissing
                  ? "This model isn't installed at the current endpoint; Vinnie will fall back to the first installed model."
                  : "Selected automatically at startup when it is installed."
              }
            >
              <div className="flex gap-2">
                <select
                  id="default-model"
                  value={draft.defaultModel ?? ""}
                  onChange={(e) => update("defaultModel", e.target.value || null)}
                  className={`${inputClass} flex-1 font-mono`}
                >
                  <option value="">First installed model</option>
                  {defaultModelMissing && draft.defaultModel && (
                    <option value={draft.defaultModel}>{draft.defaultModel} (not installed)</option>
                  )}
                  {models.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <Button
                  onClick={() => void refreshModels()}
                  disabled={modelsLoading}
                  icon={<RefreshCw size={13} className={modelsLoading ? "animate-spin" : ""} />}
                >
                  Refresh
                </Button>
              </div>
            </Field>
            {modelsError && <ErrorNotice error={modelsError} context={{ endpoint: draft.ollamaEndpoint }} compact />}
            {draftModels && draftModels.length === 0 && (
              <p className="text-xs text-warning">No models are installed at this endpoint.</p>
            )}
          </Section>

          <Section title="Appearance">
            <Field label="Theme">
              <Segmented<Theme>
                label="Theme"
                value={draft.theme}
                onChange={(v) => update("theme", v)}
                options={[
                  { value: "dark", label: "Dark" },
                  { value: "light", label: "Light" },
                  { value: "system", label: "System" },
                ]}
              />
            </Field>
            <Toggle
              label="Reduce visual effects"
              description="Turns off glow, frost, and animations."
              checked={draft.reduceEffects}
              onChange={(v) => update("reduceEffects", v)}
            />
            <Toggle
              label="Show model reasoning"
              description="Show the reasoning that thinking models (such as qwen3) produce, in a collapsible panel."
              checked={draft.showReasoning}
              onChange={(v) => update("showReasoning", v)}
            />
          </Section>

          <Section title="Startup">
            <Segmented<StartupBehavior>
              label="Startup behavior"
              value={draft.startupBehavior}
              onChange={(v) => update("startupBehavior", v)}
              options={[
                { value: "newConversation", label: "Start a new conversation" },
                { value: "restoreLast", label: "Reopen the last conversation" },
              ]}
            />
          </Section>

          <Section
            title="Assistant permissions"
            description="What Vinnie may do in your project. These rules are enforced by the app itself; the model cannot change them."
          >
            <Toggle
              label="Let Vinnie use project tools"
              description="Search, read, edit, and run commands in the project when you ask. Every change is shown as a diff and can be reverted."
              checked={draft.toolsEnabled}
              onChange={(v) => update("toolsEnabled", v)}
            />
            <Toggle
              label="Include project context"
              description="Send a short project summary, the folder structure, and the file open in the editor with each message (never the whole project)."
              checked={draft.projectContextEnabled}
              onChange={(v) => update("projectContextEnabled", v)}
            />
            <PermissionEditor value={draft.permissions} onChange={(v) => update("permissions", v)} />
            <Field label="Always-allowed commands in this project">
              <AllowedCommands />
            </Field>
          </Section>

          <Section title="Ignored folders" description="Skipped by the explorer (shown dimmed), search, and project analysis.">
            <Field
              label="Folder names (comma or line separated)"
              htmlFor="ignored-dirs"
              error={errors.ignoredDirectories}
            >
              <IgnoredDirsInput value={draft.ignoredDirectories} onChange={(v) => update("ignoredDirectories", v)} />
            </Field>
          </Section>

          <Section title="Project folder" description="The folder Vinnie works in. Files outside it are never read or changed.">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                {project ? (
                  <>
                    <div className="flex items-center gap-1.5 text-sm">
                      <FolderOpen size={14} className="text-accent" /> {project.name}
                    </div>
                    <div className="truncate font-mono text-xs text-faint" title={project.path}>
                      {project.path}
                    </div>
                    {project.status !== "available" && (
                      <div className="mt-1 text-xs text-warning">{PROJECT_STATUS_TEXT[project.status]}</div>
                    )}
                  </>
                ) : (
                  <span className="text-sm text-muted">No folder selected.</span>
                )}
              </div>
              <Button onClick={() => void pickProject()}>{project ? "Change…" : "Choose folder…"}</Button>
              {project && (
                <Button variant="ghost" onClick={() => void clearProject()}>
                  Forget
                </Button>
              )}
            </div>
          </Section>

          <Section title="Conversations" description="Stored locally in an SQLite database on this computer.">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-muted">
                {conversations.length} saved conversation{conversations.length === 1 ? "" : "s"}
              </span>
              <Button
                variant="danger"
                onClick={() => setConfirmDeleteAll(true)}
                disabled={conversations.length === 0}
                icon={<Trash2 size={13} />}
              >
                Delete all conversations
              </Button>
            </div>
            {deleteResult && <p className="text-xs text-success">{deleteResult}</p>}
          </Section>

          <Section title="About & diagnostics">
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-xs">
              <dt className="text-faint">Version</dt>
              <dd>{appInfo ? `Vinnie ${appInfo.version}` : "—"}</dd>
              <dt className="text-faint">Tauri</dt>
              <dd>{appInfo?.tauriVersion ?? "—"}</dd>
              <dt className="text-faint">System</dt>
              <dd>{appInfo ? `${appInfo.os} (${appInfo.arch})` : "—"}</dd>
              <dt className="text-faint">Ollama</dt>
              <dd>
                {connection.status === "connected" && connection.info
                  ? `${connection.info.version} at ${connection.info.endpoint}`
                  : connection.error
                    ? describeError(connection.error).title
                    : connection.status}
              </dd>
              <dt className="text-faint">Data folder</dt>
              <dd className="break-all font-mono">{appInfo?.dataDir ?? "—"}</dd>
              <dt className="text-faint">Logs</dt>
              <dd className="break-all font-mono">{appInfo?.logDir ?? "—"}</dd>
            </dl>
            <p className="text-xs text-faint">
              Logs record events, tool use, commands, and errors — never message contents or file contents.
            </p>
            <div className="flex flex-wrap gap-2">
              <CopyButton text={diagnostics} label="Copy diagnostics" showLabel className="border border-border" />
              <Button size="sm" onClick={() => void getServices().system.openLogDir().catch(() => {})}>
                Open log folder
              </Button>
            </div>
          </Section>
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-bg-elevated px-6 py-3">
        <div className="mx-auto flex max-w-2xl items-center justify-end gap-3">
          {saveError && <span className="mr-auto text-xs text-danger">{describeError(saveError).detail}</span>}
          {saveState === "saved" && !dirty && (
            <span className="mr-auto flex items-center gap-1.5 text-xs text-success">
              <CheckCircle2 size={14} /> Settings saved
            </span>
          )}
          <Button
            variant="ghost"
            onClick={() => {
              setDraft(saved);
              setErrors({});
            }}
            disabled={!dirty || saveState === "saving"}
          >
            Discard
          </Button>
          <Button variant="primary" onClick={() => void onSave()} disabled={!dirty || saveState === "saving"}>
            {saveState === "saving" ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDeleteAll}
        title="Delete all conversations?"
        description={`All ${conversations.length} conversations and their messages will be permanently deleted. This can't be undone.`}
        confirmLabel="Delete all"
        destructive
        busy={deletingAll}
        onConfirm={() => void onDeleteAll()}
        onCancel={() => setConfirmDeleteAll(false)}
      />
    </div>
  );
}
