---
title: "What is Vinnie?"
description: "Vinnie is a desktop AI agent that works in your projects using local models."
sidebar:
  order: 2
---
Vinnie is a desktop application that pairs a chat interface with an **autonomous development agent**. You
describe what you want, such as *"add a /health endpoint and a test for it"*, and Vinnie inspects your
project, makes a plan, edits files, runs your project's commands, and checks the result.

## Local by design

- **Models run on your computer.** Vinnie uses [Ollama](https://ollama.com) as its model provider. Your
  prompts and code go to the Ollama server you configure, normally `http://localhost:11434` on the same machine.
- **Your data stays local.** Conversations, settings, and change history are stored in a SQLite database in
  your user profile. See [Privacy and local processing](/security/privacy-and-local-processing/).
- The only network traffic Vinnie makes on its own goes to your Ollama endpoint. MCP servers you add may
  contact other services. That's your choice, per server.

## The model proposes, Vinnie decides

The language model is treated as **untrusted**. It can only *request* actions by calling tools. The
application then:

1. validates the request,
2. checks your [permissions](/user-guide/permissions-and-approvals/) and asks you when needed,
3. performs the action in the Rust backend, which enforces the project boundary and the command policy,
4. records the result, and
5. after changes, [verifies](/agent-system/verification-system/) them independently.

The model can't approve its own actions, can't run shell syntax, and can't read or write outside the
project folder.

## What Vinnie is not

- It isn't a cloud service and needs no account or API key.
- It doesn't control your computer outside the project folder and the commands you allow.
- It doesn't hide failures: every agent task that used tools ends with a **task report** written by the
  application, not the model.

## Main parts of the app

| Part | What it does |
| --- | --- |
| Chat | Streaming conversations with local models |
| Agent | Plans and carries out tasks; see [Agent modes](/user-guide/agent-modes/) |
| Workspace | Explorer, editor, search, terminal, and change history for your project |
| Integrations | [MCP servers](/mcp/introduction/), [skills](/skills/introduction/), and the [Tool Explorer](/mcp/discovering-tools/) |
| Status | Activity feed, task timeline, and the [ice dragon](/dragon/introduction/) status indicator |
