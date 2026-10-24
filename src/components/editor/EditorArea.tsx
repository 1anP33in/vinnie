import Editor, { type OnMount } from "@monaco-editor/react";
import {
  AlertTriangle,
  Copy,
  FileDiff,
  RefreshCw,
  Save,
  Search,
  X,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { Button, IconButton } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { copyText } from "@/lib/clipboard";
import { isDirty, useEditorStore, type EditorTab, type FileTab } from "@/state/editorStore";
import { useSettingsStore } from "@/state/settingsStore";
import { DiffView } from "./DiffView";
import { EDITOR_FONT, defineThemes, editorTheme, languageForPath } from "./languages";

type EditorInstance = Parameters<OnMount>[0];
type MonacoInstance = Parameters<OnMount>[1];

const STATUS_LABEL: Record<FileTab["status"], string> = {
  loading: "Loading…",
  saved: "Saved",
  modified: "Modified",
  external: "External modification detected",
  deleted: "Deleted on disk",
  error: "Error",
  binary: "Binary file",
  tooLarge: "Too large to open",
};

function TabButton({ tab, active }: { tab: EditorTab; active: boolean }) {
  const activate = useEditorStore((s) => s.activate);
  const close = useEditorStore((s) => s.close);
  const dirty = isDirty(tab);
  const warn = tab.kind === "file" && (tab.status === "external" || tab.status === "deleted");
  return (
    <div
      role="tab"
      aria-selected={active}
      title={tab.path}
      className={`group flex h-full max-w-56 shrink-0 cursor-pointer items-center gap-1.5 border-r border-border px-3 text-xs ${
        active ? "bg-bg text-text" : "bg-bg-elevated text-muted hover:text-text"
      }`}
      onClick={() => activate(tab.id)}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          close(tab.id);
        }
      }}
    >
      {tab.kind === "diff" && <FileDiff size={12} className="shrink-0 text-accent" />}
      {warn && <AlertTriangle size={12} className="shrink-0 text-warning" />}
      <span className="truncate">{tab.title}</span>
      <button
        type="button"
        aria-label={dirty ? `${tab.title} has unsaved changes. Close` : `Close ${tab.title}`}
        onClick={(e) => {
          e.stopPropagation();
          if (dirty && !window.confirm(`${tab.title} has unsaved changes. Close it and discard them?`)) return;
          close(tab.id);
        }}
        className="ml-0.5 inline-flex size-4 items-center justify-center rounded hover:bg-surface-3"
      >
        {dirty ? (
          <span className="size-2 rounded-full bg-accent group-hover:hidden" aria-hidden="true" />
        ) : null}
        <X size={11} className={dirty ? "hidden group-hover:block" : ""} />
      </button>
    </div>
  );
}

function FileToolbar({ tab, editor }: { tab: FileTab; editor: React.RefObject<EditorInstance | null> }) {
  const save = useEditorStore((s) => s.save);
  const reload = useEditorStore((s) => s.reload);
  const dirty = isDirty(tab);
  const tone =
    tab.status === "saved"
      ? "text-success"
      : tab.status === "modified"
        ? "text-accent"
        : tab.status === "external" || tab.status === "deleted" || tab.status === "error"
          ? "text-warning"
          : "text-muted";
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-bg px-3 text-xs">
      <span className="min-w-0 flex-1 truncate font-mono text-faint" title={tab.path}>
        {tab.path}
      </span>
      <span className={`flex items-center gap-1 ${tone}`} data-testid="file-status">
        {tab.saving ? <Spinner size={11} /> : <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />}
        {tab.saving ? "Saving…" : STATUS_LABEL[tab.status]}
      </span>
      <span className="text-faint">{languageForPath(tab.path)}</span>
      <IconButton
        label="Find in file (Ctrl+F)"
        className="size-6"
        disabled={!editor.current}
        onClick={() => void editor.current?.getAction("actions.find")?.run()}
      >
        <Search size={13} />
      </IconButton>
      <IconButton
        label="Copy file contents"
        className="size-6"
        disabled={tab.draft == null}
        onClick={() => void copyText(tab.draft ?? "")}
      >
        <Copy size={13} />
      </IconButton>
      <IconButton
        label="Reload from disk"
        className="size-6"
        onClick={() => {
          if (dirty && !window.confirm("Reload from disk and discard your unsaved changes?")) return;
          void reload(tab.path);
        }}
      >
        <RefreshCw size={13} />
      </IconButton>
      <IconButton
        label="Save (Ctrl+S)"
        className="size-6"
        disabled={(!dirty && tab.status !== "deleted") || tab.saving || tab.status === "external"}
        onClick={() => void save(tab.path)}
      >
        <Save size={13} />
      </IconButton>
    </div>
  );
}

