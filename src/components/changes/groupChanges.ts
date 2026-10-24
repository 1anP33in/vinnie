import type { ChangeRecord } from "@/lib/ipc/types";

export interface Group {
  key: string;
  taskId: string | null;
  source: "user" | "assistant";
  changes: ChangeRecord[];
}

/** Group consecutive changes from the same assistant task. */
export function groupChanges(changes: ChangeRecord[]): Group[] {
  const groups: Group[] = [];
  for (const c of changes) {
    const last = groups[groups.length - 1];
    if (c.taskId && last && last.taskId === c.taskId) last.changes.push(c);
    else groups.push({ key: `${c.taskId ?? "single"}-${c.id}`, taskId: c.taskId, source: c.source, changes: [c] });
  }
  return groups;
}
