// Permission categories for external (MCP) tools. Everything a server says
// about a tool (name, description, annotations) is untrusted: the category is
// inferred from the tool's name, and server hints may only make a tool *more*
// sensitive, never less. Unknown tools are treated as external actions.

export type ToolPermission = "READ" | "WRITE" | "DELETE" | "EXECUTE" | "NETWORK" | "EXTERNAL_ACTION";

const DELETE = new Set(["delete", "remove", "drop", "destroy", "purge", "erase", "wipe", "truncate", "ban", "kick", "prune", "revoke", "uninstall", "rm", "unlink"]);
const EXECUTE = new Set(["exec", "execute", "run", "shell", "command", "eval", "evaluate", "spawn", "invoke", "terminal", "script", "luau"]);
const EXTERNAL = new Set(["send", "post", "publish", "notify", "message", "email", "mail", "invite", "dm", "reply", "comment", "react", "tweet", "broadcast"]);
const WRITE = new Set(["write", "create", "update", "edit", "modify", "set", "put", "patch", "add", "insert", "upload", "move", "rename", "commit", "push", "merge", "append", "save", "replace", "assign", "pin", "unpin", "lock", "unlock", "archive", "close", "reopen", "approve", "fork", "star", "transfer", "import", "generate", "store", "mkdir", "copy"]);
const NETWORK = new Set(["fetch", "http", "request", "download", "browse", "navigate", "url", "scrape", "crawl", "web", "webpage", "screenshot"]);
const READ = new Set(["get", "list", "search", "read", "find", "query", "describe", "show", "view", "inspect", "count", "lookup", "status", "info", "check", "grep", "tree", "stat", "diff", "log", "logs", "history", "version", "explain", "summarize", "analyze", "resolve", "preview", "watch", "directory", "allowed"]);

/** Split a tool name into lowercase words: `createIssue`, `create_issue`, `create-issue`. */
export function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const RANK: Record<ToolPermission, number> = { READ: 0, NETWORK: 1, WRITE: 2, EXECUTE: 3, EXTERNAL_ACTION: 3, DELETE: 4 };

export function moreSensitive(a: ToolPermission, b: ToolPermission): ToolPermission {
  return RANK[b] > RANK[a] ? b : a;
}

/**
 * Infer the permission category from a tool's name. The most sensitive verb
 * wins (`list_and_delete` is DELETE); a name with no known verb is an
 * EXTERNAL_ACTION. `destructiveHint` can only raise the category.
 */
export function inferPermission(name: string, annotations?: { destructiveHint?: unknown } | null): ToolPermission {
  const words = nameWords(name);
  let found: ToolPermission | null = null;
  const bump = (p: ToolPermission) => (found = found ? moreSensitive(found, p) : p);
  for (const w of words) {
    if (DELETE.has(w)) bump("DELETE");
    else if (EXECUTE.has(w)) bump("EXECUTE");
    else if (EXTERNAL.has(w)) bump("EXTERNAL_ACTION");
    else if (WRITE.has(w)) bump("WRITE");
    else if (NETWORK.has(w)) bump("NETWORK");
    else if (READ.has(w)) bump("READ");
  }
  let permission: ToolPermission = found ?? "EXTERNAL_ACTION";
  if (annotations?.destructiveHint === true) permission = moreSensitive(permission, "DELETE");
  return permission;
}

/** Destructive tools always ask and require explicit confirmation. */
export function isDestructive(permission: ToolPermission): boolean {
  return permission === "DELETE";
}

/** Read-only categories (allowed in Ask mode and for questions). */
export function isReadOnly(permission: ToolPermission): boolean {
  return permission === "READ" || permission === "NETWORK";
}

export const PERMISSION_LABEL: Record<ToolPermission, string> = {
  READ: "Read",
  WRITE: "Write",
  DELETE: "Delete",
  EXECUTE: "Execute",
  NETWORK: "Network",
  EXTERNAL_ACTION: "External action",
};
