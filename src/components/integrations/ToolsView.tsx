// Tool Explorer: every tool Vinnie can use (native and MCP), searchable,
// with its source, permission, enable switch, approval policy, and usage.

import { Search } from "lucide-react";
import { useMemo, useState, useSyncExternalStore } from "react";
import type { ToolDefinition } from "@/agent/types";
import { getServices } from "@/services";
import { useMcpServers } from "@/state/mcpStore";
import { useToolSettingsStore } from "@/state/toolSettingsStore";
import { PageHeader, PermissionBadge, PolicySelect, Switch } from "./common";
import { formatWhen } from "./format";

type Group = "all" | "native" | "mcp" | "development" | "filesystem" | "terminal" | "external";

const GROUPS: { id: Group; label: string }[] = [
  { id: "all", label: "All" },
  { id: "native", label: "Native tools" },
  { id: "mcp", label: "MCP tools" },
  { id: "development", label: "Development" },
  { id: "filesystem", label: "Filesystem" },
  { id: "terminal", label: "Terminal" },
  { id: "external", label: "External services" },
];

function inGroup(d: ToolDefinition, g: Group): boolean {
  switch (g) {
    case "all":
      return true;
    case "native":
      return d.source === "native";
    case "mcp":
    case "external":
      return d.source === "mcp";
    case "development":
      return d.category === "PROJECT";
    case "filesystem":
      return ["READ", "SEARCH", "WRITE", "DELETE"].includes(d.category) && d.source === "native";
    case "terminal":
      return d.category === "EXECUTE" || d.category === "DEPENDENCY";
  }
}

const NATIVE_CATEGORY: Record<string, string> = {
  READ: "Read",
  SEARCH: "Search",
  WRITE: "Write",
  DELETE: "Delete",
  EXECUTE: "Execute",
  DEPENDENCY: "Install",
  PROJECT: "Agent",
};

function useTools(): ToolDefinition[] {
  const registry = getServices().tools;
  // Re-read the registry whenever tools are added or removed.
  const version = useSyncExternalStore(
    (cb) => registry.subscribe(cb),
    () => registry.list().length + ":" + registry.list().map((t) => t.name).join(","),
  );
  // Recompute availability when servers change status.
  const servers = useMcpServers();
  const settings = useToolSettingsStore((s) => s.settings);
  return useMemo(() => registry.list(), [registry, version, servers, settings]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function ToolsView() {
  const tools = useTools();
  const servers = useMcpServers();
  const settings = useToolSettingsStore((s) => s.settings);
  const setEnabled = useToolSettingsStore((s) => s.setEnabled);
  const setPolicy = useToolSettingsStore((s) => s.setPolicy);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<Group>("all");

  const q = query.trim().toLowerCase();
  const shown = tools
    .filter((t) => inGroup(t, group))
    .filter((t) => !q || t.displayName.toLowerCase().includes(q) || t.description.toLowerCase().includes(q))
    .sort((a, b) => (a.source === b.source ? a.displayName.localeCompare(b.displayName) : a.source === "native" ? -1 : 1));

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="tools-view">
      <PageHeader
        title="Tools"
        description="Every tool Vinnie can use. A disabled tool is never offered to the model and can't run. Approvals still apply to everything that's enabled."
      />
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-6 py-2.5">
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-faint" />
          <input
            aria-label="Search tools"
            placeholder="Search tools"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-7 w-56 rounded-md border border-border bg-bg pl-7 pr-2 text-xs outline-none focus:border-accent"
          />
        </div>
        <div role="tablist" aria-label="Tool categories" className="flex flex-wrap gap-1">
          {GROUPS.map((g) => (
            <button
              key={g.id}
              type="button"
              role="tab"
              aria-selected={group === g.id}
              onClick={() => setGroup(g.id)}
              className={`rounded-full px-2.5 py-0.5 text-[11px] ${group === g.id ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-text"}`}
            >
              {g.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-[11px] text-faint">
          {shown.length} of {tools.length} tools
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-6 py-3">
        <table className="w-full table-fixed border-collapse text-xs" data-testid="tools-table">
          <thead className="text-left text-[11px] text-faint">
            <tr>
              <th className="w-12 pb-2 font-normal">On</th>
              <th className="pb-2 font-normal">Tool</th>
              <th className="w-36 pb-2 font-normal">Source</th>
              <th className="w-28 pb-2 font-normal">Permission</th>
              <th className="w-40 pb-2 font-normal">Approval</th>
              <th className="w-28 pb-2 font-normal">Last run</th>
              <th className="w-14 pb-2 text-right font-normal">Runs</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => {
              const s = settings[t.settingsKey];
              const server = t.serverId ? servers.find((x) => x.config.id === t.serverId) : undefined;
              return (
                <tr key={t.name} className="border-t border-border/60 align-top">
                  <td className="py-2">
                    <Switch checked={t.enabled} onChange={(v) => void setEnabled(t.settingsKey, v)} label={`Enable ${t.displayName}`} />
                  </td>
                  <td className="py-2 pr-3">
                    <div className={`font-mono ${t.enabled ? "" : "text-faint line-through"}`}>{t.displayName}</div>
                    <div className="mt-0.5 line-clamp-2 text-faint">{t.description.replace(/^\[External tool[^\]]*\]\s*/, "")}</div>
                  </td>
                  <td className="py-2">
                    {t.source === "native" ? (
                      "Native"
                    ) : (
                      <span className={t.available ? "" : "text-warning"} title={t.available ? undefined : "Server not connected"}>
                        {server?.config.name ?? t.serverId}
                        {!t.available && " (offline)"}
                      </span>
                    )}
                  </td>
                  <td className="py-2">
                    {t.permission ? <PermissionBadge permission={t.permission} /> : <span className="text-muted">{NATIVE_CATEGORY[t.category] ?? t.category}</span>}
                  </td>
                  <td className="py-2">
                    {t.source === "mcp" ? (
                      <PolicySelect
                        label={`Approval for ${t.displayName}`}
                        value={s?.policy ?? null}
                        onChange={(v) => void setPolicy(t.settingsKey, v)}
                        allowDefault
                        defaultLabel="Server default"
                      />
                    ) : (
                      <span className="text-faint">Permission settings</span>
                    )}
                  </td>
                  <td className="py-2 text-muted">{formatWhen(s?.lastRunAt ?? null)}</td>
                  <td className="py-2 text-right tabular-nums text-muted">{s?.runCount ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {shown.length === 0 && <p className="py-6 text-center text-xs text-faint">No tools match.</p>}
      </div>
    </div>
  );
}
