// Add / edit an MCP server. Secret values are typed into password fields,
// sent once to the backend (Windows Credential Manager), and never shown again.

import { KeyRound, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/common/Button";
import { describeError } from "@/lib/errors";
import type { McpServerConfig, McpServerInput, SecretChanges } from "@/lib/ipc/types";
import { emptyServer, toInput, validateServerInput, type ServerErrors } from "@/mcp/config";
import { getMcpManager } from "@/state/mcpStore";
import { PolicySelect, Switch } from "./common";

const inputClass =
  "h-8 w-full rounded-md border border-border bg-bg px-2.5 text-sm outline-none focus:border-accent aria-[invalid=true]:border-danger";
const areaClass = "w-full rounded-md border border-border bg-bg px-2.5 py-1.5 font-mono text-xs outline-none focus:border-accent";

function Row({ label, htmlFor, error, hint, children }: { label: string; htmlFor?: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="text-[11px] text-faint">{hint}</p>
      )}
    </div>
  );
}

/** `KEY=value` / `Name: value` lines ↔ a map. */
function parsePairs(text: string, sep: "=" | ":"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf(sep);
    if (i <= 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function formatPairs(map: Record<string, string>, sep: "=" | ": "): string {
  return Object.entries(map)
    .map(([k, v]) => `${k}${sep}${v}`)
    .join("\n");
}

const slugId = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+|_+$/g, "")
    .replace(/_{2,}/g, "_")
    .slice(0, 24)
    .replace(/_+$/g, "");

export function ServerEditor({
  existing,
  initial,
  requiredSecrets,
  onDone,
}: {
  existing: McpServerConfig | null;
  /** Prefill for a new server (e.g. from an import). */
  initial?: McpServerInput;
  requiredSecrets?: string[];
  onDone(id: string | null): void;
}) {
  const [draft, setDraft] = useState<McpServerInput>(() => (existing ? toInput(existing) : (initial ?? emptyServer())));
  const [idTouched, setIdTouched] = useState(!!existing || !!initial?.id);
  const [argsText, setArgsText] = useState(draft.args.join("\n"));
  const [envText, setEnvText] = useState(formatPairs(draft.env, "="));
  const [headersText, setHeadersText] = useState(formatPairs(draft.headers, ": "));
  const [secrets, setSecrets] = useState<SecretChanges>(() => Object.fromEntries((requiredSecrets ?? []).map((k) => [k, ""])) as SecretChanges);
  const [newSecret, setNewSecret] = useState({ kind: draft.transport === "http" ? "header" : "env", name: "", value: "" });
  const [errors, setErrors] = useState<ServerErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const isNew = !existing;
  const set = <K extends keyof McpServerInput>(key: K, value: McpServerInput[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };
  const storedKeys = existing?.secretKeys ?? [];
  const pendingKeys = Object.keys(secrets).filter((k) => !storedKeys.includes(k));

  const addSecret = () => {
    const name = newSecret.name.trim();
    if (!name || !newSecret.value) return;
    setSecrets((s) => ({ ...s, [`${newSecret.kind}:${name}`]: newSecret.value }));
    setNewSecret((n) => ({ ...n, name: "", value: "" }));
  };

  const save = async () => {
    const input: McpServerInput = {
      ...draft,
      args: argsText.split("\n").map((a) => a.trim()).filter(Boolean),
      env: parsePairs(envText, "="),
      headers: parsePairs(headersText, ":"),
      command: draft.transport === "stdio" ? draft.command : null,
      url: draft.transport === "http" ? draft.url : null,
    };
    const v = validateServerInput(input);
    // Every secret that must be (re)entered needs a value.
    const missing = Object.entries(secrets).find(([k, val]) => val === "" && !storedKeys.includes(k));
    if (missing) v.secrets = `Enter a value for the secret ${missing[0]}.`;
    setErrors(v);
    if (Object.values(v).some(Boolean)) return;
    const changes: SecretChanges = Object.fromEntries(Object.entries(secrets).filter(([, val]) => val !== ""));
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await getMcpManager().save(input, changes, isNew);
      onDone(saved.id);
    } catch (err) {
      setSaveError(describeError(err).detail);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="server-editor">
      <h3 className="text-sm font-semibold">{isNew ? "Add MCP server" : `Edit ${existing.name}`}</h3>
      <div className="grid grid-cols-2 gap-3">
        <Row label="Name" htmlFor="srv-name" error={errors.name}>
          <input
            id="srv-name"
            className={inputClass}
            value={draft.name}
            aria-invalid={!!errors.name}
            onChange={(e) => {
              set("name", e.target.value);
              if (!idTouched) set("id", slugId(e.target.value));
            }}
            placeholder="GitHub"
          />
        </Row>
        <Row label="ID (tool prefix)" htmlFor="srv-id" error={errors.id} hint={isNew ? "Tools appear as id.tool_name." : "IDs can't be changed."}>
          <input
            id="srv-id"
            className={`${inputClass} font-mono`}
            value={draft.id}
            disabled={!isNew}
            aria-invalid={!!errors.id}
            onChange={(e) => {
              setIdTouched(true);
              set("id", e.target.value);
            }}
            placeholder="github"
          />
        </Row>
      </div>
      <Row label="Description" htmlFor="srv-desc" error={errors.description}>
        <input id="srv-desc" className={inputClass} value={draft.description} onChange={(e) => set("description", e.target.value)} placeholder="What this server is for (optional)" />
      </Row>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted">Transport</span>
        <div role="radiogroup" aria-label="Transport" className="inline-flex w-fit rounded-lg border border-border bg-bg p-0.5">
          {(["stdio", "http"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={draft.transport === t}
              onClick={() => set("transport", t)}
              className={`rounded-md px-3 py-1 text-xs ${draft.transport === t ? "bg-surface-3 text-text" : "text-muted hover:text-text"}`}
            >
              {t === "stdio" ? "Local process (stdio)" : "Remote (Streamable HTTP)"}
            </button>
          ))}
        </div>
      </div>

      {draft.transport === "stdio" ? (
        <>
          <Row label="Command" htmlFor="srv-cmd" error={errors.command} hint="A program on PATH (npx, uvx, node, python) or a full path. It runs directly, never through a shell.">
            <input id="srv-cmd" className={`${inputClass} font-mono`} value={draft.command ?? ""} aria-invalid={!!errors.command} onChange={(e) => set("command", e.target.value)} placeholder="npx" />
          </Row>
          <Row label="Arguments (one per line)" htmlFor="srv-args" error={errors.args}>
            <textarea id="srv-args" rows={3} className={areaClass} value={argsText} onChange={(e) => setArgsText(e.target.value)} placeholder={"-y\n@modelcontextprotocol/server-filesystem\nC:\\Projects\\docs"} />
          </Row>
          <div className="grid grid-cols-2 gap-3">
            <Row label="Environment (KEY=value, not secret)" htmlFor="srv-env" error={errors.env}>
              <textarea id="srv-env" rows={2} className={areaClass} value={envText} onChange={(e) => setEnvText(e.target.value)} placeholder="LOG_LEVEL=info" />
            </Row>
            <Row label="Working folder (optional)" htmlFor="srv-cwd" error={errors.cwd}>
              <input id="srv-cwd" className={`${inputClass} font-mono`} value={draft.cwd ?? ""} onChange={(e) => set("cwd", e.target.value || null)} placeholder="Defaults to your user folder" />
            </Row>
          </div>
        </>
      ) : (
        <>
          <Row label="URL" htmlFor="srv-url" error={errors.url} hint="https:// for remote servers; http:// only for localhost.">
            <input id="srv-url" className={`${inputClass} font-mono`} value={draft.url ?? ""} aria-invalid={!!errors.url} onChange={(e) => set("url", e.target.value)} placeholder="https://example.com/mcp" />
          </Row>
          <Row label="Headers (Name: value, not secret)" htmlFor="srv-headers" error={errors.headers}>
            <textarea id="srv-headers" rows={2} className={areaClass} value={headersText} onChange={(e) => setHeadersText(e.target.value)} placeholder="X-Workspace: my-team" />
          </Row>
        </>
      )}

      <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted">
          <KeyRound size={13} /> Secrets (stored in Windows Credential Manager, never in Vinnie's settings)
        </div>
        {[...storedKeys, ...pendingKeys].map((key) => {
          const stored = storedKeys.includes(key);
          const change = secrets[key];
          return (
            <div key={key} className="flex items-center gap-2 text-xs">
              <span className="w-44 shrink-0 truncate font-mono" title={key}>
                {key}
              </span>
              {change === null ? (
                <span className="flex-1 text-danger">Will be removed</span>
              ) : (
                <input
                  type="password"
                  aria-label={`Value for ${key}`}
                  className={`${inputClass} h-7 flex-1`}
                  placeholder={stored ? "Stored securely — type to replace" : "Value"}
                  value={change ?? ""}
                  onChange={(e) => setSecrets((s) => ({ ...s, [key]: e.target.value }))}
                  autoComplete="off"
                />
              )}
              <button
                type="button"
                aria-label={`Remove secret ${key}`}
                className="rounded p-1 text-faint hover:bg-surface-3 hover:text-danger"
                onClick={() =>
                  setSecrets((s) => {
                    const next = { ...s };
                    if (stored) next[key] = null;
                    else delete next[key];
                    return next;
                  })
                }
              >
                <Trash2 size={12} />
              </button>
            </div>
          );
        })}
        <div className="flex items-center gap-2 text-xs">
          <select
            aria-label="Secret type"
            value={newSecret.kind}
            onChange={(e) => setNewSecret((n) => ({ ...n, kind: e.target.value }))}
            className="h-7 rounded border border-border bg-bg px-1"
          >
            <option value="env">env</option>
            <option value="header">header</option>
          </select>
          <input
            aria-label="Secret name"
            className={`${inputClass} h-7 w-40 font-mono`}
            placeholder={newSecret.kind === "env" ? "GITHUB_TOKEN" : "Authorization"}
            value={newSecret.name}
            onChange={(e) => setNewSecret((n) => ({ ...n, name: e.target.value }))}
          />
          <input
            type="password"
            aria-label="Secret value"
            className={`${inputClass} h-7 flex-1`}
            placeholder={newSecret.kind === "header" ? "Bearer …" : "Value"}
            value={newSecret.value}
            onChange={(e) => setNewSecret((n) => ({ ...n, value: e.target.value }))}
            autoComplete="off"
          />
          <Button size="sm" onClick={addSecret} disabled={!newSecret.name.trim() || !newSecret.value}>
            Add secret
          </Button>
        </div>
        {errors.secrets && (
          <p className="text-xs text-danger" role="alert">
            {errors.secrets}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Row label="Tool timeout (seconds)" htmlFor="srv-timeout" error={errors.toolTimeoutSecs}>
          <input
            id="srv-timeout"
            type="number"
            min={5}
            max={600}
            className={inputClass}
            value={draft.toolTimeoutSecs}
            onChange={(e) => set("toolTimeoutSecs", Number(e.target.value))}
          />
        </Row>
        <Row label="Default approval for this server's tools" hint="Destructive tools always ask, whatever this says.">
          <PolicySelect label="Default tool policy" value={draft.defaultPolicy} onChange={(v) => set("defaultPolicy", v ?? "ask")} />
        </Row>
      </div>
      <div className="flex flex-wrap gap-5 text-xs">
        <label className="flex items-center gap-2">
          <Switch checked={draft.enabled} onChange={(v) => set("enabled", v)} label="Enabled" /> Enabled
        </label>
        <label className="flex items-center gap-2">
          <Switch checked={draft.autoConnect} onChange={(v) => set("autoConnect", v)} label="Connect when Vinnie starts" /> Connect when Vinnie starts
        </label>
      </div>

      {saveError && (
        <p className="text-xs text-danger" role="alert">
          {saveError}
        </p>
      )}
      <div className="flex gap-2">
        <Button variant="primary" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : isNew ? "Add server" : "Save changes"}
        </Button>
        <Button variant="ghost" onClick={() => onDone(existing?.id ?? null)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