function ExternalBanner({ tab }: { tab: FileTab }) {
  const save = useEditorStore((s) => s.save);
  const reload = useEditorStore((s) => s.reload);
  const compare = useEditorStore((s) => s.compareWithDisk);
  if (tab.status !== "external" && tab.status !== "deleted") return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-warning/30 bg-warning-soft px-3 py-1.5 text-xs" role="alert">
      <AlertTriangle size={13} className="text-warning" />
      <span className="flex-1 text-text">
        {tab.status === "deleted"
          ? "This file no longer exists on disk. Save to recreate it, or close the tab."
          : "This file changed on disk while you have unsaved edits. Your edits have not been saved."}
      </span>
      {tab.status === "external" && (
        <>
          <Button size="sm" variant="ghost" onClick={() => void compare(tab.path)}>
            Compare
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void reload(tab.path)}>
            Use disk version
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              if (window.confirm("Overwrite the version on disk with your edits?")) void save(tab.path, true);
            }}
          >
            Overwrite with mine
          </Button>
        </>
      )}
    </div>
  );
}

function FileEditor({ tab }: { tab: FileTab }) {
  const setDraft = useEditorStore((s) => s.setDraft);
  const reveal = useEditorStore((s) => s.reveal);
  const revealHandled = useEditorStore((s) => s.revealHandled);
  useSettingsStore((s) => s.settings.theme);
  const editorRef = useRef<EditorInstance | null>(null);

  const doReveal = (editor: EditorInstance) => {
    const r = useEditorStore.getState().reveal;
    if (!r || r.path !== tab.path) return;
    editor.revealLineInCenter(r.line);
    editor.setPosition({ lineNumber: r.line, column: 1 });
    editor.focus();
    revealHandled();
  };

  useEffect(() => {
    if (editorRef.current && reveal?.path === tab.path) doReveal(editorRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal, tab.path]);

  const onMount = (editor: EditorInstance, monaco: MonacoInstance) => {
    editorRef.current = editor;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const current = useEditorStore.getState().tabs.find((t) => t.id === tab.id);
      if (current?.kind === "file" && current.status !== "external") void useEditorStore.getState().save(tab.path);
    });
    doReveal(editor);
  };

  let body: React.ReactNode;
  if (tab.status === "loading" && tab.draft == null) {
    body = (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted">
        <Spinner /> Opening {tab.title}…
      </div>
    );
  } else if (tab.status === "binary") {
    body = <Notice text={`${tab.title} is a binary file and can't be displayed as text.`} />;
  } else if (tab.status === "tooLarge") {
    body = <Notice text={`${tab.title} is larger than 2 MB, so Vinnie won't load it into the editor.`} />;
  } else if (tab.status === "error" && tab.draft == null) {
    body = <Notice text={tab.error ?? "This file could not be opened."} />;
  } else {
    body = (
      <div className="min-h-0 flex-1">
        <Editor
          path={tab.path}
          value={tab.draft ?? ""}
          language={languageForPath(tab.path)}
          theme={editorTheme()}
          beforeMount={defineThemes}
          onMount={onMount}
          onChange={(value) => setDraft(tab.path, value ?? "")}
          loading={<Spinner />}
          options={{
            automaticLayout: true,
            fontFamily: EDITOR_FONT,
            fontSize: 13,
            minimap: { enabled: true, renderCharacters: false, scale: 1 },
            scrollBeyondLastLine: false,
            renderWhitespace: "selection",
            tabSize: 4,
            detectIndentation: true,
            smoothScrolling: true,
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FileToolbar tab={tab} editor={editorRef} />
      <ExternalBanner tab={tab} />
      {tab.error && tab.draft != null && (
        <div className="border-b border-danger/30 bg-danger-soft px-3 py-1 text-xs text-danger" role="alert">
          {tab.error}
        </div>
      )}
      {body}
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted">{text}</div>;
}

export function EditorArea() {
  const tabs = useEditorStore((s) => s.tabs);
  const activeId = useEditorStore((s) => s.activeId);
  const checkExternal = useEditorStore((s) => s.checkExternal);
  const active = tabs.find((t) => t.id === activeId) ?? null;

  // Detect external modifications while files are open.
  useEffect(() => {
    if (tabs.length === 0) return;
    const onFocus = () => void checkExternal();
    window.addEventListener("focus", onFocus);
    const timer = setInterval(onFocus, 3_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(timer);
    };
  }, [tabs.length, checkExternal]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg" data-testid="editor-area">
      <div role="tablist" className="flex h-9 shrink-0 overflow-x-auto border-b border-border bg-bg-elevated">
        {tabs.map((t) => (
          <TabButton key={t.id} tab={t} active={t.id === activeId} />
        ))}
      </div>
      {active?.kind === "file" && <FileEditor key={active.id} tab={active} />}
      {active?.kind === "diff" && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-8 shrink-0 items-center border-b border-border px-3 text-xs text-faint">
            <span className="font-mono">{active.path}</span>
            <span className="ml-3">− previous · + new</span>
          </div>
          <div className="min-h-0 flex-1">
            <DiffView key={active.id} path={active.path} original={active.original} modified={active.modified} />
          </div>
        </div>
      )}
    </div>
  );
}
