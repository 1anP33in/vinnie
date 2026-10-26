// Token estimation and budgets. Local models have small context windows, so
// the runtime estimates prompt size before sending and asks Ollama for an
// explicit context size (num_ctx) that the model actually supports.

import type { ChatTurn } from "@/lib/ipc/types";

/** Rough token estimate (code and prose average ~3.5 characters per token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

export function estimateTurnTokens(turn: ChatTurn): number {
  const calls = turn.tool_calls ? JSON.stringify(turn.tool_calls) : "";
  return estimateTokens(turn.content) + estimateTokens(calls) + 4;
}

export function estimateMessages(turns: ChatTurn[]): number {
  return turns.reduce((n, t) => n + estimateTurnTokens(t), 0);
}

/** Tokens reserved for the model's answer. */
export const OUTPUT_RESERVE = 1_536;
const AUTO_DEFAULT = 8_192;
const AUTO_MAX = 16_384;

/**
 * Context window to request. `configured` is the user setting (0 = auto);
 * `modelMax` is what the model reports, if known. Never exceeds the model.
 */
export function resolveContextBudget(configured: number, modelMax: number | null): number {
  const wanted = configured > 0 ? configured : Math.min(modelMax ?? AUTO_DEFAULT, AUTO_MAX);
  const capped = modelMax ? Math.min(wanted, modelMax) : wanted;
  return Math.max(2_048, capped);
}
