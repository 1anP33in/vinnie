/** "14:05" today, otherwise a short date and time; "never" for null. */
export function formatWhen(ms: number | null): string {
  if (!ms) return "never";
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
