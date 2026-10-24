import { AlertTriangle, X } from "lucide-react";
import type { ReactNode } from "react";
import { describeError, type ErrorContext } from "@/lib/errors";
import { CopyButton } from "./CopyButton";

/** Friendly, actionable error panel. */
export function ErrorNotice({
  error,
  context,
  actions,
  onDismiss,
  compact,
}: {
  error: unknown;
  context?: ErrorContext;
  actions?: ReactNode;
  onDismiss?: () => void;
  compact?: boolean;
}) {
  const d = describeError(error, context);
  return (
    <div
      role="alert"
      className={`rounded-lg border border-danger/30 bg-danger-soft text-sm ${compact ? "p-2.5" : "p-3.5"}`}
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-text">{d.title}</div>
          <div className="mt-0.5 break-words text-muted">{d.detail}</div>
          {d.hint && !compact && <div className="mt-1.5 text-muted">{d.hint}</div>}
          {d.command && !compact && (
            <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-code px-2.5 py-1.5 font-mono text-xs">
              <span className="flex-1 select-all">{d.command}</span>
              <CopyButton text={d.command} label="Copy command" />
            </div>
          )}
          {actions && <div className="mt-2.5 flex flex-wrap gap-2">{actions}</div>}
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="rounded p-0.5 text-muted hover:bg-surface-3 hover:text-text"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
