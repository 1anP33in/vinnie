import { useEffect } from "react";
import { Panel, PanelGroup } from "react-resizable-panels";
import { bootstrap } from "@/app/bootstrap";
import { useReconnectEffect, useShortcuts, useThemeEffect } from "@/app/useAppEffects";
import { ErrorNotice } from "@/components/common/ErrorNotice";
import { StatusBar } from "@/components/layout/StatusBar";
import { Toolbar } from "@/components/layout/Toolbar";
import { ResizeHandle, Workbench } from "@/components/layout/Workbench";
import { SettingsView } from "@/components/settings/SettingsView";
import { ActivityRail, SidePanel } from "@/components/sidebar/Sidebar";
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
  const collapsed = useSettingsStore((s) => s.settings.sidebarCollapsed);
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
      <ActivityRail />
      <PanelGroup direction="horizontal" autoSaveId="vinnie-shell" className="min-w-0 flex-1">
        {!collapsed && (
          <>
            <Panel id="side" order={1} defaultSize={20} minSize={14} maxSize={40}>
              <SidePanel />
            </Panel>
            <ResizeHandle direction="horizontal" />
          </>
        )}
        <Panel id="main" order={2} minSize={40}>
          <main className="flex h-full min-w-0 flex-col">
            <Toolbar />
            {view === "settings" ? <SettingsView /> : <Workbench />}
            <StatusBar />
          </main>
        </Panel>
      </PanelGroup>
      <GlobalNotices />
    </div>
  );
}
