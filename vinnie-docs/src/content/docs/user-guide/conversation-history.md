---
title: "Conversation History"
description: "Find, rename, and delete past conversations."
sidebar:
  order: 12
---
Every conversation is saved automatically in Vinnie's local database.

## Browsing

Open **Conversations** from the activity rail. Conversations are grouped by date: Today, Yesterday,
Previous 7 days, Previous 30 days, and then by month. Click one to open it. <kbd>Ctrl</kbd>+<kbd>N</kbd> or **New conversation** starts a
new one.

New conversations get a title from your first message. Hover a conversation to **Rename** or **Delete** it.
Deleting asks for confirmation.

## Searching

Use **Search conversations** at the top of the panel. It matches conversation titles and message text.

## What's stored

Each message is saved with its role (you, assistant, or tool), content, the model's reasoning when shown,
status (complete, interrupted, or error), and the model used. Agent tool calls and tool results are saved
too, so reopening a conversation shows the full exchange. Task reports are saved as assistant messages.

Changes to files are stored separately in the change history, so deleting a conversation doesn't remove
change history.

## Startup behavior

**Settings → Startup** decides what you see when Vinnie starts: a new conversation (default) or the last
conversation you had open.

## Deleting everything

**Settings → Conversations → Delete all conversations** removes every conversation after confirmation. The
database lives at `%APPDATA%\ai.vinnie.desktop\vinnie.db`.
