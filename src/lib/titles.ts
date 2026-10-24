export const MAX_TITLE_LENGTH = 60;
export const FALLBACK_TITLE = "New conversation";

/**
 * Derive a conversation title from the first user message: the first
 * meaningful line, stripped of markdown noise, shortened on a word boundary.
 */
export function deriveTitle(text: string, maxLength = MAX_TITLE_LENGTH): string {
  const firstLine =
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith("```")) ?? "";

  const cleaned = firstLine
    .replace(/^#+\s*/, "") // headings
    .replace(/^[-*>]\s+/, "") // bullets / quotes
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return FALLBACK_TITLE;
  if (cleaned.length <= maxLength) return cleaned;

  const slice = cleaned.slice(0, maxLength);
  const lastSpace = slice.lastIndexOf(" ");
  const base = lastSpace > maxLength * 0.5 ? slice.slice(0, lastSpace) : slice;
  return `${base.replace(/[\s.,;:!?-]+$/, "")}…`;
}
