---
title: "Ollama Provider"
description: "How the frontend and backend talk to Ollama."
sidebar:
  order: 5
---
## Frontend: `AIProvider`

`src/providers/types.ts` defines the provider interface; `ollamaProvider.ts` implements it:

| Method | Backend command | Ollama endpoint |
| --- | --- | --- |
| `checkConnection(endpoint?)` | `check_connection` | `GET /api/version` |
| `listModels(endpoint?)` | `list_models` | `GET /api/tags` |
| `streamChat(request, onEvent)` | `chat_stream` (+ `cancel_generation`) | `POST /api/chat` (streaming) |
| `modelDetails(model)` | `model_details` | `POST /api/show` |

`streamChat` returns a handle with `result` (a promise of the outcome: content, reasoning, tool calls, stats)
and `cancel()`. Stream events (`started`, `content`, `thinking`) arrive over a Tauri channel.

## Backend: `src-tauri/src/ollama/`

- `client.rs`: HTTP client (reqwest) with timeouts. It decodes the NDJSON stream, collects tool calls, and
  maps errors to error kinds: unreachable, timeout, model not found, tools unsupported, malformed (including
  Ollama's tool-call parse errors), interrupted.
- `launcher.rs`: **Launch Ollama**. It finds `ollama.exe` and starts `ollama serve` with `OLLAMA_HOST` set to the
  endpoint's port, a hidden console, its own process group, and (when allowed) outside Vinnie's job object.
- Requests include `options.num_ctx` when a context budget is set.

Generations are cancellable by id through the generation registry (`generation.rs`).
