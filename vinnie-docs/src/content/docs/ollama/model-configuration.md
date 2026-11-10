---
title: "Model Configuration"
description: "What Vinnie sends to Ollama, and what stays in Ollama."
sidebar:
  order: 5
---
Vinnie keeps model configuration deliberately small.

## What Vinnie controls

| Setting | Where | Effect |
| --- | --- | --- |
| Model | Toolbar model menu, **Settings → Models → Default model** | Which model handles the request |
| Context length (`num_ctx`) | **Settings → Agent → Context budget** | The context window Ollama allocates; see [Context length](/ollama/context-length/) |
| Tools | Automatic | The tools offered for this request, in Ollama's function-calling format |

Each chat request goes to Ollama's `/api/chat` endpoint as a stream, with the model, the messages, the tool
definitions, and `options.num_ctx`.

## What stays in Ollama

Sampling settings such as temperature aren't set by Vinnie. Ollama's defaults (or a model's own `Modelfile`)
apply. To customize a model, create a variant with Ollama and select it in Vinnie:

```text
# Modelfile
FROM qwen3:8b
PARAMETER temperature 0.2
```

```powershell
ollama create qwen3-precise -f Modelfile
```

`qwen3-precise` then appears in Vinnie's model menu after you refresh the list.

## Reasoning output

For models that produce reasoning (such as `qwen3`), Vinnie shows it in a collapsible panel. Hide it under
**Settings → Appearance → Show model reasoning**. The setting only changes the display.
