// Unit tests: permission classification, config validation and
// import/export, the Tauri transports, and external tool selection.

import type { McpServerConfig } from "@/lib/ipc/types";
import { selectTools, scoreExternalTool } from "@/agent/runtime/planner";
import type { ToolDefinition } from "@/agent/types";
import { createFakeMcpService } from "@/test/integrationFakes";
import { inferPermission, isDestructive } from "./classify";
import { emptyServer, exportServers, parseImport, validateServerInput, validateServerUrl } from "./config";
import { modelToolName, normalizeResult, prepareTools, sanitizeText } from "./toolAdapter";
import { createTauriFetch, TauriStdioTransport } from "./transports";

describe("permission classification", () => {
  it("infers categories from tool names, most sensitive verb first", () => {
    expect(inferPermission("search_repositories")).toBe("READ");
    expect(inferPermission("get_file_contents")).toBe("READ");
    expect(inferPermission("listIssues")).toBe("READ");
    expect(inferPermission("create_issue")).toBe("WRITE");
    expect(inferPermission("send_message")).toBe("EXTERNAL_ACTION");
    expect(inferPermission("delete_repository")).toBe("DELETE");
    expect(inferPermission("list_and_delete")).toBe("DELETE");
    expect(inferPermission("execute_query")).toBe("EXECUTE");
    expect(inferPermission("fetch_url")).toBe("NETWORK");
    expect(inferPermission("frobnicate")).toBe("EXTERNAL_ACTION");
  });

  it("lets server hints raise but never lower the category", () => {
    expect(inferPermission("get_status", { destructiveHint: true })).toBe("DELETE");
    expect(inferPermission("delete_repo", { destructiveHint: false })).toBe("DELETE");
    expect(isDestructive(inferPermission("purge_cache"))).toBe(true);
  });
});

describe("server configuration", () => {
  const stdio = { ...emptyServer(), id: "files", name: "Files", command: "npx", args: ["-y", "pkg"] };

  it("validates ids, commands, and URLs", () => {
    expect(validateServerInput(stdio)).toEqual({});
    expect(validateServerInput({ ...stdio, id: "Files" }).id).toBeDefined();
    expect(validateServerInput({ ...stdio, id: "a__b" }).id).toBeDefined();
    expect(validateServerInput({ ...stdio, command: "npx & del *" }).command).toMatch(/only the program/);
    expect(validateServerInput({ ...stdio, env: { "BAD NAME": "x" } }).env).toBeDefined();
    const http = { ...stdio, transport: "http" as const, command: null, url: "http://example.com/mcp" };
    expect(validateServerInput(http).url).toMatch(/https/);
    expect(validateServerUrl("http://localhost:3001/mcp")).toBeNull();
    expect(validateServerUrl("https://user:pw@example.com/mcp")).toMatch(/credentials/);
    expect(validateServerInput({ ...http, url: "https://example.com/mcp", headers: { Host: "x" } }).headers).toBeDefined();
  });

  it("exports without secret values and imports disabled, valid servers only", () => {
    const config: McpServerConfig = { ...stdio, secretKeys: ["env:GITHUB_TOKEN"], lastConnectedAt: 5, createdAt: 1, updatedAt: 2 };
    const file = exportServers([config]);
    const text = JSON.stringify(file);
    expect(text).toContain("env:GITHUB_TOKEN");
    expect(text).not.toContain("lastConnectedAt");
    const bad = { ...file, servers: [...file.servers, { server: { ...stdio, id: "Bad Id" }, requiredSecrets: [] }] };
    const result = parseImport(JSON.stringify(bad));
    expect(result.servers).toHaveLength(1);
    expect(result.servers[0]!.server).toMatchObject({ id: "files", enabled: false, autoConnect: false });
    expect(result.servers[0]!.requiredSecrets).toEqual(["env:GITHUB_TOKEN"]);
    expect(result.errors[0]).toMatch(/Server 2/);
    expect(parseImport("not json").errors).toEqual(["The file is not valid JSON."]);
    expect(parseImport('{"format":"other"}').errors[0]).toMatch(/not a Vinnie MCP server export/);
  });
});

