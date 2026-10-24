import {
  Braces,
  File,
  FileCode,
  FileCog,
  FileImage,
  FileJson,
  FileLock,
  FileText,
  FileTerminal,
  Folder,
  FolderOpen,
  Link2,
  type LucideIcon,
} from "lucide-react";
import type { EntryKind } from "@/lib/ipc/types";

const CODE = new Set(["lua", "js", "mjs", "cjs", "jsx", "ts", "tsx", "py", "cs", "rs", "go", "java", "kt", "php", "rb", "c", "cpp", "h", "vue", "svelte"]);
const MARKUP = new Set(["html", "htm", "css", "scss", "less", "xml", "sql"]);
const CONFIG = new Set(["toml", "yaml", "yml", "ini", "cfg", "csproj", "sln", "editorconfig"]);
const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "svg", "ico", "webp", "bmp"]);
const SCRIPT = new Set(["sh", "ps1", "bat", "cmd"]);
const LOCK = new Set(["lock", "lockb"]);

export function fileIcon(name: string, kind: EntryKind, open = false): { Icon: LucideIcon; className: string } {
  if (kind === "directory") return { Icon: open ? FolderOpen : Folder, className: "text-accent/80" };
  if (kind === "link") return { Icon: Link2, className: "text-faint" };
  const lower = name.toLowerCase();
  const ext = lower.includes(".") ? lower.split(".").pop()! : "";
  if (lower === "fxmanifest.lua" || lower === "__resource.lua" || lower === "package.json" || lower === "cargo.toml") {
    return { Icon: FileCog, className: "text-warning" };
  }
  if (lower.startsWith(".env")) return { Icon: FileLock, className: "text-warning" };
  if (ext === "json" || ext === "jsonc") return { Icon: FileJson, className: "text-warning" };
  if (CODE.has(ext)) return { Icon: FileCode, className: "text-accent" };
  if (MARKUP.has(ext)) return { Icon: Braces, className: "text-accent-strong" };
  if (CONFIG.has(ext)) return { Icon: FileCog, className: "text-muted" };
  if (IMAGE.has(ext)) return { Icon: FileImage, className: "text-success" };
  if (SCRIPT.has(ext)) return { Icon: FileTerminal, className: "text-success" };
  if (LOCK.has(ext) || lower.endsWith("-lock.json") || lower.endsWith("-lock.yaml")) {
    return { Icon: FileLock, className: "text-faint" };
  }
  if (ext === "md" || ext === "txt") return { Icon: FileText, className: "text-muted" };
  return { Icon: File, className: "text-muted" };
}
