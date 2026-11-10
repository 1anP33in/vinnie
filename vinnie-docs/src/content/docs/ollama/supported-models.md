---
title: "Supported Models"
description: "Which models work with Vinnie, and how well."
sidebar:
  order: 4
---
Vinnie works with **any model installed in Ollama**. Agent features need a model that supports **tool
calling** in Ollama.

## Tested models

| Model | Chat | Agent tasks | Notes |
| --- | --- | --- | --- |
| `qwen3:8b` | ✓ | ✓ **Recommended** | The most reliable model tested. It calls tools correctly and follows plans. It reasons before answering, so it's slower |
| `qwen2.5-coder:7b` | ✓ | Partial | Fast and good at code, but often writes tool calls as text. Vinnie recovers replies made only of tool calls and otherwise tells the model they didn't run. It may stop early; the task report then says nothing changed |

These are the models Vinnie has been tested with. Other tool-capable models may work well too.

## Checking a model's capabilities

Vinnie asks Ollama for each model's details (context length and capabilities) through Ollama's `/api/show`
endpoint. You can check a model yourself:

```powershell
ollama show qwen3:8b
```

Look for **tools** under *Capabilities*.

## Choosing a size

Larger models are usually better at multi-step tasks but need more memory and are slower. Start with an
8-billion-parameter model if your GPU has about 8 GB of memory; see [GPU acceleration](/ollama/gpu-acceleration/).

## Embedding and vision models

Vinnie doesn't use embedding models, and doesn't send images to models. Image content from
[MCP tools](/mcp/discovering-tools/) is replaced with a short placeholder.
