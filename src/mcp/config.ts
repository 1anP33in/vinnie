// Validation for MCP server configurations (the editor and imported files).
// The backend validates again before storing or launching anything.

import { z } from "zod";
import type { McpServerConfig, McpServerInput } from "@/lib/ipc/types";

export const SERVER_ID = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;
/** Headers the transport manages itself; a config must not set them. */
const RESERVED_HEADERS = new Set(["host", "content-length", "content-type", "accept", "mcp-session-id", "mcp-protocol-version", "connection", "transfer-encoding"]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isLocalHost(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname.toLowerCase());
}

/** Remote MCP servers must use HTTPS; plain HTTP is allowed only on this computer. */
export function validateServerUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "Enter a full URL, e.g. https://example.com/mcp.";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "Only http and https URLs are supported.";
  if (url.protocol === "http:" && !isLocalHost(url.hostname)) return "Remote servers must use https://. Plain http is allowed only for localhost.";
  if (url.username || url.password) return "Don't put credentials in the URL. Add them as a secret header instead.";
  return null;
}

const envMap = z
  .record(z.string(), z.string().max(4_000))
  .refine((m) => Object.keys(m).length <= 50, "At most 50 environment variables.")
  .refine((m) => Object.keys(m).every((k) => ENV_NAME.test(k)), "Environment variable names may contain letters, digits, and _.");

const headerMap = z
  .record(z.string(), z.string().max(4_000))
  .refine((m) => Object.keys(m).length <= 30, "At most 30 headers.")
  .refine((m) => Object.keys(m).every((k) => HEADER_NAME.test(k)), "Invalid header name.")
  .refine((m) => Object.keys(m).every((k) => !RESERVED_HEADERS.has(k.toLowerCase())), "That header is managed by Vinnie and can't be set.");

export const serverInputSchema = z
  .object({
    id: z
      .string()
      .min(1, "Give the server an ID.")
      .max(24, "IDs are at most 24 characters.")
      .regex(SERVER_ID, "Use lowercase letters, digits, and single underscores, starting with a letter (e.g. github)."),
    name: z.string().trim().min(1, "Give the server a name.").max(60),
    description: z.string().max(300),
    transport: z.enum(["stdio", "http"]),
    command: z.string().trim().max(260).nullable(),
    args: z.array(z.string().max(1_000)).max(64, "At most 64 arguments."),
    env: envMap,
    cwd: z.string().max(260).nullable(),
    url: z.string().trim().max(2_000).nullable(),
    headers: headerMap,
    enabled: z.boolean(),
    autoConnect: z.boolean(),
    toolTimeoutSecs: z.number().int().min(5, "Timeouts are at least 5 seconds.").max(600, "Timeouts are at most 600 seconds."),
    defaultPolicy: z.enum(["ask", "allow", "deny"]),
  })
  .superRefine((s, ctx) => {
    if (s.transport === "stdio") {
      if (!s.command) ctx.addIssue({ code: "custom", path: ["command"], message: "Enter the program to run, e.g. npx." });
      else if (/[|&;<>^%`$\r\n]/.test(s.command)) {
        ctx.addIssue({ code: "custom", path: ["command"], message: "Enter only the program name or path; put arguments in Arguments." });
      }
    } else {
      const error = s.url ? validateServerUrl(s.url) : "Enter the server URL.";
      if (error) ctx.addIssue({ code: "custom", path: ["url"], message: error });
    }
  });

export type ServerErrors = Partial<Record<keyof McpServerInput | "secrets", string>>;

export function validateServerInput(input: McpServerInput): ServerErrors {
  const result = serverInputSchema.safeParse(input);
  if (result.success) return {};
  const errors: ServerErrors = {};
  for (const issue of result.error.issues) {
    const key = (issue.path[0] as keyof McpServerInput | undefined) ?? "name";
    errors[key] ??= issue.message;
  }
  return errors;
}

export function emptyServer(): McpServerInput {
  return {
    id: "",
    name: "",
    description: "",
    transport: "stdio",
    command: "npx",
    args: [],
    env: {},
    cwd: null,
    url: null,
    headers: {},
    enabled: true,
    autoConnect: true,
    toolTimeoutSecs: 60,
    defaultPolicy: "ask",
  };
}

export function toInput(config: McpServerConfig): McpServerInput {
  const { secretKeys: _s, lastConnectedAt: _l, createdAt: _c, updatedAt: _u, ...input } = config;
  return input;
}

// ---- import / export (never contains secret values) -------------------------

export const EXPORT_FORMAT = "vinnie-mcp-servers";

const exportFileSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(1),
  servers: z
    .array(
      z.object({
        server: z.unknown(),
        /** Names of secrets the user has to fill in after importing. */
        requiredSecrets: z.array(z.string().max(80)).max(80).default([]),
      }),
    )
    .max(100),
});

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  version: 1;
  servers: { server: McpServerInput; requiredSecrets: string[] }[];
}

export function exportServers(configs: McpServerConfig[]): ExportFile {
  return {
    format: EXPORT_FORMAT,
    version: 1,
    servers: configs.map((c) => ({ server: toInput(c), requiredSecrets: c.secretKeys })),
  };
}

export interface ImportResult {
  servers: { server: McpServerInput; requiredSecrets: string[] }[];
  errors: string[];
}

/**
 * Parse an exported file. Each server is validated on its own; invalid ones
 * are reported and skipped. Imported servers start disabled so nothing runs
 * until the user reviews them.
 */
export function parseImport(text: string): ImportResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { servers: [], errors: ["The file is not valid JSON."] };
  }
  const file = exportFileSchema.safeParse(json);
  if (!file.success) return { servers: [], errors: ["This is not a Vinnie MCP server export (format vinnie-mcp-servers, version 1)."] };
  const out: ImportResult = { servers: [], errors: [] };
  for (const [i, entry] of file.data.servers.entries()) {
    const raw = { ...emptyServer(), ...(entry.server as object) } as McpServerInput;
    const candidate: McpServerInput = { ...raw, enabled: false, autoConnect: false };
    const errors = validateServerInput(candidate);
    const first = Object.values(errors)[0];
    if (first) {
      out.errors.push(`Server ${i + 1} (${String(raw.name || raw.id || "unnamed")}): ${first}`);
      continue;
    }
    const secrets = entry.requiredSecrets.filter((k) => /^(env|header):[A-Za-z0-9_.-]{1,64}$/.test(k));
    out.servers.push({ server: serverInputSchema.parse(candidate) as McpServerInput, requiredSecrets: secrets });
  }
  return out;
}
