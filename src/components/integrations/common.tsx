// Small building blocks shared by the MCP, Skills, and Tools screens.

import type { ReactNode } from "react";
import type { ToolPolicy } from "@/lib/ipc/types";
import { PERMISSION_LABEL, type ToolPermission } from "@/mcp/classify";
import type { McpStatus } from "@/mcp/manager";

export function PageHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-3 border-b border-border px-6 py-4">
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-0.5 text-xs text-muted">{description}</p>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const STATUS: Record<McpStatus, { label: string; className: string }> = {
  connected: { label: "CONNECTED", className: "bg-success/15 text-success" },
  connecting: { label: "CONNECTING", className: "bg-accent-soft text-accent" },
  disconnected: { label: "DISCONNECTED", className: "bg-surface-3 text-muted" },
  error: { label: "ERROR", className: "bg-danger-soft text-danger" },
  disabled: { label: "DISABLED", className: "bg-surface-2 text-faint" },
};

export function StatusBadge({ status }: { status: McpStatus }) {
  const s = STATUS[status];
  return (
    <span className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wider ${s.className}`} data-testid="server-status">
      {s.label}
    </span>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange(v: boolean): void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors disabled:opacity-40 ${
        checked ? "bg-accent" : "bg-surface-3"
      }`}
    >
      <span className={`inline-block size-3 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-3.5" : "translate-x-0.5"}`} />
    </button>
  );
}

export function PolicySelect({
  value,
  onChange,
  label,
  allowDefault,
  defaultLabel,
}: {
  value: ToolPolicy | null;
  onChange(v: ToolPolicy | null): void;
  label: string;
  allowDefault?: boolean;
  defaultLabel?: string;
}) {
  return (
    <select
      aria-label={label}
      value={value ?? ""}
      onChange={(e) => onChange((e.target.value || null) as ToolPolicy | null)}
      className="h-6 rounded border border-border bg-bg px-1 text-[11px]"
    >
      {allowDefault && <option value="">{defaultLabel ?? "Default"}</option>}
      <option value="ask">Ask every time</option>
      <option value="allow">Allow without asking</option>
      <option value="deny">Never allow</option>
    </select>
  );
}

const PERMISSION_TONE: Record<ToolPermission, string> = {
  READ: "text-success border-success/30",
  NETWORK: "text-accent border-accent/30",
  WRITE: "text-warning border-warning/30",
  EXECUTE: "text-warning border-warning/30",
  EXTERNAL_ACTION: "text-warning border-warning/30",
  DELETE: "text-danger border-danger/30",
};

export function PermissionBadge({ permission }: { permission: ToolPermission }) {
  return (
    <span className={`inline-flex shrink-0 rounded border px-1 text-[10px] ${PERMISSION_TONE[permission]}`} title="Vinnie's own classification (the server's description is not trusted)">
      {PERMISSION_LABEL[permission]}
    </span>
  );
}
