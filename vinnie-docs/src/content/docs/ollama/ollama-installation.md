---
title: "Ollama Installation"
description: "Install Ollama and your first model."
sidebar:
  order: 1
---
Vinnie uses [Ollama](https://ollama.com) to run language models on your computer. Vinnie never downloads
models itself; you manage them with Ollama.

## Install Ollama

1. Download the Windows installer from [ollama.com/download](https://ollama.com/download) and run it.
2. Ollama installs per user (by default in `%LOCALAPPDATA%\Programs\Ollama`) and starts a tray app that runs
   the Ollama server in the background.
3. Check the installation in a terminal:

```powershell
ollama --version
```

## Pull a model

Models are downloaded with `ollama pull`. For agent work, choose a model with **tool support**:

```powershell
ollama pull qwen3:8b
```

List what you have:

```powershell
ollama list
```

See [Supported models](/ollama/supported-models/) for recommendations.

## Start the server

The Ollama tray app starts the server automatically. You can also:

- click **Launch Ollama** in Vinnie when it can't reach Ollama (see [Connecting Ollama](/ollama/connecting-ollama/)), or
- start it yourself in a terminal:

```powershell
ollama serve
```

By default the server listens on `http://localhost:11434`, which is also Vinnie's default endpoint.
