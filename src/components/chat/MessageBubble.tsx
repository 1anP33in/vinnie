import { AlertTriangle, Brain, ChevronRight, CircleSlash } from "lucide-react";
import { memo, useState } from "react";
import { CopyButton } from "@/components/common/CopyButton";
import { Logo } from "@/components/common/Logo";
import { formatTime } from "@/lib/dates";
import type { UiMessage } from "@/state/conversationStore";
import { Markdown } from "./Markdown";
import { ToolCallChips, ToolResultBubble } from "./ToolMessages";

function Reasoning({ text, streaming, defaultOpen }: { text: string; streaming?: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="mb-2 rounded-md border border-border bg-surface/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-xs text-muted hover:text-text"
      >
        <ChevronRight size={13} className={`transition-transform ${open ? "rotate-90" : ""}`} />
        <Brain size={13} />
        {streaming ? "Reasoning…" : "Reasoning"}
      </button>
      {open && (
        <div className="max-h-72 overflow-y-auto whitespace-pre-wrap border-t border-border px-3 py-2 text-xs leading-relaxed text-muted">
          {text}
        </div>
      )}
    </div>
  );
}

function AssistantHeader({ model, time }: { model: string | null; time?: number }) {
  return (
    <div className="mb-1 flex items-center gap-2 text-xs text-faint">
      <span className="font-medium text-muted">Vinnie</span>
      {model && <span className="rounded bg-surface-2 px-1.5 py-px font-mono text-[11px]">{model}</span>}
      {time != null && <span>{formatTime(time)}</span>}
    </div>
  );
}

function Avatar() {
  return (
    <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface">
      <Logo size={18} />
    </div>
  );
}

export const MessageBubble = memo(function MessageBubble({
  message,
  showReasoning,
  onRetrySave,
}: {
  message: UiMessage;
  showReasoning: boolean;
  onRetrySave?: (localId: string) => void;
}) {
  if (message.role === "tool") return <ToolResultBubble message={message} />;
  const toolCalls = message.toolCalls ?? [];
  if (message.role === "user") {
    return (
      <div className="group flex justify-end" data-testid="message-user">
        <div className="max-w-[85%]">
          <div className="whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-border bg-surface-2 px-4 py-2.5 leading-relaxed">
            {message.content}
          </div>
          <div className="mt-1 flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <CopyButton text={message.content} label="Copy message" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex gap-3" data-testid="message-assistant">
      <Avatar />
      <div className="min-w-0 flex-1">
        <AssistantHeader model={message.model} time={message.createdAt} />
        {showReasoning && message.thinking?.trim() && <Reasoning text={message.thinking.trim()} />}
        {message.content ? (
          <Markdown content={message.content} />
        ) : toolCalls.length === 0 ? (
          <p className="italic text-faint">No response text.</p>
        ) : null}
        {toolCalls.length > 0 && <ToolCallChips calls={toolCalls} />}
        {message.status === "interrupted" && (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-warning-soft px-2 py-1 text-xs text-warning">
            <CircleSlash size={12} />
            {message.error ? `Incomplete: ${message.error}` : "Stopped before finishing"}
          </div>
        )}
        {message.unsaved && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-danger-soft px-2 py-1.5 text-xs text-danger">
            <AlertTriangle size={12} />
            <span>Not saved{message.saveError ? `: ${message.saveError}` : ""}</span>
            {onRetrySave && (
              <button
                type="button"
                className="rounded px-1.5 py-0.5 font-medium underline hover:bg-danger/10"
                onClick={() => onRetrySave(message.localId)}
              >
                Retry save
              </button>
            )}
          </div>
        )}
        <div className="mt-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {message.content && <CopyButton text={message.content} label="Copy response" />}
        </div>
      </div>
    </div>
  );
});

/** The in-progress assistant response. */
export function StreamingBubble({
  model,
  content,
  thinking,
  showReasoning,
  stopping,
  status,
}: {
  model: string;
  content: string;
  thinking: string;
  showReasoning: boolean;
  stopping: boolean;
  /** What is happening when there is no text yet (e.g. a running tool). */
  status?: string | null;
}) {
  return (
    <div className="flex gap-3" data-testid="message-streaming" aria-live="polite" aria-busy="true">
      <Avatar />
      <div className="min-w-0 flex-1">
        <AssistantHeader model={model} />
        {showReasoning && thinking.trim() && (
          <Reasoning text={thinking.trim()} streaming={!content} defaultOpen={!content} />
        )}
        {content ? (
          <div>
            <Markdown content={content} />
            {!stopping && <span className="stream-caret" aria-hidden="true" />}
          </div>
        ) : (
          <div className="flex items-center gap-1.5 py-1 text-sm text-muted">
            <span className="pulse-dot size-1.5 rounded-full bg-accent" />
            <span className="pulse-dot size-1.5 rounded-full bg-accent [animation-delay:200ms]" />
            <span className="pulse-dot size-1.5 rounded-full bg-accent [animation-delay:400ms]" />
            <span className="ml-1.5">
              {stopping ? "Stopping…" : status ? status : thinking.trim() ? "Reasoning…" : "Waiting for the model…"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
