---
title: "Model Loading Issues"
description: "Fix missing, slow, or failing models."
sidebar:
  order: 3
---
## "Model not installed"

```powershell
ollama pull qwen3:8b
```

Then click the refresh button next to the model menu. If **Settings → Models → Default model** names a model you
removed, pick another one.

## The first answer takes a long time

Ollama loads the model into memory on the first request, and again after it unloads an idle model. Large
models can take a minute or more. Vinnie waits up to 5 minutes for the first response.

## Answers get slower after changing the context budget

A larger [context budget](/ollama/context-length/) needs more memory and may push part of the model onto the
CPU. Check with `ollama ps` and lower the budget (or choose **Auto**).

## "This model can't use tools"

The model doesn't support tool calling, so Vinnie answered without tools. Use a model with tool support, such as
`qwen3:8b`. See [Supported models](/ollama/supported-models/).

## The model ignores tools or writes tool calls as text

Some models (for example `qwen2.5-coder:7b`) often write tool calls as text. Vinnie recovers replies made only of
tool calls and tells the model when calls in prose didn't run, but results vary. Use `qwen3:8b` for agent tasks.

## Out-of-memory errors from Ollama

Ollama reports these as an error message in the chat ("Ollama reported an error"). Use a smaller model or context
budget, or close other GPU-heavy programs.
