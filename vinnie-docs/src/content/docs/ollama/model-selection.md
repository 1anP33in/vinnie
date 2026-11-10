---
title: "Model Selection"
description: "Choose which model Vinnie uses."
sidebar:
  order: 3
---
## Choosing a model

Use the **model menu** in the toolbar. It lists the models installed in Ollama with their size, for example
`qwen3:8b · 8.2B · 4.9 GB`. The refresh button next to it reloads the list after you pull a new model.

The selected model is used for the next message and for agent tasks.

## Default model

**Settings → Models → Default model** chooses the model selected when Vinnie starts. It must be installed in
Ollama; if it's missing, Settings warns you.

## Choosing for the job

| Job | What matters |
| --- | --- |
| Questions and explanations | Any chat model |
| Agent tasks (editing, running commands) | **Tool support** and reliable tool calling |
| Large projects or long tasks | A larger context length (see [Context length](/ollama/context-length/)) |
| Slow hardware | Smaller models; see [Performance optimization](/ollama/performance-optimization/) |

## Models without tool support

If the model doesn't support tools, Ollama refuses tool requests. Vinnie then continues **without tools** and
shows: *"&lt;model&gt; doesn't support tools, so Vinnie answered without project tools."* Pick a model with tool
support to let Vinnie search and edit your project.
