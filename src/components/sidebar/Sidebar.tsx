import { PanelLeftClose, PanelLeftOpen, Plus, Search, Settings as SettingsIcon, X } from "lucide-react";
import { useEffect, useState } from "react";
import { IconButton } from "@/components/common/Button";
import { Logo } from "@/components/common/Logo";
import { useConversationStore } from "@/state/conversationStore";
import { useSettingsStore } from "@/state/settingsStore";
import { useUiStore } from "@/state/uiStore";
import { ConversationList } from "./ConversationList";
import { ProjectSelector } from "./ProjectSelector";

const SEARCH_DEBOUNCE_MS = 200;

function SearchBox() {
  const search = useConversationStore((s) => s.search);
  const [value, setValue] = useState("");

  useEffect(() => {
    const t = setTimeout(() => void search(value), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [value, search]);

  return (
    <div className="relative px-3">
      <Search size={13} className="pointer-events-none absolute left-5.5 top-1/2 -translate-y-1/2 text-faint" />
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setValue("")}
        placeholder="Search conversations"
        aria-label="Search conversations"
        className="h-8 w-full rounded-md border border-border bg-surface pl-7 pr-7 text-sm outline-none placeholder:text-faint focus:border-border-strong [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => setValue("")}
          aria-label="Clear search"
          className="absolute right-5 top-1/2 -translate-y-1/2 rounded p-0.5 text-faint hover:text-text"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

export function Sidebar() {
  const collapsed = useSettingsStore((s) => s.settings.sidebarCollapsed);
  const setCollapsed = useSettingsStore((s) => s.setSidebarCollapsed);
  const startNew = useConversationStore((s) => s.startNew);
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);

  const newConversation = () => {
    setView("chat");
    startNew();
  };

  if (collapsed) {
    return (
      <aside className="frost flex w-14 shrink-0 flex-col items-center gap-1 border-r border-border bg-bg-elevated py-3">
        <Logo size={26} />
        <div className="mt-3 flex flex-col gap-1">
          <IconButton label="Expand sidebar" onClick={() => void setCollapsed(false)}>
            <PanelLeftOpen size={16} />
          </IconButton>
          <IconButton label="New conversation" onClick={newConversation}>
            <Plus size={16} />
          </IconButton>
        </div>
        <div className="flex-1" />
        <ProjectSelector collapsed />
        <IconButton label="Settings" active={view === "settings"} onClick={() => setView("settings")}>
          <SettingsIcon size={16} />
        </IconButton>
      </aside>
    );
  }

  return (
    <aside className="frost flex w-68 shrink-0 flex-col border-r border-border bg-bg-elevated">
      <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
        <Logo size={26} />
        <span className="text-[15px] font-semibold tracking-tight">Vinnie</span>
        <div className="flex-1" />
        <IconButton label="Collapse sidebar" onClick={() => void setCollapsed(true)}>
          <PanelLeftClose size={16} />
        </IconButton>
      </div>
      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={newConversation}
          className="flex h-9 w-full items-center gap-2 rounded-md border border-border-strong bg-surface px-3 text-sm font-medium transition-colors hover:border-accent/50 hover:bg-surface-2"
        >
          <Plus size={15} className="text-accent" /> New conversation
          <kbd className="ml-auto font-sans text-[11px] text-faint">Ctrl+N</kbd>
        </button>
      </div>
      <SearchBox />
      <div className="mt-3 flex min-h-0 flex-1 flex-col">
        <ConversationList />
      </div>
      <div className="flex flex-col gap-2 border-t border-border py-3">
        <ProjectSelector collapsed={false} />
        <div className="px-2">
          <button
            type="button"
            onClick={() => setView("settings")}
            aria-current={view === "settings" ? "page" : undefined}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
              view === "settings" ? "bg-surface-3 text-text" : "text-muted hover:bg-surface-2 hover:text-text"
            }`}
          >
            <SettingsIcon size={15} /> Settings
          </button>
        </div>
      </div>
    </aside>
  );
}
