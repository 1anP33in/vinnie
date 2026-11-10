---
title: "Security Best Practices"
description: "Recommendations for using Vinnie safely."
sidebar:
  order: 7
---
1. **Start conservative.** Keep the defaults (*Change files*, *Run commands*, and *Install dependencies* set to
   *Ask me*) until you know how Vinnie behaves on your projects.
2. **Use Ask mode** to explore unfamiliar code, and **Assist mode** for sensitive repositories.
3. **Read diffs** before approving, and use **View changes** for larger edits.
4. **Prefer task-scoped approvals** over session or *Always allow*. Review always-allowed commands under
   **Settings → Assistant permissions**.
5. **Commit before big tasks** (Vinnie's change history isn't a replacement for Git), and use **Revert task**
   when a result isn't right.
6. **Treat repository content as untrusted.** A file or MCP result may contain text written to manipulate the
   model; Vinnie's permission checks still apply, so read approval cards carefully.
7. **Give MCP servers the least access**: specific folders, read-only tokens where possible, and *Never allow*
   for tools you don't need. Disable tools you don't use in the Tool Explorer.
8. **Don't paste secrets into chat.** Conversations are stored in the local database and sent to the model.
9. **Keep Ollama local** unless you trust the network and machine it runs on.
10. **Keep Vinnie, Ollama, and MCP servers updated.**
