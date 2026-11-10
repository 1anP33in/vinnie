---
title: "First-Time Setup"
description: "Connect Ollama, pick a model, and choose a project folder."
sidebar:
  order: 6
---
The first time you open Vinnie, it starts on the welcome screen and tries to connect to Ollama at
`http://localhost:11434`.

## 1. Connect to Ollama

The connection status appears in the toolbar (top right) and in the status bar (bottom).

- **Connected**: the toolbar shows the Ollama version, and the model menu lists your installed models.
- **Can't reach Ollama**: the welcome screen and the status bar show a **Launch Ollama** button with the
  Ollama icon. Click it to start `ollama serve` in the background. Vinnie reconnects as soon as Ollama
  answers, usually within about 15 seconds.

If Ollama runs on another computer or port, open **Settings → Ollama connection**, change **Endpoint**, and
click **Test connection**. See [Connecting Ollama](/ollama/connecting-ollama/).

## 2. Choose a model

Open the model menu in the toolbar and pick a model. To use the same model every time, set
**Settings → Models → Default model**.

For agent work, choose a model with **tool support**. `qwen3:8b` is the most reliable model tested with
Vinnie. See [Model selection](/ollama/model-selection/).

## 3. Choose a project folder

In the sidebar, under **Project**, click **Choose folder…** and pick your project. Vinnie analyzes it in the
background (project types, languages, package managers) and can then search, read, and edit files there.
Vinnie never reads or changes files outside this folder.

## 4. Review permissions

Open **Settings → Assistant permissions**. The defaults are:

| Permission | Default |
| --- | --- |
| Read files | Allowed |
| Change files | Ask me |
| Run commands | Ask me |
| Install dependencies | Ask me |

You can keep these while you get to know Vinnie. See [Permissions and approvals](/user-guide/permissions-and-approvals/).

## 5. Pick an agent mode

**Settings → Agent → Mode** is **Agent** by default. Choose **Ask** if you only want answers, or **Assist** if
you want to approve every step. See [Agent modes](/user-guide/agent-modes/).

You're ready for [your first agent task](/getting-started/your-first-agent-task/).
