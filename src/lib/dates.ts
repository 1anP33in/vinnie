export interface DateGroup<T> {
  label: string;
  items: T[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Bucket label for a timestamp relative to `now`. */
export function dateGroupLabel(timestamp: number, now: number = Date.now()): string {
  const today = startOfDay(now);
  if (timestamp >= today) return "Today";
  if (timestamp >= today - DAY_MS) return "Yesterday";
  if (timestamp >= today - 7 * DAY_MS) return "Previous 7 days";
  if (timestamp >= today - 30 * DAY_MS) return "Previous 30 days";
  const date = new Date(timestamp);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, sameYear ? { month: "long" } : { month: "long", year: "numeric" });
}

/** Group items (already sorted newest first) by date bucket, preserving order. */
export function groupByDate<T>(items: T[], getTime: (item: T) => number, now: number = Date.now()): DateGroup<T>[] {
  const groups: DateGroup<T>[] = [];
  for (const item of items) {
    const label = dateGroupLabel(getTime(item), now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
