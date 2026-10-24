// Configure Monaco to load from the app bundle (no CDN; the CSP forbids
// remote scripts) with its language workers built by Vite.

import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import TsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    switch (label) {
      case "json":
        return new JsonWorker();
      case "css":
      case "scss":
      case "less":
        return new CssWorker();
      case "html":
      case "handlebars":
      case "razor":
        return new HtmlWorker();
      case "typescript":
      case "javascript":
        return new TsWorker();
      default:
        return new EditorWorker();
    }
  },
};

// The TS worker cannot see node_modules, so semantic errors would be noise.
// Keep syntax checking only.
type DiagnosticsDefaults = { setDiagnosticsOptions(o: { noSemanticValidation: boolean; noSyntaxValidation: boolean }): void };
const ts = (monaco.languages as unknown as { typescript?: Record<string, DiagnosticsDefaults> }).typescript;
for (const key of ["typescriptDefaults", "javascriptDefaults"]) {
  ts?.[key]?.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
}

loader.config({ monaco });
