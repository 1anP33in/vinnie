---
title: "FAQ"
description: "Frequently asked questions about Vinnie."
sidebar:
  order: 1
---
## Does Vinnie send my code to the cloud?

No. Models run in Ollama, normally on your computer. Vinnie has no telemetry or account. Data only leaves your
computer if you point Vinnie at a remote Ollama server or connect remote MCP servers. See
[Privacy](/security/privacy-and-local-processing/).

## Does Vinnie work on macOS or Linux?

Not currently. Vinnie 0.1.0 targets Windows 10 and 11 (x64).

## Which model should I use?

`qwen3:8b` for agent tasks. See [Supported models](/ollama/supported-models/).

## Can Vinnie break my project?

Changes follow your permissions (by default every change asks first), each change is snapshotted, and
**Revert task** undoes a whole task. Destructive commands are blocked. Changes made through MCP tools happen
outside Vinnie and can't be reverted by it. Use Git for important work.

## Why did Vinnie say it can't use tools?

Either the model doesn't support tool calling, no project folder is open (for project tools), or tools are turned
off under **Settings → Assistant permissions → Let Vinnie use project tools**.

## What's the difference between Ask, Assist, and Agent?

Ask is read-only, Assist asks before every action, and Agent works within your permission rules. See
[Agent modes](/user-guide/agent-modes/).

## Is there a "Full Auto" mode?

It's shown as *coming later* in Settings and isn't implemented.

## Can I use OpenAI or Anthropic models?

No. Vinnie's model provider is Ollama. The provider is an interface in the code, but only Ollama is implemented.

## Where's the 3D dragon?

Planned. Today the dragon is the status indicator. See [Ice dragon companion](/dragon/introduction/).

## Where are my settings and conversations?

`%APPDATA%\ai.vinnie.desktop\vinnie.db`. See [Database and persistence](/developer/database-and-persistence/).
