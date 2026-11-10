---
title: "Performance Optimization"
description: "Get faster answers from local models."
sidebar:
  order: 9
---
Most of the time in a Vinnie task is spent in the model. These steps help, roughly from largest to smallest
effect.

## 1. Fit the model on your GPU

Check with `ollama ps`. A model split between CPU and GPU is several times slower. Use a smaller model or a
lower context budget until it shows `100% GPU`. See [GPU acceleration](/ollama/gpu-acceleration/).

## 2. Choose the right model

- `qwen2.5-coder:7b` answers quickly; `qwen3:8b` is slower because it reasons first, but is more reliable for
  agent tasks.
- For quick questions, a smaller model is often enough. Switch models in the toolbar at any time.

## 3. Keep the context budget sensible

Larger budgets cost memory and time per request. **Auto** (up to 16K) suits most work; use 4K or 8K on modest
hardware. Changing the budget between requests makes Ollama reload the model.

## 4. Keep the model loaded

Ollama unloads a model after a few minutes of inactivity (its default), and the next request waits for a
reload. Ollama's own `OLLAMA_KEEP_ALIVE` environment variable controls how long models stay loaded. See
Ollama's documentation.

## 5. Help the agent do less

- Ask for specific changes ("fix the null check in `server/main.lua`") rather than broad ones.
- Lower **Max iterations** or **Max tool calls** under **Settings → Agent** to keep tasks short.
- Turn off **Include project context** for chats that don't need the project.

## 6. Reduce visual effects

On slower machines, **Settings → Appearance → Reduce visual effects** turns off glow, frost, and animations.