describe("tool adapter helpers", () => {
  it("accepts schemas from any common JSON Schema draft", () => {
    const { tools, rejected } = prepareTools("fs", "Files", [
      {
        name: "read_file",
        inputSchema: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
      },
      { name: "old_style", inputSchema: { $schema: "http://json-schema.org/draft-07/schema#", type: "object", properties: { n: { type: "number" } } } },
      { name: "no_draft", inputSchema: { type: "object", properties: { items: { type: "array", prefixItems: [{ type: "string" }] } } } },
    ]);
    expect(rejected).toEqual([]);
    expect(tools.map((t) => t.name)).toEqual(["read_file", "old_style", "no_draft"]);
    expect(tools[0]!.modelSchema).not.toHaveProperty("$schema");
  });

  it("builds unique, model-safe names", () => {
    const taken = new Set<string>();
    expect(modelToolName("github", "list-issues", taken)).toBe("github__list_issues");
    expect(modelToolName("github", "list_issues", taken)).toBe("github__list_issues_2");
    expect(modelToolName("github", "getFileContents", taken)).toBe("github__get_file_contents");
    expect(modelToolName("x", "a".repeat(100), taken).length).toBeLessThanOrEqual(60);
  });

  it("strips invisible characters and bounds text", () => {
    expect(sanitizeText("a​b‮c\u0000d   e", 100)).toBe("abcd e");
    expect(sanitizeText("x".repeat(50), 10)).toBe(`${"x".repeat(10)}…`);
  });

  it("normalizes result content", () => {
    expect(normalizeResult({ content: [{ type: "text", text: "hi" }, { type: "resource", resource: { uri: "file:///a", text: "doc" } }] }).text).toBe("hi\ndoc");
    expect(normalizeResult({ content: [], structuredContent: { ok: true } }).text).toContain('"ok": true');
    expect(normalizeResult({}).text).toBe("(no content)");
  });
});

describe("stdio transport", () => {
  it("relays JSON-RPC lines, reports bad lines, and closes on exit", async () => {
    const fake = createFakeMcpService();
    const stderr: string[] = [];
    let exitCode: number | null | undefined;
    const t = new TauriStdioTransport("files", fake.service, { onStderr: (l) => stderr.push(l), onExit: (c) => (exitCode = c) });
    const messages: unknown[] = [];
    const errors: string[] = [];
    let closed = 0;
    t.onmessage = (m) => messages.push(m);
    t.onerror = (e) => errors.push(e.message);
    t.onclose = () => closed++;
    await t.start();
    await t.send({ jsonrpc: "2.0", id: 1, method: "ping" });
    expect(fake.sent).toEqual([{ serverId: "files", line: '{"jsonrpc":"2.0","id":1,"method":"ping"}' }]);
    fake.emitStdio("files", { type: "message", line: '{"jsonrpc":"2.0","id":1,"result":{}}' });
    fake.emitStdio("files", { type: "message", line: "npm WARN something" });
    fake.emitStdio("files", { type: "stderr", line: "starting" });
    fake.emitStdio("files", { type: "dropped", reason: "too large" });
    expect(messages).toEqual([{ jsonrpc: "2.0", id: 1, result: {} }]);
    expect(errors).toEqual(["The server wrote a line that is not a JSON-RPC message.", "too large"]);
    expect(stderr).toEqual(["starting"]);
    fake.emitStdio("files", { type: "exit", code: 1 });
    expect(exitCode).toBe(1);
    expect(closed).toBe(1);
    await expect(t.send({ jsonrpc: "2.0", id: 2, method: "ping" })).rejects.toThrow(/not running/);
    await t.close();
    expect(closed).toBe(1);
  });
});

