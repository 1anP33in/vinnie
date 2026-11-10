---
title: "MCP Security"
description: "How Vinnie contains untrusted MCP servers."
sidebar:
  order: 4
---
MCP servers are separate programs or web services. Vinnie treats them as **untrusted**.

## Tool trust

- Each tool's permission category is decided by Vinnie from the tool name. A server's annotations can only raise
  it. Unknown tools are treated as external actions. See [MCP permissions](/mcp/mcp-permissions/).
- Every call is authorized by the permission manager; destructive tools always ask with explicit confirmation.
- Arguments are validated against the tool's schema before you're asked.
- Tool descriptions are cleaned of control and invisible characters and length-limited; tools with invalid schemas
  are rejected.
- Results are capped (12,000 characters) and labeled as external data, not instructions.
- A server's `instructions` field is ignored. Servers and skills can't change Vinnie's system prompt rules,
  permissions, or approvals.

## Local (stdio) servers

- Only the stored command runs. It's never built from model output, and no shell is used.
- Environment: Windows basics plus the server's own variables and secrets, nothing else from Vinnie's environment.
- No console window; each server sits in a kill-on-close job object, so it dies with Vinnie.
- Messages over 8 MB are dropped.

## Remote (HTTP) servers

- HTTPS required (plain HTTP only for localhost); no credentials in URLs.
- Requests only to the configured origin; redirects not followed.
- The webview can't set Authorization or cookies; only stored headers and secrets are used.
- Responses capped at 16 MB.

## Your responsibility

An MCP server can do whatever its own code does with the access you give it, for example a filesystem server
with the folders you pass, or an API token's permissions. Give servers the **narrowest** folders and token scopes
they need, and only install servers you trust.
