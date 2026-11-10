---
title: "Tool Calling"
description: "Which tools exist, how they're offered, and how a call is executed."
sidebar:
  order: 4
---
## Built-in tools

| Tool | What it does | Category |
| --- | --- | --- |
| `get_project_structure` | Lists folders and files as a tree (depth 1–6, default 3) | Read |
| `search_files` | Searches contents (or file names), returns `path:line: text` | Search |
| `read_file` | Reads a text file with line numbers, at most 400 lines per call | Read |
| `create_file` | Creates a new file (fails if it exists) | Write |
| `write_file` | Replaces a file's content with complete new content | Write |
| `delete_file` | Deletes a file or empty folder (always asks) | Delete |
| `move_file` | Moves or renames, never overwriting | Write |
| `run_command` | Runs one development command under the command policy | Execute |
| `install_dependency` | Installs packages with the detected package manager | Dependency |
| `update_plan` | Creates or updates the visible plan | Agent |
| `remember` | Saves a fact in task memory | Agent |
| `get_project_info` | Returns the detected project facts | Agent |
| `read_skill_reference` | Reads a reference file of an active skill | Read |

[MCP tools](/mcp/discovering-tools/) appear alongside these as `<server>__<tool>`.

## Which tools the model sees

Not every tool is offered every time:

- **Ask mode**: read, search, and project tools only (plus read-only MCP tools).
- **Questions**: read, search, project, and command tools.
- **Tasks**: everything the mode allows.
- **No project open**: only `update_plan`, `remember`, `read_skill_reference`, and MCP tools.
- **Disabled** tools (in the [Tool Explorer](/mcp/discovering-tools/)) and tools whose MCP server is
  disconnected are never offered.
- At most **8 MCP tools** are offered per request, the ones most relevant to your words and the active skills.

## What happens to a call

1. **Known tool?** Unknown names are refused: *"Vinnie requested an unknown tool: … The operation was not executed."*
2. **Offered for this request?** Tools not offered (for example a write tool in Ask mode) are refused.
3. **Enabled and available?** Disabled tools and tools of disconnected servers are refused.
4. **Arguments valid?** Checked against the tool's schema (JSON that doesn't parse is refused).
5. **Not a repeat of a failing call?** See [Error recovery](/agent-system/error-recovery/).
6. **Authorized?** The [permission manager](/user-guide/permissions-and-approvals/) decides, asking you if needed.
7. **Execute** in the backend, with the project boundary and command policy enforced.
8. **Return a structured result**: success, outcome (succeeded, failed, denied, cancelled, timed out), a
   summary for the model, and a failure code with a recovery hint on errors.

Results sent back to the model are capped at 8,000 characters (12,000 for MCP tools); longer output is truncated
with a note.

## Example tool call

What the model sends:

```json
{ "function": { "name": "read_file", "arguments": { "path": "client/main.lua", "startLine": 1, "endLine": 40 } } }
```

What the model gets back:

```text
client/main.lua (lines 1-40 of 120)
1| local onDuty = false
2|
3| RegisterCommand('duty', function()
...
… 80 more lines (read with startLine=41).
```
