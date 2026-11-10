---
title: "Connecting Ollama"
description: "Point Vinnie at your Ollama server and keep it connected."
sidebar:
  order: 2
---
## The endpoint

Vinnie connects to the endpoint in **Settings → Ollama connection → Endpoint**. The default is
`http://localhost:11434`. It must start with `http://` or `https://`; a trailing slash is removed.

Click **Test connection** to check an endpoint before saving. A successful test shows the Ollama version.

To use Ollama on another computer, enter its address, for example `http://192.168.1.20:11434`. That machine
must allow network connections (see Ollama's own documentation on `OLLAMA_HOST`). Your prompts and code are
then sent over your network to that machine.

## Connection status

The toolbar and the status bar show the connection:

| Status | Meaning |
| --- | --- |
| *Ollama 0.35.1* (toolbar) / *Connected · `http://localhost:11434`* (status bar) | Vinnie can reach Ollama and list models |
| Can't reach Ollama | Nothing answers at the endpoint |
| Disconnected | The last check failed; use **Retry** |

## Launch Ollama

When Vinnie can't reach Ollama, a **Launch Ollama** button (with the Ollama icon) appears on the welcome
screen, on the chat error banner, and in the status bar. It:

1. finds `ollama.exe` on your `PATH`, or in `%LOCALAPPDATA%\Programs\Ollama`;
2. starts `ollama serve` in the background, with no console window, bound to your endpoint's port;
3. checks every second for up to 30 seconds and reconnects as soon as Ollama answers.

The button only works for endpoints on **this computer** (`localhost`, `127.0.0.1`, `::1`, or `0.0.0.0`). For
other hosts Vinnie explains that it can't start a remote server. If Ollama isn't installed, it links to the
download page.

An Ollama server started this way keeps running after you close Vinnie, like one started by hand.

## Timeouts

| Request | Limit |
| --- | --- |
| Connection check | 5 seconds |
| Listing models | 15 seconds |
| First response of a chat (includes loading the model) | 5 minutes |
| Silence between streamed chunks | 2 minutes |

If a large model takes longer than that to load, the request fails with *"Ollama is taking too long"*; retry
once the model is loaded.
