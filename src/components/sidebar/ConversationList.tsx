import { MessageSquare, Pencil, Trash2 } from "lucide-react";
import { useMemo, useState, type KeyboardEvent } from "react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Spinner } from "@/components/common/Spinner";
import { groupByDate } from "@/lib/dates";
import type { Conversation } from "@/lib/ipc/types";
import { useChatStore } from "@/state/chatStore";
import { useConversationStore } from "@/state/conversationStore";
import { useUiStore } from "@/state/uiStore";

function ConversationItem({
  conversation,
  active,
  generating,
  onDelete,
}: {
  conversation: Conversation;
  active: boolean;
  generating: boolean;
  onDelete(c: Conversation): void;
}) {
  const open = useConversationStore((s) => s.open);
  const rename = useConversationStore((s) => s.rename);
  const setView = useUiStore((s) => s.setView);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(conversation.title);

  const commit = async () => {
    const title = draft.trim();
    setEditing(false);
    if (title && title !== conversation.title) {
      const ok = await rename(conversation.id, title);
      if (!ok) setDraft(conversation.title);
    } else {
      setDraft(conversation.title);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") void commit();
    if (e.key === "Escape") {
      setDraft(conversation.title);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <li className="px-2">
        <input
          autoFocus
          value={draft}
          maxLength={120}
          aria-label="Conversation title"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => void commit()}
          className="w-full rounded-md border border-accent bg-surface px-2 py-1.5 text-sm outline-none"
        />
      </li>
    );
  }

  return (
    <li className="group relative px-2">
      <button
        type="button"
        onClick={() => {
          setView("chat");
          if (!active) void open(conversation.id);
        }}
        aria-current={active ? "page" : undefined}
        title={conversation.title}
        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 pr-14 text-left text-sm transition-colors ${
          active ? "bg-surface-3 text-text" : "text-muted hover:bg-surface-2 hover:text-text"
        }`}
      >
        {generating ? (
          <Spinner size={13} className="shrink-0 text-accent" />
        ) : (
          <MessageSquare size={13} className="shrink-0 opacity-60" />
        )}
        <span className="truncate">{conversation.title}</span>
      </button>
      <div className="absolute right-3 top-1/2 flex -translate-y-1/2 gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <button
          type="button"
          aria-label={`Rename ${conversation.title}`}
          title="Rename"
          onClick={() => {
            setDraft(conversation.title);
            setEditing(true);
          }}
          className="rounded p-1 text-faint hover:bg-surface-3 hover:text-text"
        >
          <Pencil size={12} />
        </button>
        <button
          type="button"
          aria-label={`Delete ${conversation.title}`}
          title="Delete"
          onClick={() => onDelete(conversation)}
          className="rounded p-1 text-faint hover:bg-danger-soft hover:text-danger"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </li>
  );
}

export function ConversationList() {
  const conversations = useConversationStore((s) => s.conversations);
  const results = useConversationStore((s) => s.results);
  const query = useConversationStore((s) => s.query);
  const listStatus = useConversationStore((s) => s.listStatus);
  const activeId = useConversationStore((s) => s.activeId);
  const remove = useConversationStore((s) => s.remove);
  const generatingId = useChatStore((s) => s.generation?.conversationId ?? null);

  const [pendingDelete, setPendingDelete] = useState<Conversation | null>(null);
  const [deleting, setDeleting] = useState(false);

  const searching = query.trim().length > 0;
  const items = useMemo(() => (searching ? (results ?? []) : conversations), [searching, results, conversations]);
  const groups = useMemo(
    () => (searching ? [{ label: "Results", items }] : groupByDate(items, (c) => c.updatedAt)),
    [items, searching],
  );

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    await remove(pendingDelete.id);
    setDeleting(false);
    setPendingDelete(null);
  };

  let content;
  if (listStatus === "loading" && conversations.length === 0) {
    content = (
      <div className="flex items-center gap-2 px-4 py-3 text-xs text-faint">
        <Spinner size={13} /> Loading…
      </div>
    );
  } else if (items.length === 0) {
    content = (
      <p className="px-4 py-3 text-xs text-faint">
        {searching ? "No conversations match your search." : "No conversations yet. Start one below."}
      </p>
    );
  } else {
    content = groups.map((group) => (
      <section key={group.label} className="mb-3" aria-label={group.label}>
        <h3 className="px-4 pb-1 text-[11px] font-medium uppercase tracking-wider text-faint">{group.label}</h3>
        <ul className="flex flex-col gap-px">
          {group.items.map((c) => (
            <ConversationItem
              key={c.id}
              conversation={c}
              active={c.id === activeId}
              generating={c.id === generatingId}
              onDelete={setPendingDelete}
            />
          ))}
        </ul>
      </section>
    ));
  }

  return (
    <>
      <nav aria-label="Conversations" className="min-h-0 flex-1 overflow-y-auto py-1">
        {content}
      </nav>
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete conversation?"
        description={
          <>
            “{pendingDelete?.title}” and all of its messages will be permanently deleted. This can't be undone.
          </>
        }
        confirmLabel="Delete"
        destructive
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}
