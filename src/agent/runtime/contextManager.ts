// Context manager: assembles what the model sees for each step within the
// token budget. Priority order:
//   1. system prompt (rules, task memory, plan)  — always kept
//   2. the user's request                        — always kept
//   3. recent task turns                         — verbatim
//   4. older task turns                          — tool results compressed
//   5. earlier conversation                      — newest first, then a digest
// Compression only shortens message contents, so every tool result stays
// paired with the assistant call that requested it.

import type { ChatTurn } from "@/lib/ipc/types";
import { estimateMessages, estimateTokens, estimateTurnTokens, OUTPUT_RESERVE } from "./tokens";

export const RECENT_TASK_TURNS = 6;
const HISTORY_SHARE = 0.25;
const HISTORY_TURN_CHARS = 2_000;

export interface ContextInput {
  system: string;
  /** Conversation before this task (oldest first). */
  history: ChatTurn[];
  request: string;
  /** This task's assistant/tool turns so far (oldest first). */
  taskTurns: ChatTurn[];
  /** Context window in tokens. */
  budget: number;
}

export interface BuiltContext {
  messages: ChatTurn[];
  estimatedTokens: number;
  compressedToolResults: number;
  omittedHistory: number;
}

/** Shorten a tool result, keeping its first line (status) and a preview. */
export function compressToolResult(content: string, keepChars = 300): string {
  if (content.length <= keepChars + 40) return content;
  const firstLine = content.split("\n", 1)[0] ?? "";
  const rest = content.slice(firstLine.length, firstLine.length + keepChars).trim();
  return `${firstLine}\n${rest}\n… [compressed: ${content.length - firstLine.length - rest.length} more characters omitted; call the tool again if you need them]`;
}

function compressTurn(turn: ChatTurn, keepChars: number): ChatTurn {
  if (turn.role === "tool") return { ...turn, content: compressToolResult(turn.content, keepChars) };
  if (turn.role === "assistant" && turn.content.length > keepChars * 2) {
    return { ...turn, content: `${turn.content.slice(0, keepChars * 2)}… [shortened]` };
  }
  return turn;
}

function digest(omitted: ChatTurn[]): string {
  const asks = omitted
    .filter((t) => t.role === "user")
    .slice(-8)
    .map((t) => `- ${t.content.replace(/\s+/g, " ").slice(0, 120)}`);
  return `Earlier in this conversation (condensed to save space; ${omitted.length} messages omitted). The user previously asked:\n${asks.join("\n") || "- (no earlier requests)"}`;
}

export function buildContext(input: ContextInput): BuiltContext {
  const system: ChatTurn = { role: "system", content: input.system };
  const request: ChatTurn = { role: "user", content: input.request };
  const available = Math.max(512, input.budget - OUTPUT_RESERVE - estimateTurnTokens(system) - estimateTurnTokens(request));

  // Task turns: recent verbatim, older compressed; tighten until they fit.
  let compressed = 0;
  let task = input.taskTurns.slice();
  const recentStart = Math.max(0, task.length - RECENT_TASK_TURNS);
  const passes: { olderKeep: number; recentKeep: number }[] = [
    { olderKeep: Infinity, recentKeep: Infinity },
    { olderKeep: 300, recentKeep: Infinity },
    { olderKeep: 300, recentKeep: 4_000 },
    { olderKeep: 120, recentKeep: 1_500 },
    { olderKeep: 60, recentKeep: 600 },
  ];
  for (const pass of passes) {
    compressed = 0;
    task = input.taskTurns.map((t, i) => {
      const keep = i < recentStart ? pass.olderKeep : pass.recentKeep;
      if (!Number.isFinite(keep)) return t;
      const next = compressTurn(t, keep);
      if (next.content !== t.content) compressed++;
      return next;
    });
    if (estimateMessages(task) <= available * (1 - HISTORY_SHARE / 2)) break;
  }

  // Earlier conversation: newest first, within what's left.
  const historyBudget = Math.max(0, available - estimateMessages(task));
  const kept: ChatTurn[] = [];
  let used = 0;
  let cut = input.history.length;
  for (let i = input.history.length - 1; i >= 0; i--) {
    const t = input.history[i]!;
    const clipped =
      t.content.length > HISTORY_TURN_CHARS ? { ...t, content: `${t.content.slice(0, HISTORY_TURN_CHARS)}… [shortened]` } : t;
    const cost = estimateTurnTokens(clipped);
    if (used + cost > historyBudget) break;
    kept.unshift(clipped);
    used += cost;
    cut = i;
  }
  // Never start the kept history with orphaned tool results.
  while (kept.length && kept[0]!.role === "tool") {
    kept.shift();
    cut++;
  }
  const omitted = input.history.slice(0, cut);
  const messages: ChatTurn[] = [system];
  if (omitted.length) messages.push({ role: "system", content: digest(omitted) });
  messages.push(...kept, request, ...task);

  return {
    messages,
    estimatedTokens: estimateMessages(messages),
    compressedToolResults: compressed,
    omittedHistory: omitted.length,
  };
}

export { estimateTokens };
