---
title: "GPU Acceleration"
description: "How models use your GPU, and how to check it."
sidebar:
  order: 7
---
GPU use is handled entirely by **Ollama**; Vinnie has no GPU settings of its own. Ollama detects supported
GPUs automatically and loads as much of the model onto the GPU as fits.

## Check what's running where

While a model is loaded (for example right after a chat message):

```powershell
ollama ps
```

The **PROCESSOR** column shows whether the model runs on the GPU, the CPU, or split between them (for example
`100% GPU` or `48%/52% CPU/GPU`).

## When the model doesn't fit

If a model and its context don't fit in GPU memory, Ollama splits it between GPU and CPU, which is much slower.
To fit more on the GPU:

- choose a smaller model or a smaller quantization;
- lower **Settings → Agent → Context budget** (see [Context length](/ollama/context-length/));
- close other programs that use GPU memory.

## Ollama's start-up GPU scan

When the Ollama server starts, it scans your GPUs. On some Windows systems where Windows Terminal is the
default console, this briefly opens terminal windows. That's Ollama's own behavior and happens with Ollama's
tray app too. Starting Ollama from Vinnie's **Launch Ollama** button doesn't open windows for every model load.

For driver and hardware support, see Ollama's documentation.
