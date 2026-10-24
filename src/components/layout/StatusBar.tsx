import { describeError } from "@/lib/errors";
import { useChatStore } from "@/state/chatStore";
import { useConnectionStore } from "@/state/connectionStore";
import { useApprovalStore } from "@/state/approvalStore";
import { useCurrentOperation } from "@/state/status";
import { useWorkspaceStore } from "@/state/workspaceStore";
import { GitBranch, Hand } from "lucide-react";
import { DragonIndicator } from "./DragonIndicator";

export function StatusBar() {
  const status = useConnectionStore((s) => s.status);
  const error = useConnectionStore((s) => s.error);
  const info = useConnectionStore((s) => s.info);
  const models = useConnectionStore((s) => s.models);
  const refresh = useConnectionStore((s) => s.refresh);
  const generation = useChatStore((s) => s.generation);
  const operation = useCurrentOperation();
  const git = useWorkspaceStore((w) => w.git);
  const approvals = useApprovalStore((a) => a.pending.length);

  const connectionText = {
    connected: `Connected${info ? ` · ${info.endpoint}` : ""}`,
    disconnected: error ? describeError(error).title : "Disconnected",
    checking: "Connecting…",
    unknown: "Not connected",
  }[status];

  const generationText = generation
    ? {
        preparing: "Starting",
        context: "Preparing context",
        waiting: "Starting",
        streaming: "Generating",
        tools: "Using tools",
        stopping: "Stopping",
      }[generation.phase]
    : "Idle";

  return (
    <footer
      className="flex h-7 shrink-0 items-center gap-4 border-t border-border bg-bg-elevated px-4 text-[11px] text-faint"
      aria-label="Status"
    >
      <DragonIndicator />
      <span className="flex items-center gap-1.5" data-testid="status-connection">
        <span
          className={`size-1.5 rounded-full ${
            status === "connected" ? "bg-success" : status === "disconnected" ? "bg-danger" : "bg-warning"
          }`}
          aria-hidden="true"
        />
        Ollama: {connectionText}
        {status === "disconnected" && (
          <button type="button" onClick={() => void refresh()} className="ml-1 text-accent hover:underline">
            Retry
          </button>
        )}
      </span>
      <span data-testid="status-generation">Generation: {generationText}</span>
      <span className="min-w-0 flex-1 truncate" aria-live="polite" data-testid="status-operation">
        {operation}
      </span>
      {approvals > 0 && (
        <span className="flex items-center gap-1 text-warning" data-testid="status-approvals">
          <Hand size={11} /> {approvals} waiting for approval
        </span>
      )}
      {git?.isRepo && (
        <span className="flex items-center gap-1" title={`${git.modified.length} modified, ${git.untracked.length} untracked`}>
          <GitBranch size={11} /> {git.branch ?? "detached"}
          {git.modified.length + git.untracked.length > 0 ? ` · ${git.modified.length + git.untracked.length} changed` : ""}
        </span>
      )}
      {status === "connected" && (
        <span>
          {models.length} model{models.length === 1 ? "" : "s"} installed
        </span>
      )}
    </footer>
  );
}
