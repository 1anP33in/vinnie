// Some local models (e.g. qwen2.5-coder) occasionally write a tool call as
// plain text — a bare JSON object or a <tool_call> tag — instead of using the
// structured `tool_calls` field. Recover those calls, but only when the whole
// reply is the call and it names a registered tool, so ordinary answers that
// merely contain JSON are never executed. Recovered calls go through the same
// registry, validation, permissions, and approvals as structured ones.

import type { ToolCall } from "@/lib/ipc/types";

function parseCall(raw: string, toolNames: Set<string>): ToolCall | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const fn = (obj.function && typeof obj.function === "object" ? obj.function : obj) as Record<string, unknown>;
  const name = fn.name;
  const args = fn.arguments ?? fn.parameters ?? {};
  if (typeof name !== "string" || !toolNames.has(name)) return null;
  if (typeof args !== "object" && typeof args !== "string") return null;
  return { function: { name, arguments: args as Record<string, unknown> } };
}

/** Extract tool calls from a reply that consists only of tool-call text. */
export function extractTextToolCalls(content: string, toolNames: Set<string>): ToolCall[] {
  let text = content.trim();
  if (!text) return [];

  // <tool_call>{...}</tool_call> (one or more), nothing else. Some models
  // use <tool_response> or <function_call> for the same thing.
  const tagPattern = /<(tool_call|tool_response|function_call)>\s*([\s\S]*?)\s*<\/\1>/g;
  const tagged = [...text.matchAll(tagPattern)].map((m) => [m[0], m[2]] as const);
  if (tagged.length > 0) {
    const rest = text.replace(tagPattern, "").trim();
    if (rest) return [];
    const calls = tagged.map(([, body]) => parseCall(body!, toolNames));
    return calls.every(Boolean) ? (calls as ToolCall[]) : [];
  }

  // One or more JSON objects (bare or in ```json fences), nothing else.
  text = text.replace(/```(?:json)?/g, "");
  const objects = scanObjects(text);
  if (!objects || objects.length === 0) return [];
  const calls = objects.map((o) => parseCall(o, toolNames));
  return calls.every(Boolean) ? (calls as ToolCall[]) : [];
}

/**
 * Split text into top-level JSON objects separated only by whitespace.
 * Returns null if anything else is present.
 */
function scanObjects(text: string): string[] | null {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (/\s/.test(text[i]!)) {
      i++;
      continue;
    }
    if (text[i] !== "{") return null;
    const end = objectEnd(text, i);
    if (end < 0) return null;
    out.push(text.slice(i, end + 1));
    i = end + 1;
  }
  return out;
}

/** Index of the brace closing the object that starts at `start`, or -1. */
function objectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return i;
  }
  return -1;
}

/**
 * Whether a reply *describes* tool calls as JSON (e.g. fenced blocks inside
 * prose) without making them. Such calls are never executed; the runtime
 * tells the model they did not run.
 */
export function describesToolCalls(content: string, toolNames: Set<string>): boolean {
  for (let i = content.indexOf("{"); i >= 0; i = content.indexOf("{", i + 1)) {
    const end = objectEnd(content, i);
    if (end > i && parseCall(content.slice(i, end + 1), toolNames)) return true;
  }
  return false;
}
