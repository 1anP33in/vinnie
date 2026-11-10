---
title: "Your First Agent Task"
description: "Walk through a complete agent task, from request to verified result."
sidebar:
  order: 7
---
This walkthrough uses a small Node.js project, but the flow is the same for any language.

## 1. Ask for a change

With your project folder selected, type a request in the message box and press <kbd>Enter</kbd>:

```text
Add a /health endpoint to server.js that responds 200 with JSON {"status":"ok"}, and add a test for it in server.test.js.
```

Vinnie classifies this as a **task** (it asks for a change), so it plans before acting. A question such as
*"Which file handles routing?"* is answered directly without a plan.

## 2. Watch the agent panel

The **agent panel** appears above the message box. It shows:

- the live status, for example *"Vinnie is planning…"*, *"Vinnie is reading files…"*, or
  *"Vinnie is waiting for your permission…"*;
- the **plan**, with done, in-progress, and pending steps. Hover a step to edit or remove it;
- counters for steps, tool calls, files changed, retries, and verification;
- **Pause**, **Resume**, and **Stop** buttons.

## 3. Approve the change

With the default permissions, changing a file needs your approval. An approval card shows the file, the
diff, and the reason:

- **Approve**: apply this change.
- **Approve all for this task**: also apply this task's later file changes without asking.
- **Deny**: refuse; the agent is told and continues another way.
- **View changes**: open the proposed diff in the editor.

## 4. Verification

When the model says it's done, Vinnie checks the work itself. It confirms the files contain what was written
and runs your project's own `typecheck`, `lint`, `test`, or `build` scripts, whichever exist. If a check
fails, the failure goes back to the model for a bounded number of repair attempts.

## 5. Read the task report

Every task that used tools ends with a **Task report**. The application writes it, not the model, so it's
trustworthy:

```text
**Task report** ✓ Task completed. Changes made and verified.
Changes: 1 file changed (+5 −0): server.js
Verification: All 2 checks passed.
- ✓ server.js exists
- ✓ npm test
Steps: 7 model step(s), 6 tool call(s), 0 retries.
```

If the model skipped part of the request, the report says so, for example
*"Plan steps not marked done: Write test for /health"*.

## 6. Keep or revert

In the agent panel you can **View** or **Revert file** per file, **Revert task** to undo everything the task
changed, or **Accept changes** to hide the revert buttons. Changes are also listed in the **Changes** side
panel. See [Change management](/user-guide/change-management/).
