// MCP manager: server registry, connections, tool discovery, health
// monitoring, and reconnection. It uses the official SDK `Client` over the
// transports in transports.ts and registers each discovered tool in Vinnie's
// ToolRegistry through the adapter, so the agent runtime needs no MCP code.
//
// A failing server never throws out of the manager: errors become status,
// log entries, and events.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ToolRegistry } from "@/agent/types";
import { toVinnieError } from "@/lib/errors";
import type { McpLogEntry, McpServerConfig, McpServerInput, SecretChanges, ToolPolicy } from "@/lib/ipc/types";
import type { McpService } from "@/services";
import { emitIntegrationEvent } from "./events";
import { createMcpTool, prepareTools, sanitizeText, type McpToolInfo, type RawMcpTool, type RejectedTool } from "./toolAdapter";
import { createTauriFetch, TauriStdioTransport } from "./transports";

export type McpStatus = "connected" | "connecting" | "disconnected" | "error" | "disabled";

export interface McpServerState {
  config: McpServerConfig;
  status: McpStatus;
  error: string | null;
  tools: McpToolInfo[];
  rejected: RejectedTool[];
  serverInfo: { name: string; version: string } | null;
  lastSuccessAt: number | null;
  failures: number;
  reconnectAttempts: number;
  /** Lifecycle log kept in the UI (the backend keeps the process output). */
  log: McpLogEntry[];
}

export interface McpManagerDeps {
  mcp: () => McpService;
  registry: () => ToolRegistry;
  /** Effective policy for one of this server's tools (per-tool setting or server default). */
  policyFor: (config: McpServerConfig, toolName: string) => ToolPolicy;
  /** Build a transport; tests replace this with an in-memory transport. */
  createTransport?: (config: McpServerConfig, hooks: TransportHooks) => Transport;
  /** Health check interval (ms); 0 disables the timer (tests). */
  pingIntervalMs?: number;
  /** Delays between automatic reconnection attempts (ms). */
  reconnectDelaysMs?: number[];
  now?: () => number;
}

export interface TransportHooks {
  onStderr(line: string): void;
  onExit(code: number | null): void;
}

const CONNECT_TIMEOUT_MS = 30_000;
const PING_TIMEOUT_MS = 10_000;
const MAX_LOG = 200;
const MAX_TOOL_PAGES = 10;
const CLIENT_INFO = { name: "vinnie", version: "0.1.0" };

interface Runtime {
  state: McpServerState;
  client: Client | null;
  transport: Transport | null;
  /** Set when we close the connection ourselves, so onclose isn't treated as a failure. */
  closing: boolean;
  generation: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  registered: string[];
}

export class McpManager {
  private readonly servers = new Map<string, Runtime>();
  private readonly listeners = new Set<() => void>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private snapshotCache: McpServerState[] = [];
  private readonly now: () => number;

