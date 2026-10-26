import { RefreshCw, RotateCcw, Settings as SettingsIcon } from "lucide-react";
import { Button } from "@/components/common/Button";
import { LaunchOllamaButton } from "@/components/common/LaunchOllamaButton";
import { ErrorNotice } from "@/components/common/ErrorNotice";
import { Spinner } from "@/components/common/Spinner";
import { useChatStore } from "@/state/chatStore";
import { useConversationStore } from "@/state/conversationStore";
import { useSettingsStore } from "@/state/settingsStore";
import { useUiStore } from "@/state/uiStore";
import { AgentPanel } from "@/components/agent/AgentPanel";
import { ApprovalCards } from "./ApprovalCard";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { WelcomeScreen } from "./WelcomeScreen";

function ChatNotice() {
  const notice = useChatStore((s) => s.notice);
  const dismiss = useChatStore((s) => s.dismissNotice);
  if (!notice) return null;
  return (
    <div className="mx-auto mb-2 flex w-full max-w-3xl items-center gap-2 px-6 text-xs text-warning" role="status">
      <span className="flex-1">{notice}</span>
      <button type="button" onClick={dismiss} className="text-faint hover:text-text">
        Dismiss
      </button>
    </div>
  );
}

function ChatErrorBanner() {
  const activeId = useConversationStore((s) => s.activeId);
  const chatError = useChatStore((s) => s.error);
  const retry = useChatStore((s) => s.retry);
  const dismiss = useChatStore((s) => s.dismissError);
  const endpoint = useSettingsStore((s) => s.settings.ollamaEndpoint);
  const setView = useUiStore((s) => s.setView);

  if (!chatError || (chatError.conversationId !== null && chatError.conversationId !== activeId)) return null;
  const kind = chatError.error.kind;
  return (
    <div className="mx-auto w-full max-w-3xl px-6">
      <ErrorNotice
        error={chatError.error}
        context={{ endpoint, model: chatError.model }}
        onDismiss={dismiss}
        actions={
          <>
            {chatError.canRetry && activeId && (
              <Button size="sm" onClick={() => void retry()} icon={<RotateCcw size={13} />}>
                Retry
              </Button>
            )}
            {kind === "unreachable" && <LaunchOllamaButton />}
            {(kind === "unreachable" || kind === "malformed") && (
              <Button size="sm" variant="ghost" onClick={() => setView("settings")} icon={<SettingsIcon size={13} />}>
                Open settings
              </Button>
            )}
          </>
        }
      />
    </div>
  );
}

export function ChatView() {
  const activeId = useConversationStore((s) => s.activeId);
  const status = useConversationStore((s) => s.messagesStatus);
  const error = useConversationStore((s) => s.messagesError);
  const open = useConversationStore((s) => s.open);

  let body;
  if (!activeId) {
    body = <WelcomeScreen />;
  } else if (status === "loading") {
    body = (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted">
        <Spinner /> Loading conversation…
      </div>
    );
  } else if (status === "error") {
    body = (
      <div className="mx-auto w-full max-w-xl flex-1 px-6 py-10">
        <ErrorNotice
          error={error}
          actions={
            <Button size="sm" onClick={() => void open(activeId)} icon={<RefreshCw size={13} />}>
              Try again
            </Button>
          }
        />
      </div>
    );
  } else {
    body = <MessageList />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {body}
      <AgentPanel />
      <ApprovalCards />
      <ChatNotice />
      <ChatErrorBanner />
      <Composer />
    </div>
  );
}
