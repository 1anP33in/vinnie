---
title: "Context Length"
description: "Choose a context budget that fits your model and hardware."
sidebar:
  order: 6
---
The **context length** is how much text, measured in tokens, the model can consider at once: the system
prompt, conversation, request, and tool results.

## Setting it

**Settings → Agent → Context budget**:

| Option | Tokens | Good for |
| --- | --- | --- |
| **Auto** (default) | The model's maximum, capped at 16,384 (8,192 if unknown) | Most setups |
| 4K | 4,096 | Low memory, short tasks |
| 8K | 8,192 | Small projects |
| 16K | 16,384 | Typical agent tasks |
| 32K | 32,768 | Long tasks, if your hardware allows |

A fixed value is never higher than the model's own maximum.

## Memory cost

Ollama allocates memory for the whole context window when it loads the model. A larger budget means:

- more GPU or system memory used;
- possibly fewer model layers on the GPU, so slower answers;
- a model **reload** if the value changes between requests.

If answers get slow after raising the budget, go back to Auto or 8K.

## How Vinnie uses the budget

Vinnie reserves 1,536 tokens for the answer and fits the rest with compression. See
[Context management](/agent-system/context-management/). In the [task debug view](/user-guide/task-planning/#the-debug-view)
you can see the peak prompt size compared with the budget.
