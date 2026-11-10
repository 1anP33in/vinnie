---
title: "Reviewing Code Changes"
description: "Read diffs before approving and after the agent finishes."
sidebar:
  order: 10
---
## Before a change: the approval card

With **Change files** set to *Ask me* (the default), every file change the agent wants to make appears as an
approval card above the message box:

- **File**: the path, with added (+) and removed (−) line counts.
- **Reason**: one sentence from the model explaining why.
- **Risk**: whether it changes or deletes files. Both are reversible.
- **Diff**: an inline diff of the proposed content.

| Button | Effect |
| --- | --- |
| **Approve** | Apply this change |
| **Approve all for this task** | Apply this and the task's later file changes without asking (not offered for deletions) |
| **Deny** | Refuse; the model is told and must continue another way |
| **View changes** | Open the proposed diff in a full editor tab |

Deleting a file always asks, even when *Change files* is *Allowed*. A snapshot is kept, so a deleted file can
be restored from **Changes**.

## After a task: the outcome

When an agent task ends, the agent panel lists every changed file with **View** and **Revert file**, plus
**View changes**, **Revert task**, and **Accept changes**. The task report in the conversation lists the same
files and the verification checks.

## What to look for

- **Scope**: the agent is instructed to make the smallest change that fulfils the request. A diff that
  rewrites a whole file for a small fix deserves a second look.
- **Verification**: a passing `typecheck` or `test` is good evidence; *"Nothing could be verified
  automatically"* means you should test yourself.
- **Unfinished steps**: the report names plan steps that weren't marked done.
