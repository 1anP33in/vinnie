---
title: "Context Management"
description: "How Vinnie fits the conversation into the model's context window."
sidebar:
  order: 5
---
Local models have limited context windows. Vinnie manages the context so the most important information fits.

## The context budget

**Settings → Agent → Context budget**: Auto (default), 4K, 8K, 16K, or 32K tokens.

- **Auto** uses the model's own context length (from Ollama), capped at **16,384**, or 8,192 if Ollama doesn't
  report it.
- A fixed value is still capped at the model's maximum, and never goes below 2,048.
- Vinnie sends the budget to Ollama as `num_ctx`, so Ollama allocates a matching context.
- **1,536 tokens** are reserved for the model's answer.

Token counts are estimated at about 3.5 characters per token.

## What goes into each request

In order:

1. the **system prompt** (rules, mode, active skills, task memory, the plan, the remaining budget, and the
   project summary);
2. a short **digest of older conversation** if earlier messages don't fit;
3. **recent conversation history**, newest kept first;
4. **your request**;
5. this task's **tool calls and results**.

## Compression, step by step

When the task's own turns don't fit, Vinnie compresses in passes until they do:

1. Keep the **6 most recent** task turns verbatim; shorten **older tool results** to their first line plus a
   300-character preview.
2. Shorten older results further, then long recent results.
3. As a last resort, keep only short previews.

Compressed results say *"[compressed: N more characters omitted; call the tool again if you need them]"*, so the
model knows it can re-read. Each tool call stays paired with its result.

Older conversation messages are cut to 2,000 characters each. Messages that don't fit become a digest that
lists your earlier requests.

If the prompt Ollama actually processed comes close to the budget, Vinnie tightens its target for the next
iteration.

## Project context in chat

With **Include project context** on, the project section contains a short summary, a shallow folder tree, the
file open in the editor, and file names matching your message, never the whole project.
