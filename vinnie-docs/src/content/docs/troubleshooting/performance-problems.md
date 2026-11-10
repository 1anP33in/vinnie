---
title: "Performance Problems"
description: "Make Vinnie and your models faster."
sidebar:
  order: 8
---
## Slow answers

Nearly always the model. In order of impact:

1. `ollama ps`: aim for `100% GPU`; otherwise use a smaller model or context budget.
2. Use a faster model for simple questions.
3. Keep the context budget at **Auto** or lower.

Details: [Performance optimization](/ollama/performance-optimization/).

## Long agent tasks

- Be specific about files and goals.
- Lower **Max iterations** / **Max tool calls** to cap long runs.
- Large projects: make sure folders like `node_modules` are in **Settings → Ignored folders**, so search and
  analysis skip them.

## The app feels sluggish

- Turn on **Settings → Appearance → Reduce visual effects**.
- Close editor tabs you don't need; the editor opens files up to 2 MB.
- The Activity feed and terminal keep recent history; clear the terminal with its clear button.

## Console windows flash while chatting

If Ollama was started by an older Vinnie version, it may open windows for every model load. Restart Ollama with
the current **Launch Ollama** button or the Ollama app. A few windows can still flash once when Ollama starts
(its GPU scan), with Ollama's own app too.
