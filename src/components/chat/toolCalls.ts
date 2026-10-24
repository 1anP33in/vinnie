import type { ToolCall } from "@/lib/ipc/types";

export function argsOf(call: ToolCall): Record<string, unknown> {
  const raw = call.function?.arguments;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return raw ?? {};
}

/** Short human summary of a tool call, e.g. `read_file client/main.lua`. */
export function summarizeCall(call: ToolCall): string {
  const args = argsOf(call);
  const key = ["path", "query", "command", "from"].find((k) => typeof args[k] === "string");
  const detail = key ? String(args[key]) : Array.isArray(args.packages) ? args.packages.join(", ") : "";
  return detail ? `${call.function?.name} ${detail}` : (call.function?.name ?? "tool");
}
