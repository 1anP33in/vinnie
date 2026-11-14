import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { ChatView } from "@/components/chat/ChatView";
import { DragonPanel } from "@/components/dragon/DragonPanel";
import { EditorArea } from "@/components/editor/EditorArea";
import { useEditorStore } from "@/state/editorStore";
import { useSettingsStore } from "@/state/settingsStore";
import { useUiStore } from "@/state/uiStore";
import { BottomPanel } from "./BottomPanel";

export function ResizeHandle({ direction }: { direction: "horizontal" | "vertical" }) {
  return (
    <PanelResizeHandle
      className={`group relative shrink-0 bg-border transition-colors hover:bg-accent/60 data-[resize-handle-state=drag]:bg-accent ${
        direction === "horizontal" ? "w-px" : "h-px"
      }`}
    >
      {/* Wider invisible hit area. */}
      <span
        className={`absolute ${direction === "horizontal" ? "inset-y-0 -left-1 -right-1" : "inset-x-0 -top-1 -bottom-1"}`}
      />
    </PanelResizeHandle>
  );
}

/** Editor + chat (+ the ice dragon) on top, terminal/activity below. */
export function Workbench() {
  const hasTabs = useEditorStore((s) => s.tabs.length > 0);
  const bottomOpen = useUiStore((s) => s.bottomOpen);
  const dragon = useSettingsStore((s) => s.settings.dragon);
  const updateDragon = useSettingsStore((s) => s.updateDragon);
  const showDragon = dragon.enabled && dragon.panelOpen;
  return (
    <PanelGroup direction="vertical" autoSaveId="vinnie-workbench-v" className="min-h-0 flex-1">
      <Panel id="top" order={1} minSize={25}>
        <PanelGroup direction="horizontal" autoSaveId="vinnie-workbench-h">
          {hasTabs && (
            <>
              <Panel id="editor" order={1} minSize={25} defaultSize={58}>
                <EditorArea />
              </Panel>
              <ResizeHandle direction="horizontal" />
            </>
          )}
          <Panel id="chat" order={2} minSize={22}>
            <div className="flex h-full min-h-0 flex-col">
              {showDragon && dragon.layout === "compact" && <DragonPanel layout="compact" />}
              <ChatView />
            </div>
          </Panel>
          {showDragon && dragon.layout === "side" && (
            <>
              <ResizeHandle direction="horizontal" />
              <Panel
                id="dragon"
                order={3}
                minSize={15}
                maxSize={60}
                defaultSize={dragon.panelSize}
                onResize={(size) => {
                  const rounded = Math.round(size);
                  if (rounded !== dragon.panelSize) updateDragon({ panelSize: rounded });
                }}
              >
                <DragonPanel layout="side" />
              </Panel>
            </>
          )}
        </PanelGroup>
      </Panel>
      {bottomOpen && (
        <>
          <ResizeHandle direction="vertical" />
          <Panel id="bottom" order={2} defaultSize={32} minSize={12}>
            <BottomPanel />
          </Panel>
        </>
      )}
    </PanelGroup>
  );
}
