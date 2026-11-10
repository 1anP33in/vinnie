---
title: "Troubleshooting Ollama"
description: "Fix the most common Ollama problems."
sidebar:
  order: 8
---
## Vinnie can't reach Ollama

1. Click **Launch Ollama**, or start the Ollama app or `ollama serve` yourself.
2. Check the endpoint under **Settings → Ollama connection** and click **Test connection**.
3. Test the endpoint outside Vinnie:

```powershell
curl http://localhost:11434/api/version
```

A JSON answer such as `{"version":"0.35.1"}` means Ollama is running; check Vinnie's endpoint for typos.

## "Ollama is not installed (ollama.exe was not found)"

The Launch button couldn't find Ollama on your `PATH` or in `%LOCALAPPDATA%\Programs\Ollama`. Install it from
[ollama.com/download](https://ollama.com/download), or add its folder to `PATH`.

## "Model not installed"

The selected model isn't in Ollama. Pull it, then refresh the model list:

```powershell
ollama pull qwen3:8b
```

## "Ollama is taking too long"

The model is probably still loading. Large models can take minutes the first time. Wait and retry, or use a
smaller model.

## "This model can't use tools"

The model doesn't support tool calling, so Vinnie answered without project tools. Choose a tool-capable model.
See [Supported models](/ollama/supported-models/).

## Answers are very slow

See [Performance optimization](/ollama/performance-optimization/) and check `ollama ps` (see
[GPU acceleration](/ollama/gpu-acceleration/)).

More error messages are explained in [Ollama connection errors](/troubleshooting/ollama-connection-errors/) and
[Model loading issues](/troubleshooting/model-loading-issues/).
