---
title: "Permission System"
description: "How permission decisions are made in code."
sidebar:
  order: 7
---
Two layers enforce permissions.

## Frontend: `PermissionManager`

`src/agent/runtime/permissionManager.ts`. `authorize({ request, capability, mode, permissions, taskId, workspace, prompt })`
returns `{ approved, prompted, scope?, reason? }`:

1. **Ask mode** refuses everything except reads (and read-only MCP tools).
2. A level of **denied** refuses.
3. Deletes, secret-file reads, destructive MCP tools, and everything in **Assist** mode always prompt.
4. A level of **allowed** approves.
5. A matching **grant** (task or session) approves.
6. Otherwise it **prompts** the user. *Task* and *session* answers are stored as grants (never for deletes, secret
   reads, or destructive tools).

Capabilities: `read`, `write`, `delete`, `execute`, `install`, `external` (MCP; its level comes from the tool's
policy). Grants are cleared when a task ends (`endTask`) or the session ends.

## Backend

`src-tauri/src/permissions.rs` checks the settings level again for every assistant action. A gated operation
needs an explicit `approved` flag that only the approval flow sets. `is_sensitive_path` identifies secret-looking
files. The **workspace boundary** (`workspace/`) and the **command policy** (`process/policy.rs`) are enforced
independently of both.
