---
title: "Ollama Connection Errors"
description: "Messages you see when Vinnie can't use Ollama."
sidebar:
  order: 2
---
| Message | Meaning | Fix |
| --- | --- | --- |
| **Can't reach Ollama** — *Could not connect to Ollama at `http://localhost:11434`.* | Nothing answers at the endpoint | Click **Launch Ollama**, open the Ollama app, or run `ollama serve`; check **Settings → Ollama connection** |
| **Ollama is taking too long** — *Ollama at … did not respond in time.* | No answer within the timeout (5 minutes for the first chat response) | Usually a large model loading; wait and retry, or use a smaller model |
| **Unexpected response** | Something answered, but not like Ollama | Check the endpoint points to Ollama, not another web server |
| **Response interrupted** | The stream stopped partway | The partial response is kept; click **Retry** |
| *Ollama is not installed (ollama.exe was not found)…* | **Launch Ollama** couldn't find Ollama | Install from [ollama.com/download](https://ollama.com/download) |
| *The Ollama endpoint points to …, which is not this computer, so Vinnie can't start it.* | **Launch Ollama** only starts local servers | Start Ollama on that machine |
| *The Ollama endpoint must start with http:// or https://.* | Invalid endpoint in Settings | Enter a full URL such as `http://localhost:11434` |

Quick test outside Vinnie:

```powershell
curl http://localhost:11434/api/version
```

See also [Troubleshooting Ollama](/ollama/troubleshooting-ollama/).
