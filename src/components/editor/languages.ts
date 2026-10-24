import type { Monaco } from "@monaco-editor/react";

const BY_EXTENSION: Record<string, string> = {
  lua: "lua",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescript",
  py: "python",
  cs: "csharp",
  json: "json",
  jsonc: "json",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  less: "less",
  md: "markdown",
  markdown: "markdown",
  yaml: "yaml",
  yml: "yaml",
  xml: "xml",
  csproj: "xml",
  sln: "plaintext",
  sql: "sql",
  toml: "ini",
  ini: "ini",
  cfg: "ini",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  php: "php",
  rb: "ruby",
  sh: "shell",
  ps1: "powershell",
  bat: "bat",
  cmd: "bat",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  vue: "html",
  svelte: "html",
  dockerfile: "dockerfile",
  txt: "plaintext",
};

/** Monaco language id for a file path. */
export function languageForPath(path: string): string {
  const name = path.split("/").pop()?.toLowerCase() ?? "";
  if (name === "dockerfile") return "dockerfile";
  if (name.startsWith(".env")) return "ini";
  const ext = name.includes(".") ? name.split(".").pop()! : "";
  return BY_EXTENSION[ext] ?? "plaintext";
}

export const EDITOR_FONT = "'Cascadia Code', 'Cascadia Mono', Consolas, monospace";

/** Register Vinnie's editor themes (idempotent). */
export function defineThemes(monaco: Monaco): void {
  monaco.editor.defineTheme("vinnie-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "64748b", fontStyle: "italic" },
      { token: "keyword", foreground: "7dd3fc" },
      { token: "string", foreground: "a7f3d0" },
      { token: "number", foreground: "fcd34d" },
      { token: "type", foreground: "67e8f9" },
    ],
    colors: {
      "editor.background": "#0b1322",
      "editor.lineHighlightBackground": "#121b2d",
      "editorLineNumber.foreground": "#3b4a66",
      "editorLineNumber.activeForeground": "#7dd3fc",
      "editor.selectionBackground": "#22d3ee33",
      "editorCursor.foreground": "#7dd3fc",
      "editorWidget.background": "#121b2d",
      "editorGutter.background": "#0b1322",
      "diffEditor.insertedTextBackground": "#34d39926",
      "diffEditor.removedTextBackground": "#f8717126",
    },
  });
  monaco.editor.defineTheme("vinnie-light", {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#ffffff",
      "editor.lineHighlightBackground": "#f1f5f9",
      "editorLineNumber.foreground": "#94a3b8",
    },
  });
}

export function editorTheme(): string {
  return document.documentElement.dataset.theme === "light" ? "vinnie-light" : "vinnie-dark";
}
