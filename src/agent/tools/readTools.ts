// Read-only tools: project structure, search, and file reading.

import { z } from "zod";
import { toVinnieError } from "@/lib/errors";
import type { FileContent } from "@/lib/ipc/types";
import { toolFailure, toolSuccess, type ToolContext, type ToolResult, type VinnieTool } from "../types";

const assistant = (approved = false) => ({ actor: "assistant" as const, approved });

const MAX_READ_LINES = 400;

// ---- get_project_structure -------------------------------------------------

const structureSchema = z.object({
  path: z.string().max(1024).optional(),
  depth: z.number().int().min(1).max(6).optional(),
});

export const getProjectStructure: VinnieTool<z.infer<typeof structureSchema>> = {
  name: "get_project_structure",
  description:
    "List the folders and files of the project as an indented tree. Ignored folders such as node_modules are shown but not expanded. Use `path` to look inside a subfolder.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Folder relative to the project root. Omit for the root." },
      depth: { type: "integer", description: "How many levels to expand (1-6, default 3)." },
    },
  },
  schema: structureSchema,
  category: "READ",
  riskLevel: "safe",
  activityKind: "read",
  describe: (i) => `Reading project structure${i.path ? ` of ${i.path}` : ""}`,
  async execute(input, ctx) {
    const tree = await ctx.services.workspace.tree({
      path: input.path,
      maxDepth: input.depth ?? 3,
      maxEntries: 400,
      access: assistant(),
    });
    const header = input.path ? `${input.path}/` : "(project root)";
    return toolSuccess(`${header}\n${tree.text}${tree.truncated ? "… (listing truncated)\n" : ""}`, {
      output: tree,
    });
  },
};

// ---- search_files ----------------------------------------------------------

const searchSchema = z.object({
  query: z.string().min(1).max(500),
  mode: z.enum(["text", "filename"]).optional(),
  caseSensitive: z.boolean().optional(),
  regex: z.boolean().optional(),
  include: z.array(z.string().max(100)).max(20).optional(),
  maxResults: z.number().int().min(1).max(200).optional(),
});

export const searchFiles: VinnieTool<z.infer<typeof searchSchema>> = {
  name: "search_files",
  description:
    "Search the project. mode 'text' (default) finds lines containing the query; mode 'filename' matches file paths. Respects .gitignore and ignored folders. Returns `path:line: text` results.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Text (or regular expression if regex=true) to find." },
      mode: { type: "string", enum: ["text", "filename"] },
      caseSensitive: { type: "boolean" },
      regex: { type: "boolean" },
      include: { type: "array", items: { type: "string" }, description: "File filters such as ['lua'] or ['*.ts']." },
      maxResults: { type: "integer", description: "Default 50." },
    },
    required: ["query"],
  },
  schema: searchSchema,
  category: "SEARCH",
  riskLevel: "safe",
  activityKind: "search",
  describe: (i) => `Searching project for "${i.query}"`,
  async execute(input, ctx) {
    const results = await ctx.services.search.search(
      crypto.randomUUID(),
      { ...input, maxResults: input.maxResults ?? 50 },
      assistant(),
    );
    if (results.matches.length === 0) {
      return toolSuccess(`No matches for "${input.query}" (${results.filesSearched} files searched).`, { output: results });
    }
    const lines = results.matches.map((m) => (m.line > 0 ? `${m.path}:${m.line}: ${m.preview}` : m.path));
    const notes = [
      results.truncated ? "More results exist; refine the query to see them." : null,
      results.timedOut ? "The search stopped early because it took too long." : null,
    ].filter(Boolean);
    return toolSuccess(
      `${results.matches.length} result(s) in ${results.filesSearched} files:\n${lines.join("\n")}${
        notes.length ? `\n${notes.join(" ")}` : ""
      }`,
      { output: results },
    );
  },
};

// ---- read_file -------------------------------------------------------------

const readSchema = z.object({
  path: z.string().min(1).max(1024),
  startLine: z.number().int().min(1).optional(),
  endLine: z.number().int().min(1).optional(),
});

/** Read a file as the assistant, asking the user first for likely-secret files. */
export async function readWithApproval(path: string, ctx: ToolContext, reason: string | null): Promise<FileContent | ToolResult> {
  try {
    return await ctx.services.workspace.readFile(path, assistant());
  } catch (err) {
    const e = toVinnieError(err);
    if (e.kind !== "approval_required") throw e;
    const auth = await ctx.authorize({ kind: "read", path, reason, workspace: ctx.workspaceRoot }, "read");
    if (!auth.approved) {
      return toolFailure("PERMISSION_DENIED", `The user did not allow reading ${path}.`, { outcome: "denied" });
    }
    return ctx.services.workspace.readFile(path, assistant(true));
  }
}

export const readFile: VinnieTool<z.infer<typeof readSchema>> = {
  name: "read_file",
  description: `Read a text file from the project, with line numbers. Returns at most ${MAX_READ_LINES} lines per call; use startLine/endLine to read other parts of long files.`,
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path relative to the project root." },
      startLine: { type: "integer", description: "First line to return (1-based)." },
      endLine: { type: "integer", description: "Last line to return (inclusive)." },
    },
    required: ["path"],
  },
  schema: readSchema,
  category: "READ",
  riskLevel: "safe",
  activityKind: "read",
  describe: (i) => `Reading ${i.path}`,
  async execute(input, ctx) {
    const file = await readWithApproval(input.path, ctx, null);
    if ("outcome" in file) return file;
    if (file.binary) return toolFailure("INVALID_ARGUMENT", `${input.path} is a binary file and cannot be read as text.`);
    if (file.tooLarge || file.content == null) {
      return toolFailure("INVALID_ARGUMENT", `${input.path} is too large to read (over 2 MB).`);
    }
    const lines = file.content.split(/\r?\n/);
    const start = Math.min(input.startLine ?? 1, Math.max(lines.length, 1));
    const end = Math.min(input.endLine ?? start + MAX_READ_LINES - 1, start + MAX_READ_LINES - 1, lines.length);
    const width = String(end).length;
    const body = lines
      .slice(start - 1, end)
      .map((line, i) => `${String(start + i).padStart(width)}| ${line}`)
      .join("\n");
    const more = end < lines.length ? `\n… ${lines.length - end} more lines (read with startLine=${end + 1}).` : "";
    return toolSuccess(`${input.path} (lines ${start}-${end} of ${lines.length})\n${body}${more}`, {
      output: { path: input.path, totalLines: lines.length, startLine: start, endLine: end },
    });
  },
};
