// Project context for the model. Instead of sending the whole project, each
// request gets a compact summary (detected metadata, a shallow tree, the
// file open in the editor, and filenames related to the message); the model
// fetches anything else with tools.

import type { ProjectMetadata } from "@/lib/ipc/types";

export const MAX_ACTIVE_FILE_CHARS = 8_000;
const MAX_TREE_CHARS = 3_000;

export interface ProjectContextInput {
  projectName: string;
  root: string;
  metadata: ProjectMetadata | null;
  tree: string | null;
  activeFile: { path: string; content: string } | null;
  relevantFiles: string[];
}

const STOPWORDS = new Set([
  "what", "which", "where", "when", "with", "that", "this", "file", "files", "code", "does", "from",
  "have", "there", "about", "into", "your", "make", "should", "would", "could", "please", "show",
  "handle", "handles", "find", "project", "using", "used", "like", "them", "they", "then", "than",
  "explain", "write", "create", "update", "change", "help", "need", "want", "work", "works",
]);

/** Words in a message that are worth looking up as filenames. */
export function extractKeywords(message: string, max = 5): string[] {
  const words = message.match(/[A-Za-z_][A-Za-z0-9_.-]{2,}/g) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of words) {
    const word = raw.replace(/[.-]+$/, "");
    const key = word.toLowerCase();
    if (word.length < 4 || STOPWORDS.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(word);
  }
  // Prefer identifier-like and longer words.
  return out
    .sort((a, b) => Number(/[A-Z_]/.test(b.slice(1))) - Number(/[A-Z_]/.test(a.slice(1))) || b.length - a.length)
    .slice(0, max);
}

/** Regex (escaped alternation) for a filename search over keywords. */
export function keywordPattern(keywords: string[]): string | null {
  if (keywords.length === 0) return null;
  return keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
}

function list(items: string[], max = 12): string {
  if (items.length === 0) return "none detected";
  return items.length > max ? `${items.slice(0, max).join(", ")}, … (${items.length - max} more)` : items.join(", ");
}

export function buildSystemPrompt(input: ProjectContextInput | null, toolsAvailable: boolean): string {
  const parts: string[] = [
    "You are Vinnie, a local AI developer assistant running on the user's Windows computer.",
    "Be accurate and concise. Use Markdown, with fenced code blocks for code.",
  ];
  if (toolsAvailable) {
    parts.push(
      [
        "You have tools for the user's project: get_project_structure, search_files, read_file, create_file, write_file, delete_file, move_file, run_command, install_dependency.",
        "- Look things up with tools instead of guessing. Search first, then read the relevant files.",
        "- Paths are relative to the project root and use forward slashes.",
        "- To change a file, read it first, then call write_file with the complete new content.",
        "- File changes, deletions, and most commands need the user's approval. If the user rejects or a tool fails, explain that; do not retry the same action unless asked.",
        "- Never claim you changed a file, ran a command, or installed a package unless a tool result confirms it succeeded.",
      ].join("\n"),
    );
  }
  if (!input) {
    parts.push("No project folder is selected, so you cannot see the user's files.");
    return parts.join("\n\n");
  }

  const m = input.metadata;
  const summary: string[] = [
    "Project context (detected automatically from the files; it may be incomplete):",
    `Project: ${input.projectName}`,
    `Root: ${input.root}`,
  ];
  if (m) {
    summary.push(`Type: ${m.projectTypes.length ? m.projectTypes.join(", ") : "unknown"}`);
    summary.push(`Languages: ${list(m.languages.map((l) => `${l.name} (${l.files})`), 6)}`);
    if (m.frameworks.length) summary.push(`Frameworks: ${list(m.frameworks)}`);
    if (m.packageManagers.length) {
      summary.push(
        `Package managers: ${m.packageManagers
          .map((p) => (p.ambiguous ? `${p.ecosystem}: unclear (${p.candidates.join("/")})` : `${p.manager} (${p.evidence.join(", ")})`))
          .join("; ")}`,
      );
    }
    const important = [...new Set([...m.entryPoints, ...m.configFiles])];
    if (important.length) summary.push(`Important files: ${list(important, 15)}`);
    if (m.instructionFiles.length) {
      summary.push(`Project instruction files (read them before larger changes): ${m.instructionFiles.join(", ")}`);
    }
    if (m.fivem) {
      const f = m.fivem;
      summary.push(
        `FiveM manifest ${f.manifestFile}: client_scripts=[${f.clientScripts.join(", ")}], server_scripts=[${f.serverScripts.join(", ")}], shared_scripts=[${f.sharedScripts.join(", ")}]${f.uiPage ? `, ui_page=${f.uiPage}` : ""}`,
      );
    }
    if (m.git.isRepo) {
      summary.push(
        `Git: branch ${m.git.branch ?? "(detached)"}, ${m.git.modified.length} modified, ${m.git.untracked.length} untracked`,
      );
    }
  }
  parts.push(summary.join("\n"));

  if (input.tree) {
    const tree = input.tree.length > MAX_TREE_CHARS ? `${input.tree.slice(0, MAX_TREE_CHARS)}\n…` : input.tree;
    parts.push(`Top-level structure:\n${tree}`);
  }
  if (input.relevantFiles.length) {
    parts.push(`Files whose names match words in the user's message: ${input.relevantFiles.join(", ")}`);
  }
  if (input.activeFile) {
    const { path, content } = input.activeFile;
    const clipped =
      content.length > MAX_ACTIVE_FILE_CHARS
        ? `${content.slice(0, MAX_ACTIVE_FILE_CHARS)}\n… (truncated; use read_file for the rest)`
        : content;
    parts.push(`The user currently has ${path} open in the editor:\n\`\`\`\n${clipped}\n\`\`\``);
  }
  return parts.join("\n\n");
}
