import {
  FolderTree,
  GitCompareArrows,
  MessagesSquare,
  Plus,
  Search,
  Settings as SettingsIcon,
  SquareTerminal,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { ChangesPanel } from "@/components/changes/ChangesPanel";
import { IconButton } from "@/components/common/Button";
import { Logo } from "@/components/common/Logo";
import { ExplorerPanel } from "@/components/explorer/ExplorerPanel";
import { SearchPanel } from "@/components/search/SearchPanel";
import { useConversationStore } from "@/state/conversationStore";
import { useSettingsStore } from "@/state/settingsStore";
import { useUiStore, type SideView } from "@/state/uiStore";
import { ConversationList } from "./ConversationList";
import { ProjectSelector } from "./ProjectSelector";

const SEARCH_DEBOUNCE_MS = 200;

const VIEWS: { view: SideView; label: string; icon: typeof FolderTree; shortcut: string }[] = [
  { view: "chats", label: "Conversations", icon: MessagesSquare, shortcut: "" },
  { view: "explorer", label: "Explorer", icon: FolderTree, shortcut: "Ctrl+Shift+E" },
  { view: "search", label: "Search", icon: Search, shortcut: "Ctrl+Shift+F" },
  { view: "changes", label: "Changes", icon: GitCompareArrows, shortcut: "" },
];

function ConversationSearch() {
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

function ChatsPanel() {
  const startNew = useConversationStore((s) => s.startNew);
  const setView = useUiStore((s) => s.setView);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={() => {
            setView("chat");
            startNew();
          }}
          className="flex h-9 w-full items-center gap-2 rounded-md border border-border-strong bg-surface px-3 text-sm font-medium transition-colors hover:border-accent/50 hover:bg-surface-2"
        >
          <Plus size={15} className="text-accent" /> New conversation
          <kbd className="ml-auto font-sans text-[11px] text-faint">Ctrl+N</kbd>
        </button>
      </div>
      <ConversationSearch />
      <div className="mt-3 flex min-h-0 flex-1 flex-col">
        <ConversationList />
      </div>
      <div className="border-t border-border py-3">
        <ProjectSelector collapsed={false} />
      </div>
    </div>
  );
}

/** Narrow icon rail on the far left. */
export function ActivityRail() {
  const collapsed = useSettingsStore((s) => s.settings.sidebarCollapsed);
  const setCollapsed = useSettingsStore((s) => s.setSidebarCollapsed);
  const sideView = useUiStore((s) => s.sideView);
  const setSideView = useUiStore((s) => s.setSideView);
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);
  const bottomOpen = useUiStore((s) => s.bottomOpen);
  const toggleBottom = useUiStore((s) => s.toggleBottom);

  const select = (v: SideView) => {
    if (v === sideView && !collapsed) {
      void setCollapsed(true);
    } else {
      setSideView(v);
      if (collapsed) void setCollapsed(false);
    }
  };

  return (
    <nav aria-label="Views" className="frost flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-bg-elevated py-3">
      <Logo size={24} className="mb-3" />
      {VIEWS.map(({ view: v, label, icon: Icon, shortcut }) => (
        <IconButton
          key={v}
          label={shortcut ? `${label} (${shortcut})` : label}
          active={sideView === v && !collapsed}
          onClick={() => select(v)}
          className="size-9"
        >
          <Icon size={18} />
        </IconButton>
      ))}
      <div className="flex-1" />
      <IconButton label="Terminal & activity (Ctrl+`)" active={bottomOpen} onClick={toggleBottom} className="size-9">
        <SquareTerminal size={18} />
      </IconButton>
      <IconButton
        label="Settings (Ctrl+,)"
        active={view === "settings"}
        onClick={() => setView(view === "settings" ? "chat" : "settings")}
        className="size-9"
      >
        <SettingsIcon size={18} />
      </IconButton>
    </nav>
  );
}

/** The panel next to the rail: explorer, search, changes, or conversations. */
export function SidePanel() {
  const sideView = useUiStore((s) => s.sideView);
  const title = VIEWS.find((v) => v.view === sideView)?.label ?? "";
  return (
    <aside aria-label={title} className="flex h-full min-w-0 flex-col border-r border-border bg-bg-elevated">
      <div className="flex h-10 shrink-0 items-center px-4 text-[11px] font-semibold uppercase tracking-wider text-faint">
        {title}
      </div>
      {sideView === "explorer" && <ExplorerPanel />}
      {sideView === "search" && <SearchPanel />}
      {sideView === "changes" && <ChangesPanel />}
      {sideView === "chats" && <ChatsPanel />}
    </aside>
  );
}
