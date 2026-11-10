---
title: "Introduction"
description: "Start here: what these docs cover and how to find your way around."
sidebar:
  order: 1
---
Welcome to the official documentation for **Vinnie AI**, a local-first AI developer agent for Windows.

Vinnie runs as a desktop application. It talks to language models running on your own computer through
[Ollama](https://ollama.com), works inside a project folder you choose, and can extend itself with
[MCP servers](/mcp/introduction/) and [skills](/skills/introduction/).

## Who these docs are for

| You want to… | Start with |
| --- | --- |
| Install Vinnie and try it | [System requirements](/getting-started/system-requirements/), then [Installation](/getting-started/installation/) |
| Use Vinnie day to day | The [User Guide](/user-guide/dashboard-overview/) |
| Understand how the agent decides and acts | [Agent System](/agent-system/how-the-agent-works/) |
| Connect tools such as GitHub or a filesystem server | [MCP Integration](/mcp/introduction/) |
| Teach Vinnie how you like to work | [Skills](/skills/introduction/) |
| Build Vinnie or contribute | [Developer Documentation](/developer/architecture-overview/) |
| Understand what Vinnie can and can't touch | [Security](/security/permission-architecture/) |
| Fix a problem | [Troubleshooting](/troubleshooting/common-error-messages/) |

## How to read these docs

- **Search** is available on every page: press <kbd>Ctrl</kbd> <kbd>K</kbd> (or <kbd>⌘</kbd> <kbd>K</kbd> on macOS)
  or use the search field at the top.
- Each section in the sidebar is ordered from basics to details.
- Pages marked **Planned** describe features that are designed but not built yet. Everything else describes
  behavior that exists in Vinnie today.

## Version covered

These docs describe **Vinnie 0.1.0**, which includes the desktop foundation, project tools, the autonomous
agent engine, and MCP and skills support. See the [Changelog](/additional/changelog/) for what each milestone added
and the [Roadmap](/additional/roadmap/) for what comes next.

:::note
Vinnie currently runs on **Windows 10 and 11 (x64)** only.
:::