describe("HTTP fetch bridge", () => {
  it("streams the body from the backend and never sends credentials itself", async () => {
    const fake = createFakeMcpService();
    let seen: { url: string; method: string; headers: Record<string, string>; body: string | null } | null = null;
    fake.setHttp(async (_id, req, onBody) => {
      seen = req;
      setTimeout(() => {
        onBody({ type: "chunk", data: "event: message\n" });
        onBody({ type: "chunk", data: 'data: {"ok":true}\n\n' });
        onBody({ type: "end" });
      }, 5);
      return { status: 200, statusText: "OK", headers: { "content-type": "text/event-stream", "mcp-session-id": "s1" } };
    });
    const fetch = createTauriFetch("gh", fake.service);
    const res = await fetch("https://mcp.example.com/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: '{"jsonrpc":"2.0"}',
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("mcp-session-id")).toBe("s1");
    expect(await res.text()).toBe('event: message\ndata: {"ok":true}\n\n');
    expect(seen).toMatchObject({ url: "https://mcp.example.com/mcp", method: "POST", body: '{"jsonrpc":"2.0"}' });
    expect(Object.keys(seen!.headers)).not.toContain("authorization");
  });

  it("aborts through the backend", async () => {
    const fake = createFakeMcpService();
    fake.setHttp(async () => ({ status: 200, statusText: "OK", headers: {} }));
    const controller = new AbortController();
    const res = await createTauriFetch("gh", fake.service)("https://mcp.example.com/mcp", { signal: controller.signal });
    const reading = res.text();
    controller.abort();
    await expect(reading).rejects.toThrow(/aborted/);
    expect(fake.aborted).toHaveLength(1);
  });

  it("returns bodiless responses for 202/204", async () => {
    const fake = createFakeMcpService();
    fake.setHttp(async () => ({ status: 204, statusText: "No Content", headers: {} }));
    const res = await createTauriFetch("gh", fake.service)("https://mcp.example.com/mcp", { method: "DELETE" });
    expect(res.status).toBe(204);
  });
});

describe("external tool selection", () => {
  const ext = (server: string, tool: string, permission: ToolDefinition["permission"], description = "", over: Partial<ToolDefinition> = {}): ToolDefinition => ({
    name: `${server}__${tool}`,
    description: `[External tool from the "${server}" MCP server; x] ${description}`,
    inputSchema: {},
    category: "EXTERNAL",
    riskLevel: "moderate",
    source: "mcp",
    settingsKey: `mcp:${server}:${tool}`,
    displayName: `${server}.${tool}`,
    serverId: server,
    permission,
    enabled: true,
    available: true,
    ...over,
  });
  const native: ToolDefinition = { name: "read_file", description: "", inputSchema: {}, category: "READ", riskLevel: "safe", source: "native", settingsKey: "read_file", displayName: "read_file", enabled: true, available: true };
  const defs = [
    native,
    ext("github", "list_issues", "READ", "List issues in a repository."),
    ext("github", "create_issue", "WRITE", "Create an issue."),
    ext("github", "search_repositories", "READ", "Search repositories."),
    ext("discord", "send_message", "EXTERNAL_ACTION", "Send a message to a channel."),
    ext("db", "query", "READ", "Run a read-only SQL query.", { available: false }),
    ext("github", "get_me", "READ", "", { enabled: false }),
  ];

  it("offers only relevant, enabled, connected external tools", () => {
    const tools = selectTools(defs, "agent", "question", { request: "Find the issues in my GitHub repository and summarize the open bugs." });
    expect(tools).toContain("read_file");
    expect(tools).toContain("github__list_issues");
    expect(tools).toContain("github__search_repositories");
    expect(tools).not.toContain("github__create_issue"); // a question gets read-only external tools
    expect(tools).not.toContain("discord__send_message");
    expect(tools).not.toContain("github__get_me"); // disabled
  });

  it("never offers unavailable tools and offers nothing external for unrelated requests", () => {
    expect(selectTools(defs, "agent", "task", { request: "query the db for users" })).not.toContain("db__query");
    expect(selectTools(defs, "agent", "task", { request: "Refactor server.js" }).filter((n) => n.includes("__"))).toEqual([]);
  });

  it("caps the number of external tools and uses skill hints", () => {
    const many = Array.from({ length: 30 }, (_, i) => ext("github", `list_thing_${i}`, "READ", "List things."));
    expect(selectTools([native, ...many], "agent", "task", { request: "list github things" }).filter((n) => n.startsWith("github__"))).toHaveLength(8);
    const create = defs[2]!;
    expect(scoreExternalTool(create, "open a ticket", ["github.*"])).toBeGreaterThanOrEqual(4);
  });

  it("offers write tools for tasks but only read tools in Ask mode", () => {
    expect(selectTools(defs, "agent", "task", { request: "Create a GitHub issue for the bug" })).toContain("github__create_issue");
    expect(selectTools(defs, "ask", "task", { request: "Create a GitHub issue for the bug" })).not.toContain("github__create_issue");
  });
});
