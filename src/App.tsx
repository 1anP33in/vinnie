import { useEffect } from "react";
import { bootstrap } from "@/app/bootstrap";
import { useReconnectEffect, useShortcuts, useThemeEffect } from "@/app/useAppEffects";
import { ChatView } from "@/components/chat/ChatView";
import { ErrorNotice } from "@/components/common/ErrorNotice";
import { StatusBar } from "@/components/layout/StatusBar";
import { Toolbar } from "@/components/layout/Toolbar";
import { SettingsView } from "@/components/settings/SettingsView";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { useConversationStore } from "@/state/conversationStore";
import { useSettingsStore } from "@/state/settingsStore";
import { useUiStore } from "@/state/uiStore";

let bootstrapped = false;

function GlobalNotices() {
  const settingsError = useSettingsStore((s) => s.loadError);
  const listError = useConversationStore((s) => s.listError);
  const actionError = useConversationStore((s) => s.actionError);
  const dismissAction = useConversationStore((s) => s.dismissActionError);
  const error = actionError ?? listError ?? settingsError;
  if (!error) return null;
  return (
    <div className="pointer-events-none fixed bottom-10 right-4 z-40 w-96 max-w-[calc(100vw-2rem)]">
      <div className="pointer-events-auto shadow-2xl">
        <ErrorNotice error={error} compact onDismiss={actionError ? dismissAction : undefined} />
      </div>
    </div>
  );
}

export default function App() {
  const view = useUiStore((s) => s.view);
  useThemeEffect();
  useReconnectEffect();
  useShortcuts();

  useEffect(() => {
    if (bootstrapped) return;
    bootstrapped = true;
    void bootstrap();
  }, []);

  return (
    <div className="flex h-full bg-bg text-text">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <Toolbar />
        {view === "settings" ? <SettingsView /> : <ChatView />}
        <StatusBar />
      </main>
      <GlobalNotices />
    </div>
  );
}
