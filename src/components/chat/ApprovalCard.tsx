import { FileWarning, Package, ShieldQuestion, Terminal } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/common/Button";
import { DiffView } from "@/components/editor/DiffView";
import type { ApprovalRequest, PermissionScope } from "@/agent/types";
import { useEditorStore } from "@/state/editorStore";
import { useApprovalStore, type PendingApproval } from "@/state/approvalStore";

function Field({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[88px_1fr] gap-2 text-xs">
      <span className="text-faint">{label}</span>
      <span className={`min-w-0 break-words ${mono ? "font-mono" : ""} text-text`}>{children}</span>
    </div>
  );
}

function CommandBody({ request, manager, setManager }: {
  request: Extract<ApprovalRequest, { kind: "command" }>;
  manager: string;
  setManager(m: string): void;
}) {
  const install = request.install;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="rounded-md border border-border bg-code px-3 py-2 font-mono text-[13px] text-text" data-testid="approval-command">
        {request.command}
      </div>
      {install && (
        <>
          <Field label="Package manager">
            {install.ambiguous ? (
              <span className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Package manager"
                  value={manager}
                  onChange={(e) => setManager(e.target.value)}
                  className="rounded border border-border bg-bg px-1 py-0.5"
                >
                  {install.candidates.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                <span className="text-warning">Unclear: {install.detectionReason}</span>
              </span>
            ) : (
              <>
                {install.manager} <span className="text-faint">({install.detectionReason})</span>
              </>
            )}
          </Field>
          <Field label="Dependencies" mono>
            {install.packages.length ? install.packages.join(", ") : "all declared dependencies"}
          </Field>
        </>
      )}
      <Field label="Workspace" mono>
        {request.workspace}
        {request.cwd ? `\\${request.cwd}` : ""}
      </Field>
      {request.reason && <Field label="Reason">{request.reason}</Field>}
      <Field label="Risk">
        <span className={request.assessment.risk === "low" ? "text-success" : "text-warning"}>
          {request.install ? "Installs packages (high)" : request.assessment.risk === "low" ? "Low" : "Needs approval (high)"}
        </span>{" "}
        <span className="text-faint">— {request.assessment.reason}</span>
      </Field>
    </div>
  );
}

function ApprovalItem({ item }: { item: PendingApproval }) {
  const respond = useApprovalStore((s) => s.respond);
  const { request } = item;
  const [manager, setManager] = useState(request.kind === "command" ? (request.install?.manager ?? "") : "");

  let icon: React.ReactNode;
  let title: string;
  let body: React.ReactNode;
  let actions: React.ReactNode;

  if (request.kind === "command") {
    icon = request.install ? <Package size={15} className="text-accent" /> : <Terminal size={15} className="text-accent" />;
    title = request.install ? "Vinnie wants to install dependencies:" : "Vinnie wants to run:";
    body = <CommandBody request={request} manager={manager} setManager={setManager} />;
    const decide = (approved: boolean, scope: PermissionScope = "once") =>
      respond(item.id, { approved, scope, manager: request.install ? manager : undefined });
    actions = (
      <>
        <Button size="sm" variant="primary" onClick={() => decide(true)}>
          Allow once
        </Button>
        <Button size="sm" onClick={() => decide(true, "task")} title="Allow this exact command until the current task ends">
          Allow for this task
        </Button>
        <Button size="sm" onClick={() => decide(true, "session")} title="Allow this exact command until Vinnie restarts">
          This session
        </Button>
        {!request.install?.ambiguous && (
          <Button size="sm" onClick={() => decide(true, "workspace")} title="Always allow this exact command in this project">
            Always allow
          </Button>
        )}
        <Button size="sm" variant="danger" onClick={() => decide(false)}>
          Deny
        </Button>
      </>
    );
  } else if (request.kind === "file") {
    const p = request.preview;
    icon = <FileWarning size={15} className="text-accent" />;
    title = {
      create: "Vinnie wants to create a file:",
      modify: "Vinnie wants to change a file:",
      delete: "Vinnie wants to delete a file:",
      move: "Vinnie wants to move a file:",
    }[p.kind];
    body = (
      <div className="flex flex-col gap-1.5">
        <Field label="File" mono>
          {p.newPath ? `${p.path} → ${p.newPath}` : p.path}
          {p.kind !== "move" && (
            <span className="ml-2 font-sans">
              <span className="text-success">+{p.additions}</span> <span className="text-danger">−{p.deletions}</span>
            </span>
          )}
        </Field>
        {request.reason && <Field label="Reason">{request.reason}</Field>}
        <Field label="Risk">
          <span className="text-warning">{p.kind === "delete" ? "Deletes a file (reversible)" : "Changes project files (reversible)"}</span>
        </Field>
        {p.kind !== "move" &&
          (p.binary ? (
            <p className="text-xs text-warning">Binary file: no text diff available.</p>
          ) : (
            <div className="overflow-hidden rounded-md border border-border">
              <DiffView
                path={p.path}
                original={p.before ?? ""}
                modified={p.after ?? ""}
                height={Math.min(320, 60 + 19 * Math.max(p.additions, p.deletions, 4))}
                initialSideBySide={false}
              />
            </div>
          ))}
        {p.kind === "delete" && <p className="text-xs text-faint">A snapshot is kept, so the file can be restored from Changes.</p>}
      </div>
    );
    const viewChanges = () =>
      useEditorStore.getState().openDiff({
        id: `proposal:${item.id}`,
        path: p.newPath ?? p.path,
        title: `${(p.newPath ?? p.path).split("/").pop()} (proposed)`,
        original: p.before ?? "",
        modified: p.after ?? "",
      });
    actions = (
      <>
        <Button size="sm" variant={p.kind === "delete" ? "danger" : "primary"} onClick={() => respond(item.id, { approved: true })}>
          {p.kind === "delete" ? "Delete" : "Approve"}
        </Button>
        {p.kind !== "delete" && (
          <Button
            size="sm"
            onClick={() => respond(item.id, { approved: true, scope: "task" })}
            title="Approve this and Vinnie's other file changes until the current task ends"
          >
            Approve all for this task
          </Button>
        )}
        <Button size="sm" variant="danger" onClick={() => respond(item.id, { approved: false })}>
          Deny
        </Button>
        {p.kind !== "move" && !p.binary && (
          <Button size="sm" variant="ghost" onClick={viewChanges}>
            View changes
          </Button>
        )}
      </>
    );
  } else {
    icon = <ShieldQuestion size={15} className="text-warning" />;
    title = "Vinnie wants to read a file that may contain secrets:";
    body = (
      <div className="flex flex-col gap-1.5">
        <Field label="File" mono>
          {request.path}
        </Field>
        <p className="text-xs text-faint">Its contents would be sent to the local model.</p>
      </div>
    );
    actions = (
      <>
        <Button size="sm" onClick={() => respond(item.id, { approved: true })}>
          Allow once
        </Button>
        <Button size="sm" variant="danger" onClick={() => respond(item.id, { approved: false })}>
          Deny
        </Button>
      </>
    );
  }

  return (
    <div className="rounded-xl border border-accent/40 bg-surface p-3.5 shadow-glow" role="alertdialog" aria-label={title} data-testid="approval-card">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </div>
      {body}
      <div className="mt-3 flex flex-wrap gap-2">{actions}</div>
    </div>
  );
}

export function ApprovalCards() {
  const pending = useApprovalStore((s) => s.pending);
  if (pending.length === 0) return null;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-6 pb-2">
      {pending.map((p) => (
        <ApprovalItem key={p.id} item={p} />
      ))}
    </div>
  );
}
