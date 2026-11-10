---
title: "Updating Vinnie"
description: "How to move to a newer version without losing data."
sidebar:
  order: 8
---
Vinnie has **no automatic updater** yet. To update, build the new version and run its installer over the
existing installation.

## Update steps

1. Close Vinnie.
2. Get the latest source and rebuild:

   ```powershell
   cd vinnie
   git pull
   pnpm install
   pnpm app:build
   ```

3. Run the new `src-tauri\target\release\bundle\nsis\Vinnie_<version>_x64-setup.exe`.

The installer replaces the program in `%LOCALAPPDATA%\Vinnie` and keeps your shortcuts.

## What happens to your data

Your data folder (`%APPDATA%\ai.vinnie.desktop`) isn't touched by the installer:

- **Database**: Vinnie upgrades the database schema automatically on first start, using forward-only
  migrations. Conversations, settings, change history, and MCP server settings are kept.
- **Skills**: built-in skills are installed only once; your edits are never overwritten. A built-in skill you
  deleted isn't reinstalled.
- **MCP secrets** stay in Windows Credential Manager.

:::caution
Database migrations only go forward. After a newer version has upgraded your database, an older version may
not be able to open it. Back up `%APPDATA%\ai.vinnie.desktop\vinnie.db` first if you might downgrade.
:::

## Check which version you have

**Settings → About & diagnostics** shows the Vinnie and Tauri versions. **Copy diagnostics** copies them, with
your Ollama status and data folders, for bug reports.
