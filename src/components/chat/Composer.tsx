import { ArrowUp, Pause, Play, Square } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useAgentStore } from "@/state/agentStore";
import { useChatStore } from "@/state/chatStore";
import { useConnectionStore } from "@/state/connectionStore";
import { useConversationStore } from "@/state/conversationStore";
import { useUiStore } from "@/state/uiStore";

const MAX_HEIGHT_PX = 240;

export function Composer() {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const submitting = useRef(false);

  const generation = useChatStore((s) => s.generation);
  const send = useChatStore((s) => s.send);
  const stop = useChatStore((s) => s.stop);
  const pauseAgent = useAgentStore((s) => s.pause);
  const resumeAgent = useAgentStore((s) => s.resume);
  const selectedModel = useConnectionStore((s) => s.selectedModel);
  const activeId = useConversationStore((s) => s.activeId);
  const draft = useUiStore((s) => s.composerDraft);

  const busy = generation !== null;
  const canSend = text.trim().length > 0 && !busy && !!selectedModel;

  // Auto-grow up to a maximum height. Re-measure when the width changes too:
  // panels can mount at zero width and be resized later.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    let lastWidth = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth !== lastWidth) {
        lastWidth = el.clientWidth;
        fit();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [activeId]);

  // Apply drafts pushed from elsewhere (e.g. welcome-screen suggestions).
  const [appliedDraft, setAppliedDraft] = useState(draft?.nonce ?? null);
  if (draft && draft.nonce !== appliedDraft) {
    setAppliedDraft(draft.nonce);
    setText(draft.text);
  }
  useEffect(() => {
    if (draft) textareaRef.current?.focus();
  }, [draft]);

  const submit = async () => {
    if (!canSend || submitting.current) return;
    submitting.current = true;
    const value = text;
    setText("");
    try {
      const accepted = await send(value);
      // Restore the draft if the message could not be saved.
      if (!accepted) setText((current) => current || value);
    } finally {
      submitting.current = false;
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  const placeholder = selectedModel ? "Message Vinnie…" : "Select an installed model to start chatting";

  return (
    <div className="px-6 pb-4 pt-2">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-end gap-2 rounded-xl border border-border-strong bg-surface p-2 transition-shadow focus-within:shadow-glow">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            aria-label="Message"
            rows={1}
            className="max-h-60 min-h-[36px] flex-1 resize-none bg-transparent px-2 py-2 leading-relaxed text-text outline-none placeholder:text-faint focus-visible:outline-none"
          />
          {busy && generation?.taskId && generation.phase !== "stopping" && (
            <button
              type="button"
              onClick={generation.phase === "paused" ? resumeAgent : pauseAgent}
              aria-label={generation.phase === "paused" ? "Resume task" : "Pause task"}
              title={generation.phase === "paused" ? "Resume task" : "Pause task"}
              className="inline-flex size-9 items-center justify-center rounded-lg border border-border-strong bg-surface-2 text-text hover:bg-surface-3"
            >
              {generation.phase === "paused" ? <Play size={14} /> : <Pause size={14} />}
            </button>
          )}
          {busy ? (
            <button
              type="button"
              onClick={() => void stop()}
              disabled={generation?.phase === "stopping"}
              aria-label="Stop generating"
              title="Stop generating"
              className="inline-flex size-9 items-center justify-center rounded-lg border border-border-strong bg-surface-2 text-text hover:bg-surface-3 disabled:opacity-50"
            >
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!canSend}
              aria-label="Send message"
              title="Send (Enter)"
              className="inline-flex size-9 items-center justify-center rounded-lg bg-accent text-accent-fg transition-colors hover:bg-accent-strong disabled:bg-surface-3 disabled:text-faint"
            >
              <ArrowUp size={18} />
            </button>
          )}
        </div>
        <p className="mt-1.5 text-center text-[11px] text-faint">
          Enter to send · Shift+Enter for a new line · Responses are generated locally and may be inaccurate.
        </p>
      </div>
    </div>
  );
}