  constructor(private readonly deps: McpManagerDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  // ---- observation ---------------------------------------------------------

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Stable snapshot for React (replaced on every change). */
  snapshot(): McpServerState[] {
    return this.snapshotCache;
  }

  get(id: string): McpServerState | undefined {
    return this.servers.get(id)?.state;
  }

  private changed(): void {
    this.snapshotCache = [...this.servers.values()]
      .map((r) => ({ ...r.state }))
      .sort((a, b) => a.config.name.localeCompare(b.config.name));
    for (const l of this.listeners) {
      try {
        l();
      } catch {
        /* never break the manager */
      }
    }
  }

  private log(rt: Runtime, level: McpLogEntry["level"], message: string): void {
    rt.state.log = [...rt.state.log.slice(-(MAX_LOG - 1)), { at: this.now(), level, message: sanitizeText(message, 2_000) }];
  }

  private set(rt: Runtime, patch: Partial<McpServerState>): void {
    rt.state = { ...rt.state, ...patch };
    this.changed();
  }

  // ---- configuration -------------------------------------------------------

  /** Load saved servers and connect the enabled ones that auto-connect. */
  async load(): Promise<void> {
    const configs = await this.deps.mcp().list();
    for (const config of configs) {
      if (!this.servers.has(config.id)) this.servers.set(config.id, this.newRuntime(config));
    }
    this.changed();
    this.startHealthMonitor();
    await Promise.all(configs.filter((c) => c.enabled && c.autoConnect).map((c) => this.connect(c.id)));
  }

  private newRuntime(config: McpServerConfig): Runtime {
    return {
      state: {
        config,
        status: config.enabled ? "disconnected" : "disabled",
        error: null,
        tools: [],
        rejected: [],
        serverInfo: null,
        lastSuccessAt: null,
        failures: 0,
        reconnectAttempts: 0,
        log: [],
      },
      client: null,
      transport: null,
      closing: false,
      generation: 0,
      reconnectTimer: null,
      registered: [],
    };
  }

  /** Add or update a server. A connected server is restarted when its launch settings change. */
  async save(input: McpServerInput, secrets: SecretChanges, isNew: boolean): Promise<McpServerConfig> {
    const config = await this.deps.mcp().save(input, secrets, isNew);
    const existing = this.servers.get(config.id);
    if (!existing) {
      this.servers.set(config.id, this.newRuntime(config));
      this.changed();
      if (config.enabled && config.autoConnect) await this.connect(config.id);
      return config;
    }
    const before = existing.state.config;
    existing.state = { ...existing.state, config };
    const launchChanged =
      before.transport !== config.transport ||
      before.command !== config.command ||
      JSON.stringify(before.args) !== JSON.stringify(config.args) ||
      JSON.stringify(before.env) !== JSON.stringify(config.env) ||
      before.cwd !== config.cwd ||
      before.url !== config.url ||
      JSON.stringify(before.headers) !== JSON.stringify(config.headers) ||
      Object.keys(secrets).length > 0;
    if (!config.enabled) await this.disconnect(config.id, "disabled");
    else if (existing.state.status === "disabled") {
      this.set(existing, { status: "disconnected" });
      if (config.autoConnect) await this.connect(config.id);
    } else if (launchChanged && (existing.state.status === "connected" || existing.state.status === "connecting")) {
      await this.restart(config.id);
    } else {
      this.registerTools(existing);
      this.changed();
    }
    return config;
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const rt = this.servers.get(id);
    if (!rt) return;
    const { secretKeys: _s, lastConnectedAt: _l, createdAt: _c, updatedAt: _u, ...input } = rt.state.config;
    await this.save({ ...input, enabled }, {}, false);
    if (enabled && rt.state.status !== "connected") await this.connect(id);
  }

  async remove(id: string): Promise<void> {
    const rt = this.servers.get(id);
    if (rt) await this.disconnect(id, "disconnected");
    this.unregisterTools(rt);
    await this.deps.mcp().remove(id);
    this.servers.delete(id);
    emitIntegrationEvent({ type: "mcp.server_disconnected", label: `Removed MCP server ${rt?.state.config.name ?? id}`, serverId: id });
    this.changed();
  }

  // ---- connection lifecycle --------------------------------------------------

  private createTransport(rt: Runtime, generation: number): Transport {
    const config = rt.state.config;
    const hooks: TransportHooks = {
      onStderr: (line) => {
        if (rt.generation !== generation) return;
        this.log(rt, "stderr", line);
        this.changed();
      },
      onExit: (code) => {
        if (rt.generation !== generation) return;
        this.log(rt, rt.closing ? "info" : "error", `Server process exited${code === null ? "" : ` with code ${code}`}.`);
      },
    };
    if (this.deps.createTransport) return this.deps.createTransport(config, hooks);
    if (config.transport === "stdio") return new TauriStdioTransport(config.id, this.deps.mcp(), hooks);
    return new StreamableHTTPClientTransport(new URL(config.url ?? ""), {
      fetch: createTauriFetch(config.id, this.deps.mcp()),
      reconnectionOptions: {
        initialReconnectionDelay: 1_000,
        maxReconnectionDelay: 30_000,
        reconnectionDelayGrowFactor: 1.5,
        maxRetries: 2,
      },
    });
  }

  /** Connect (or reconnect) a server and discover its tools. Never throws. */
  async connect(id: string): Promise<boolean> {
    const rt = this.servers.get(id);
    if (!rt) return false;
    if (!rt.state.config.enabled) {
      this.set(rt, { status: "disabled" });
      return false;
    }
    if (rt.state.status === "connecting") return false;
    if (rt.reconnectTimer) clearTimeout(rt.reconnectTimer);
    rt.reconnectTimer = null;
    await this.closeConnection(rt);

    const generation = ++rt.generation;
    const config = rt.state.config;
    rt.closing = false;
    this.log(rt, "info", `Connecting (${config.transport === "stdio" ? config.command : config.url})…`);
    this.set(rt, { status: "connecting", error: null });
    emitIntegrationEvent({ type: "mcp.server_connecting", label: `Connecting to ${config.name}`, serverId: id });

    try {
      const transport = this.createTransport(rt, generation);
      const client = new Client(CLIENT_INFO, {
        capabilities: {},
        listChanged: {
          tools: {
            onChanged: (error, tools) => {
              if (rt.generation !== generation) return;
              if (error) {
                this.log(rt, "warn", `Could not refresh tools: ${error.message}`);
                this.changed();
              } else if (tools) {
                this.log(rt, "info", "Server reported changed tools; refreshing.");
                this.applyTools(rt, tools as RawMcpTool[]);
              }
            },
          },
        },
      });
      client.onerror = (err) => {
        if (rt.generation !== generation) return;
        this.log(rt, "warn", err.message);
        this.changed();
      };
      client.onclose = () => {
        if (rt.generation !== generation) return;
        this.onConnectionClosed(rt);
      };
      rt.client = client;
      rt.transport = transport;
      await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS });
      if (rt.generation !== generation) return false;

      const info = client.getServerVersion();
      // Server `instructions` are deliberately ignored: a server must not be able to
      // change Vinnie's prompt or rules.
      const tools = await this.discover(client);
      if (rt.generation !== generation) return false;
      this.applyTools(rt, tools);
      this.log(rt, "info", `Connected to ${info?.name ?? config.name}${info?.version ? ` ${info.version}` : ""}; ${rt.state.tools.length} tool(s).`);
      this.set(rt, {
        status: "connected",
        error: null,
        serverInfo: info ? { name: sanitizeText(info.name, 80), version: sanitizeText(info.version, 40) } : null,
        lastSuccessAt: this.now(),
        reconnectAttempts: 0,
      });
      void this.deps.mcp().markConnected(id).catch(() => {});
      rt.state.config = { ...rt.state.config, lastConnectedAt: this.now() };
      emitIntegrationEvent({
        type: "mcp.server_connected",
        label: `Connected to ${config.name} (${rt.state.tools.length} tools)`,
        serverId: id,
      });
      return true;
    } catch (err) {
      if (rt.generation !== generation) return false;
      const message = describeConnectError(err);
      this.log(rt, "error", message);
      await this.closeConnection(rt);
      this.set(rt, { status: "error", error: message, failures: rt.state.failures + 1 });
      this.registerTools(rt);
      emitIntegrationEvent({ type: "mcp.server_error", label: `Could not connect to ${config.name}`, serverId: id, detail: message });
      return false;
    }
  }

  private async discover(client: Client): Promise<RawMcpTool[]> {
    if (!client.getServerCapabilities()?.tools) return [];
    const tools: RawMcpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_TOOL_PAGES; page++) {
      const result = await client.listTools(cursor ? { cursor } : undefined, { timeout: CONNECT_TIMEOUT_MS });
      tools.push(...(result.tools as RawMcpTool[]));
      cursor = result.nextCursor;
      if (!cursor) break;
    }
    return tools;
  }

  private applyTools(rt: Runtime, raw: RawMcpTool[]): void {
    const { tools, rejected } = prepareTools(rt.state.config.id, rt.state.config.name, raw);
    const before = new Set(rt.state.tools.map((t) => t.name));
    rt.state = { ...rt.state, tools, rejected };
    for (const t of tools) {
      if (!before.has(t.name)) {
        emitIntegrationEvent({ type: "mcp.tool_discovered", label: `Discovered ${t.displayName}`, serverId: rt.state.config.id, tool: t.name });
      }
    }
    for (const r of rejected) {
      this.log(rt, "warn", `Rejected tool ${r.name}: ${r.reason}`);
      emitIntegrationEvent({ type: "mcp.tool_rejected", label: `Rejected ${rt.state.config.id}.${r.name}`, serverId: rt.state.config.id, tool: r.name, detail: r.reason });
    }
    this.registerTools(rt);
    this.changed();
  }

  /** (Re)register this server's tools with the shared ToolRegistry. */
  private registerTools(rt: Runtime): void {
    const registry = this.deps.registry();
    this.unregisterTools(rt);
    const id = rt.state.config.id;
    for (const info of rt.state.tools) {
      if (registry.get(info.modelName)) continue; // never shadow another tool
      registry.register(
        createMcpTool(info, {
          connected: () => this.servers.get(id)?.state.status === "connected",
          callTool: (name, args, options) => this.callTool(id, name, args, options),
          timeoutMs: () => (this.servers.get(id)?.state.config.toolTimeoutSecs ?? 60) * 1_000,
          policy: () => {
            const config = this.servers.get(id)?.state.config;
            return config ? this.deps.policyFor(config, info.name) : "ask";
          },
          onCall: (event) => {
            const label = `${info.displayName}`;
            if (event.phase === "started") emitIntegrationEvent({ type: "mcp.tool_started", label, serverId: id, tool: info.name });
            else emitIntegrationEvent({
              type: event.phase === "completed" ? "mcp.tool_completed" : "mcp.tool_failed",
              label,
              serverId: id,
              tool: info.name,
              detail: event.error ?? (event.durationMs !== undefined ? `${event.durationMs} ms` : undefined),
            });
          },
        }),
      );
      rt.registered.push(info.modelName);
    }
  }

  private unregisterTools(rt: Runtime | undefined): void {
    if (!rt) return;
    const registry = this.deps.registry();
    for (const name of rt.registered) registry.unregister(name);
    rt.registered = [];
  }

  async callTool(
    id: string,
    name: string,
    args: Record<string, unknown>,
    options: { timeoutMs: number; signal: AbortSignal },
  ): Promise<{ content?: never[]; isError?: boolean; structuredContent?: unknown }> {
    const rt = this.servers.get(id);
    if (!rt?.client || rt.state.status !== "connected") throw Object.assign(new Error("Not connected."), { code: -32000 });
    const result = await rt.client.callTool({ name, arguments: args }, undefined, {
      timeout: options.timeoutMs,
      signal: options.signal,
      resetTimeoutOnProgress: true,
      maxTotalTimeout: options.timeoutMs * 5,
    });
    rt.state.lastSuccessAt = this.now();
    return result as never;
  }

  private onConnectionClosed(rt: Runtime): void {
    rt.client = null;
    rt.transport = null;
    if (rt.closing) return;
    const message = "The connection to the server was lost.";
    this.log(rt, "error", message);
    this.set(rt, { status: "error", error: message, failures: rt.state.failures + 1 });
    emitIntegrationEvent({ type: "mcp.server_disconnected", label: `Lost connection to ${rt.state.config.name}`, serverId: rt.state.config.id });
    this.scheduleReconnect(rt);
  }

  private scheduleReconnect(rt: Runtime): void {
    const delays = this.deps.reconnectDelaysMs ?? [2_000, 5_000, 15_000];
    if (!rt.state.config.enabled || rt.state.reconnectAttempts >= delays.length) return;
    const delay = delays[rt.state.reconnectAttempts]!;
    rt.state.reconnectAttempts += 1;
    this.log(rt, "info", `Reconnecting in ${Math.round(delay / 1000)} s (attempt ${rt.state.reconnectAttempts} of ${delays.length}).`);
    this.changed();
    rt.reconnectTimer = setTimeout(() => {
      rt.reconnectTimer = null;
      const attempts = rt.state.reconnectAttempts;
      void this.connect(rt.state.config.id).then((ok) => {
        if (!ok) {
          rt.state.reconnectAttempts = attempts;
          this.scheduleReconnect(rt);
        }
      });
    }, delay);
  }

  private async closeConnection(rt: Runtime): Promise<void> {
    const client = rt.client;
    const transport = rt.transport;
    rt.client = null;
    rt.transport = null;
    if (!client && !transport) return;
    rt.closing = true;
    try {
      if (client) await client.close();
      else await transport?.close();
    } catch {
      /* already gone */
    }
  }

  /** Disconnect by the user's choice (no automatic reconnection). */
  async disconnect(id: string, status: "disconnected" | "disabled" = "disconnected"): Promise<void> {
    const rt = this.servers.get(id);
    if (!rt) return;
    if (rt.reconnectTimer) clearTimeout(rt.reconnectTimer);
    rt.reconnectTimer = null;
    rt.generation++;
    const wasConnected = rt.state.status === "connected" || rt.state.status === "connecting";
    await this.closeConnection(rt);
    if (wasConnected) {
      this.log(rt, "info", status === "disabled" ? "Disabled." : "Disconnected.");
      emitIntegrationEvent({ type: "mcp.server_disconnected", label: `Disconnected from ${rt.state.config.name}`, serverId: id });
    }
    this.set(rt, { status, error: null, reconnectAttempts: 0 });
  }

  async restart(id: string): Promise<boolean> {
    await this.disconnect(id);
    return this.connect(id);
  }

  /** Connect if needed, then verify the server answers. */
  async test(id: string): Promise<{ ok: boolean; message: string }> {
    const rt = this.servers.get(id);
    if (!rt) return { ok: false, message: "Unknown server." };
    if (rt.state.status !== "connected") {
      const ok = await this.connect(id);
      const state = this.servers.get(id)!.state;
      return ok
        ? { ok: true, message: `Connected. ${state.tools.length} tool(s) available.` }
        : { ok: false, message: state.error ?? "Could not connect." };
    }
    const ok = await this.ping(rt);
    return ok ? { ok: true, message: `The server answered. ${rt.state.tools.length} tool(s) available.` } : { ok: false, message: rt.state.error ?? "No answer." };
  }

  async refreshTools(id: string): Promise<void> {
    const rt = this.servers.get(id);
    if (!rt?.client || rt.state.status !== "connected") return;
    try {
      this.applyTools(rt, await this.discover(rt.client));
      this.log(rt, "info", `Tools refreshed: ${rt.state.tools.length}.`);
      this.changed();
    } catch (err) {
      this.log(rt, "error", `Could not list tools: ${toVinnieError(err).message}`);
      this.changed();
    }
  }

  // ---- health ----------------------------------------------------------------

  private async ping(rt: Runtime): Promise<boolean> {
    const client = rt.client;
    if (!client) return false;
    try {
      await client.ping({ timeout: PING_TIMEOUT_MS });
      rt.state.lastSuccessAt = this.now();
      this.changed();
      return true;
    } catch (err) {
      const message = `Health check failed: ${err instanceof Error ? err.message : String(err)}`;
      this.log(rt, "error", message);
      await this.closeConnection(rt);
      this.set(rt, { status: "error", error: message, failures: rt.state.failures + 1 });
      emitIntegrationEvent({ type: "mcp.server_disconnected", label: `${rt.state.config.name} stopped answering`, serverId: rt.state.config.id });
      this.scheduleReconnect(rt);
      return false;
    }
  }

  startHealthMonitor(): void {
    const interval = this.deps.pingIntervalMs ?? 30_000;
    if (!interval || this.pingTimer) return;
    this.pingTimer = setInterval(() => {
      for (const rt of this.servers.values()) if (rt.state.status === "connected") void this.ping(rt);
    }, interval);
  }

  /** Run one health check of every connected server (used by tests and the UI). */
  async checkHealth(): Promise<void> {
    await Promise.all([...this.servers.values()].filter((r) => r.state.status === "connected").map((r) => this.ping(r)));
  }

  async shutdown(): Promise<void> {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    await Promise.all([...this.servers.keys()].map((id) => this.disconnect(id)));
  }
}

function describeConnectError(err: unknown): string {
  const e = toVinnieError(err);
  const message = sanitizeText(e.message, 500);
  if (/401|unauthori[sz]ed/i.test(message)) return `The server rejected the credentials (401). Check the server's secrets. (${message})`;
  if (/timed? ?out|-32001/i.test(message)) return `The server did not finish starting within ${CONNECT_TIMEOUT_MS / 1000} seconds. (${message})`;
  return message;
}
