// MCP Manager: add, edit, connect, and monitor MCP servers, and control
// each discovered tool.

import { Download, Pencil, Plug, Plus, RefreshCw, RotateCw, Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/common/Button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Spinner } from "@/components/common/Spinner";
import { describeError } from "@/lib/errors";
import type { McpLogEntry, McpServerInput } from "@/lib/ipc/types";
import { exportServers, parseImport } from "@/mcp/config";
import type { McpServerState } from "@/mcp/manager";
import { getServices } from "@/services";
import { getMcpManager, useMcpServers } from "@/state/mcpStore";
import { useToolSettingsStore } from "@/state/toolSettingsStore";
import { PageHeader, PermissionBadge, PolicySelect, StatusBadge, Switch } from "./common";
import { formatWhen } from "./format";
import { ServerEditor } from "./ServerEditor";

type Mode = { kind: "view"; id: string | null } | { kind: "edit"; id: string } | { kind: "new"; initial?: McpServerInput; requiredSecrets?: string[] };

function ServerList({ servers, selected, onSelect }: { servers: McpServerState[]; selected: string | null; onSelect(id: string): void }) {
  if (servers.length === 0) {
    return <p className="px-3 py-4 text-xs text-faint">No MCP servers yet. Add one to give Vinnie new tools.</p>;
  }
  return (
    <ul className="flex flex-col gap-1 p-2" aria-label="MCP servers">
      {servers.map((s) => (
        <li key={s.config.id}>
          <button
            type="button"
            onClick={() => onSelect(s.config.id)}
            aria-current={selected === s.config.id}
            className={`flex w-full flex-col gap-1 rounded-lg px-3 py-2 text-left transition-colors ${
              selected === s.config.id ? "bg-surface-3" : "hover:bg-surface-2"
            }`}
          >
            <span className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.config.name}</span>
              <StatusBadge status={s.status} />
            </span>
            <span className="text-[11px] text-faint">
              {s.tools.length} tool{s.tools.length === 1 ? "" : "s"} available · {s.config.transport === "stdio" ? "local" : "remote"}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-faint">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

function ServerLogs({ server }: { server: McpServerState }) {
  const [backend, setBackend] = useState<McpLogEntry[]>([]);
  const id = server.config.id;
  const logCount = server.log.length;
  useEffect(() => {
    let alive = true;
    getServices()
      .mcp.logs(id)
      .then((l) => alive && setBackend(l))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id, logCount, server.status]);
  const entries = [...server.log, ...backend].sort((a, b) => a.at - b.at).slice(-150);
  return (
    <div className="max-h-56 overflow-auto rounded-md border border-border bg-code p-2 font-mono text-[11px]" data-testid="server-logs">
      {entries.length === 0 ? (
        <span className="text-faint">No log entries yet.</span>
      ) : (
        entries.map((e, i) => (
          <div key={i} className={e.level === "error" ? "text-danger" : e.level === "warn" ? "text-warning" : e.level === "stderr" ? "text-muted" : "text-text"}>
            <span className="text-faint">{new Date(e.at).toLocaleTimeString()}</span> {e.message}
          </div>
        ))
      )}
    </div>
  );
}

function ServerDetails({ server, onEdit, onRemoved }: { server: McpServerState; onEdit(): void; onRemoved(): void }) {
  const manager = getMcpManager();
  const settings = useToolSettingsStore((s) => s.settings);
  const setEnabled = useToolSettingsStore((s) => s.setEnabled);
  const setPolicy = useToolSettingsStore((s) => s.setPolicy);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const { config, status } = server;
  const connected = status === "connected";

  /** Run an action; an action may return a message to show. */
  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label);
    setMessage(null);
    try {
      const result = (await action()) as { ok?: boolean; text?: string } | undefined;
      if (result && typeof result.text === "string") setMessage({ ok: result.ok === true, text: result.text });
    } catch (err) {
      setMessage({ ok: false, text: describeError(err).detail });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="server-details">
      <div className="flex flex-wrap items-center gap-2">
        <Plug size={16} className="text-accent" />
        <h3 className="text-base font-semibold">{config.name}</h3>
        <StatusBadge status={status} />
        {busy && <Spinner size={13} />}
        <span className="flex-1" />
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <Switch checked={config.enabled} onChange={(v) => void run("enable", () => manager.setEnabled(config.id, v))} label="Server enabled" />
          Enabled
        </label>
      </div>
      {config.description && <p className="-mt-2 text-xs text-muted">{config.description}</p>}

      <div className="flex flex-wrap gap-2">
        {connected || status === "connecting" ? (
          <Button size="sm" onClick={() => void run("disconnect", () => manager.disconnect(config.id))} disabled={!!busy}>
            Disconnect
          </Button>
        ) : (
          <Button size="sm" variant="primary" onClick={() => void run("connect", () => manager.connect(config.id))} disabled={!!busy || !config.enabled}>
            Connect
          </Button>
        )}
        <Button size="sm" icon={<RotateCw size={12} />} onClick={() => void run("restart", () => manager.restart(config.id))} disabled={!!busy || !config.enabled}>
          Restart
        </Button>
        <Button
          size="sm"
          onClick={() =>
            void run("test", async () => {
              const r = await manager.test(config.id);
              return { ok: r.ok, text: r.message };
            })
          }
          disabled={!!busy || !config.enabled}
        >
          Test connection
        </Button>
        <Button size="sm" icon={<RefreshCw size={12} />} onClick={() => void run("refresh", () => manager.refreshTools(config.id))} disabled={!!busy || !connected}>
          Refresh tools
        </Button>
        <Button size="sm" variant="ghost" icon={<Pencil size={12} />} onClick={onEdit}>
          Edit
        </Button>
        <Button size="sm" variant="danger" icon={<Trash2 size={12} />} onClick={() => setConfirmRemove(true)}>
          Remove
        </Button>
      </div>
      {message && (
        <p className={`text-xs ${message.ok ? "text-success" : "text-danger"}`} role="status">
          {message.text}
        </p>
      )}
      {server.error && status === "error" && (
        <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger" role="alert">
          {server.error}
        </p>
      )}

      <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-1 text-xs">
        <Info label="Transport">{config.transport === "stdio" ? "Local process (stdio)" : "Streamable HTTP"}</Info>
        {config.transport === "stdio" ? (
          <Info label="Command">
            <span className="font-mono">
              {config.command} {config.args.join(" ")}
            </span>
          </Info>
        ) : (
          <Info label="URL">
            <span className="font-mono">{config.url}</span>
          </Info>
        )}
        {config.secretKeys.length > 0 && <Info label="Secrets">{config.secretKeys.join(", ")} (Credential Manager)</Info>}
        <Info label="Server">{server.serverInfo ? `${server.serverInfo.name} ${server.serverInfo.version}` : "—"}</Info>
        <Info label="Last connected">{formatWhen(config.lastConnectedAt)}</Info>
        <Info label="Last response">{formatWhen(server.lastSuccessAt)}</Info>
        <Info label="Failures">
          {server.failures}
          {server.reconnectAttempts > 0 ? ` · reconnect attempt ${server.reconnectAttempts}` : ""}
        </Info>
        <Info label="Tool approval">{{ ask: "Ask every time", allow: "Allow without asking", deny: "Never allow" }[config.defaultPolicy]} (default)</Info>
      </dl>

      <section>
        <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">Available tools ({server.tools.length})</h4>
        {server.tools.length === 0 ? (
          <p className="text-xs text-faint">{connected ? "This server exposes no tools." : "Connect to discover tools."}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border" data-testid="server-tools">
            {server.tools.map((t) => {
              const s = settings[t.settingsKey];
              const enabled = s?.enabled ?? true;
              return (
                <li key={t.name} className="flex items-start gap-2 px-3 py-2 text-xs">
                  <Switch checked={enabled} onChange={(v) => void setEnabled(t.settingsKey, v)} label={`Enable ${t.displayName}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`font-mono ${enabled ? "" : "text-faint line-through"}`}>{t.name}</span>
                      <PermissionBadge permission={t.permission} />
                    </div>
                    {t.description && <p className="mt-0.5 line-clamp-2 text-faint">{t.description}</p>}
                  </div>
                  <PolicySelect
                    label={`Approval for ${t.displayName}`}
                    value={s?.policy ?? null}
                    onChange={(v) => void setPolicy(t.settingsKey, v)}
                    allowDefault
                    defaultLabel="Server default"
                  />
                </li>
              );
            })}
          </ul>
        )}
        {server.rejected.length > 0 && (
          <div className="mt-2 text-xs">
            <p className="text-warning">Rejected tools (not available to Vinnie):</p>
            <ul className="list-disc pl-5 text-faint">
              {server.rejected.map((r) => (
                <li key={r.name}>
                  <span className="font-mono">{r.name}</span>: {r.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section>
        <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">Logs</h4>
        <ServerLogs server={server} />
      </section>

      <ConfirmDialog
        open={confirmRemove}
        title={`Remove ${config.name}?`}
        description="Vinnie disconnects the server, deletes its configuration, and removes its secrets from Windows Credential Manager."
        confirmLabel="Remove server"
        destructive
        onConfirm={() => {
          setConfirmRemove(false);
          void run("remove", async () => {
            await manager.remove(config.id);
            onRemoved();
          });
        }}
        onCancel={() => setConfirmRemove(false)}
      />
    </div>
  );
}

export function McpView() {
  const servers = useMcpServers();
  const [mode, setMode] = useState<Mode>({ kind: "view", id: null });
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const selectedId = mode.kind === "view" ? (mode.id ?? servers[0]?.config.id ?? null) : mode.kind === "edit" ? mode.id : null;
  const selected = servers.find((s) => s.config.id === selectedId) ?? null;

  const exportAll = async () => {
    try {
      const path = await getServices().dialogs.saveText("vinnie-mcp-servers.json", JSON.stringify(exportServers(servers.map((s) => s.config)), null, 2));
      if (path) setNotice({ ok: true, text: `Exported ${servers.length} server(s) without secrets to ${path}.` });
    } catch (err) {
      setNotice({ ok: false, text: describeError(err).detail });
    }
  };

  const importFile = async () => {
    try {
      const file = await getServices().dialogs.openText();
      if (!file) return;
      const result = parseImport(file.content);
      const fresh = result.servers.filter((s) => !servers.some((x) => x.config.id === s.server.id));
      const skipped = result.servers.length - fresh.length;
      const first = fresh[0];
      const problems = [...result.errors, ...(skipped ? [`${skipped} server(s) already exist and were skipped.`] : [])];
      if (!first) {
        setNotice({ ok: false, text: problems.join(" ") || "Nothing to import." });
        return;
      }
      // Servers that need no secrets are added (disabled) right away; one that
      // needs secrets opens in the editor so the user can enter them.
      let added = 0;
      for (const s of fresh) {
        if (s === first && s.requiredSecrets.length) continue;
        await getMcpManager().save(s.server, {}, true);
        added++;
      }
      if (first.requiredSecrets.length) setMode({ kind: "new", initial: first.server, requiredSecrets: first.requiredSecrets });
      setNotice({
        ok: problems.length === 0,
        text: [`Imported ${added} server(s); imported servers start disabled so you can review them first.`, ...problems].join(" "),
      });
    } catch (err) {
      setNotice({ ok: false, text: describeError(err).detail });
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="mcp-view">
      <PageHeader
        title="MCP servers"
        description="Connect Model Context Protocol servers to give Vinnie new tools. Every tool still goes through your permissions and approvals."
        actions={
          <>
            <Button size="sm" variant="ghost" icon={<Upload size={12} />} onClick={() => void importFile()}>
              Import
            </Button>
            <Button size="sm" variant="ghost" icon={<Download size={12} />} onClick={() => void exportAll()} disabled={servers.length === 0}>
              Export
            </Button>
            <Button size="sm" variant="primary" icon={<Plus size={12} />} onClick={() => setMode({ kind: "new" })}>
              Add MCP server
            </Button>
          </>
        }
      />
      {notice && (
        <p className={`border-b border-border px-6 py-2 text-xs ${notice.ok ? "text-success" : "text-warning"}`} role="status">
          {notice.text}
        </p>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="w-64 shrink-0 overflow-y-auto border-r border-border">
          <ServerList servers={servers} selected={mode.kind === "new" ? null : selectedId} onSelect={(id) => setMode({ kind: "view", id })} />
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto px-6 py-5">
          {mode.kind === "new" ? (
            <ServerEditor
              existing={null}
              initial={mode.initial}
              requiredSecrets={mode.requiredSecrets}
              onDone={(id) => setMode({ kind: "view", id })}
            />
          ) : mode.kind === "edit" && selected ? (
            <ServerEditor existing={selected.config} onDone={(id) => setMode({ kind: "view", id })} />
          ) : selected ? (
            <ServerDetails
              key={selected.config.id}
              server={selected}
              onEdit={() => setMode({ kind: "edit", id: selected.config.id })}
              onRemoved={() => setMode({ kind: "view", id: null })}
            />
          ) : (
            <div className="mx-auto mt-10 max-w-md text-center text-sm text-muted">
              <Plug className="mx-auto mb-3 text-accent" size={28} />
              <p className="mb-1 font-medium text-text">No server selected</p>
              <p className="text-xs">
                Example: a filesystem server for your docs folder uses command <span className="font-mono">npx</span> with arguments{" "}
                <span className="font-mono">-y @modelcontextprotocol/server-filesystem C:\Docs</span>.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
