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

  // A single fenced block: ```json {...} ```
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) text = fenced[1]!.trim();
  if (!text.startsWith("{") || !text.endsWith("}")) return [];
  const call = parseCall(text, toolNames);
  return call ? [call] : [];
}
