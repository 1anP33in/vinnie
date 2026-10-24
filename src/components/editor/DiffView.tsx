import { DiffEditor } from "@monaco-editor/react";
import { Columns2, Rows2 } from "lucide-react";
import { useState } from "react";
import { Spinner } from "@/components/common/Spinner";
import { useSettingsStore } from "@/state/settingsStore";
import { EDITOR_FONT, defineThemes, editorTheme, languageForPath } from "./languages";

/** Read-only diff (old on the left/top, new on the right/bottom). */
export function DiffView({
  path,
  original,
  modified,
  height = "100%",
  initialSideBySide = true,
}: {
  path: string;
  original: string;
  modified: string;
  height?: number | string;
  initialSideBySide?: boolean;
}) {
  const [sideBySide, setSideBySide] = useState(initialSideBySide);
  // Re-render when the theme changes so the editor picks up the new theme.
  useSettingsStore((s) => s.settings.theme);
  return (
    <div className="relative flex min-h-0 flex-col" style={{ height }} data-testid="diff-view">
      <button
        type="button"
        onClick={() => setSideBySide((v) => !v)}
        className="absolute right-3 top-1.5 z-10 inline-flex items-center gap-1 rounded border border-border bg-surface px-1.5 py-0.5 text-[11px] text-muted hover:text-text"
        title={sideBySide ? "Show inline" : "Show side by side"}
      >
        {sideBySide ? <Rows2 size={11} /> : <Columns2 size={11} />}
        {sideBySide ? "Inline" : "Side by side"}
      </button>
      <DiffEditor
        original={original}
        modified={modified}
        language={languageForPath(path)}
        theme={editorTheme()}
        beforeMount={defineThemes}
        loading={<Spinner />}
        options={{
          readOnly: true,
          originalEditable: false,
          renderSideBySide: sideBySide,
          automaticLayout: true,
          minimap: { enabled: false },
          fontFamily: EDITOR_FONT,
          fontSize: 12.5,
          scrollBeyondLastLine: false,
          renderOverviewRuler: false,
        }}
      />
    </div>
  );
}
