import { ChevronRight, Wrench } from "lucide-react";
import { memo, useState } from "react";
import type { ToolCall } from "@/lib/ipc/types";
import type { UiMessage } from "@/state/conversationStore";
import { argsOf, summarizeCall } from "./toolCalls";

export const ToolCallChips = memo(function ToolCallChips({ calls }: { calls: ToolCall[] }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1.5" data-testid="tool-calls">
      {calls.map((c, i) => (
        <span
          key={i}
          className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-muted"
          title={JSON.stringify(argsOf(c), null, 2).slice(0, 2000)}
        >
          <Wrench size={10} className="shrink-0 text-accent" />
          <span className="truncate">{summarizeCall(c)}</span>
        </span>
      ))}
    </div>
  );
});

export const ToolResultBubble = memo(function ToolResultBubble({ message }: { message: UiMessage }) {
  const [open, setOpen] = useState(false);
  const failed = message.content.startsWith("Error:");
  const first = message.content.split("\n", 1)[0] ?? "";
  return (
    <div className="ml-10" data-testid="message-tool">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex max-w-full items-center gap-1.5 text-left text-[11.5px] text-faint hover:text-muted"
      >
        <ChevronRight size={11} className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
        <span className="shrink-0 font-mono">{message.toolName ?? "tool"}</span>
        <span className={`truncate ${failed ? "text-danger" : ""}`}>{first}</span>
      </button>
      {open && (
        <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-code px-3 py-2 font-mono text-[11.5px] text-muted">
          {message.content}
        </pre>
      )}
    </div>
  );
});
