---
title: "Selecting a Project"
description: "Choose the folder Vinnie works in."
sidebar:
  order: 3
---
Vinnie works in **one project folder at a time**. All file operations, searches, and commands are limited to
that folder.

## Choose a folder

1. In the sidebar, under **Project**, click **Choose folder…**. The toolbar also shows a project chip when a
   project is open.
2. Pick the folder in the Windows folder dialog.

The folder is remembered across restarts. To change it, choose another folder. To close it, use
**Forget project folder** next to the project name, or **Settings → Project folder**.

## What happens when you open a project

- The **Explorer** shows the folder's files, with ignored folders (such as `node_modules`) dimmed.
- Vinnie **analyzes the project** in the background. See [Project workspaces](/user-guide/project-workspaces/).
- Chat messages can include a short **project context**: a summary, the folder structure, and the file open in
  the editor, never the whole project. Turn this off under
  **Settings → Assistant permissions → Include project context**.

## Without a project

You can still chat, use MCP tools, and use skills. Project tools (reading, searching, editing files, and running
commands) need a project folder; if you ask for them without one, Vinnie says so.

## Why only one folder?

The project folder is the **security boundary**. The Rust backend resolves every path, following symlinks and
junctions, and refuses anything that ends up outside the folder. See
[File access restrictions](/security/file-access-restrictions/).
