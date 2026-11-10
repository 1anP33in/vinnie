---
title: "File Management"
description: "Browse, open, edit, create, and delete project files."
sidebar:
  order: 7
---
## Explorer

Open the Explorer with <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd>.

- Folders load as you expand them. Ignored folders are dimmed and not expanded automatically.
- With Git installed, files show **M** (modified) and **U** (untracked) markers.
- The toolbar has **New file**, **New folder**, **Refresh explorer**, and **Collapse folders**.
- Hover a file or folder to show its **Rename** and **Delete** buttons. Deleting asks for confirmation, and
  only files and empty folders can be deleted.

## Editor

Click a file to open it in an editor tab (Monaco, the editor from VS Code).

- <kbd>Ctrl</kbd>+<kbd>S</kbd> saves; <kbd>Ctrl</kbd>+<kbd>F</kbd> finds in the file.
- Files up to 2 MB open in the editor. Binary files aren't opened as text.
- If a file changes on disk while it's open (for example because Vinnie edited it), the editor notices within
  about 3 seconds or when the window gets focus, and lets you reload or compare before overwriting.
- Saving a file records it in the [change history](/user-guide/change-management/), so you can revert your own
  edits too. Saving without changes isn't recorded.

## Search

Open Search with <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd>.

| Option | Effect |
| --- | --- |
| Match case | Case-sensitive search |
| Use regular expression | Treat the query as a regular expression |
| Search file names instead of contents | Match paths instead of lines |
| File types to include | Limit to extensions, for example `lua` or `*.ts` |

Search respects `.gitignore` and the ignored folders, skips files larger than 1 MB, and stops after 15 seconds
or 2,000 results. Click a result to open the file at that line.

## How Vinnie changes files

When the agent creates, edits, moves, or deletes a file, it goes through the same backend as your own edits.
The change is checked against the project boundary, shown to you as a diff (unless *Change files* is
*Allowed*), snapshotted, and recorded. See [Reviewing code changes](/user-guide/reviewing-code-changes/).
