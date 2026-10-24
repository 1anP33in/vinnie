import { ArrowDown } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useChatStore } from "@/state/chatStore";
import { useConversationStore } from "@/state/conversationStore";
import { useSettingsStore } from "@/state/settingsStore";
import { MessageBubble, StreamingBubble } from "./MessageBubble";

const STICK_THRESHOLD_PX = 80;

export function MessageList() {
  const activeId = useConversationStore((s) => s.activeId);
  const messages = useConversationStore((s) => s.messages);
  const generation = useChatStore((s) => s.generation);
  const retrySave = useChatStore((s) => s.retrySave);
  const showReasoning = useSettingsStore((s) => s.settings.showReasoning);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const streaming = generation && generation.conversationId === activeId ? generation : null;

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  // New conversation: start at the bottom.
  const [shownId, setShownId] = useState(activeId);
  if (shownId !== activeId) {
    setShownId(activeId);
    setShowJump(false);
  }
  useEffect(() => {
    stickToBottom.current = true;
  }, [activeId]);

  // Follow new content only while the user is at the bottom.
  useLayoutEffect(() => {
    if (stickToBottom.current) scrollToBottom();
  }, [messages, streaming?.content, streaming?.thinking, scrollToBottom]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
    stickToBottom.current = atBottom;
    setShowJump(!atBottom);
  };

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto" data-testid="message-list">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-6">
          {messages.map((m) => (
            <MessageBubble key={m.localId} message={m} showReasoning={showReasoning} onRetrySave={retrySave} />
          ))}
          {streaming && (
            <StreamingBubble
              model={streaming.model}
              content={streaming.content}
              thinking={streaming.thinking}
              showReasoning={showReasoning}
              stopping={streaming.phase === "stopping"}
            />
          )}
        </div>
      </div>
      {showJump && (
        <button
          type="button"
          onClick={() => {
            stickToBottom.current = true;
            scrollToBottom(true);
          }}
          className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border-strong bg-surface px-3 py-1 text-xs text-muted shadow-lg hover:text-text"
        >
          <ArrowDown size={13} /> Jump to latest
        </button>
      )}
    </div>
  );
}
