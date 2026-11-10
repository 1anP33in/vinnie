---
title: "Managing MCP Servers"
description: "Connect, disconnect, edit, export, and monitor servers."
sidebar:
  order: 6
---
The **MCP servers** screen lists your servers on the left. Each shows its name, status, number of tools, and
whether it's local or remote. Click a server to see its details.

## Status

| Status | Meaning |
| --- | --- |
| **CONNECTED** | Initialized; its tools are available |
| **CONNECTING** | Starting or handshaking |
| **DISCONNECTED** | Not connected (you disconnected it, or it doesn't connect automatically) |
| **ERROR** | Connecting failed or the connection was lost; the error is shown |
| **DISABLED** | Turned off; it won't connect, and its tools can't run |

## Actions

| Action | Effect |
| --- | --- |
| **Connect** / **Disconnect** | Start or end the connection (stdio servers are stopped on disconnect) |
| **Restart** | Disconnect and connect again |
| **Test connection** | Connect if needed and check that the server answers |
| **Refresh tools** | Ask the server for its tool list again |
| **Enabled** switch | Disable to stop the server and block its tools |
| **Edit** | Change settings; a connected server restarts if its launch settings or secrets change |
| **Remove** | Disconnect, delete the configuration, and delete its secrets from Credential Manager |

## Details

The details view shows the transport, command or URL, the names of stored secrets, the server's reported name and
version, when it last connected and last answered, the failure count, the default tool approval, the tool list,
any **rejected tools** with the reason, and the **logs**.

## Health monitoring

- Every 30 seconds Vinnie pings each connected server.
- If a connected server stops answering or its connection drops, its tools are marked unavailable and refused,
  and Vinnie reconnects automatically up to **3 times** (after 2, 5, and 15 seconds).
- If the very first connection fails (for example wrong credentials), Vinnie reports the error without retrying.
- A server you disconnected yourself isn't reconnected.

## Import and export

**Export** saves all server configurations to a JSON file **without secret values**; secret names are listed
under `requiredSecrets`. **Import** reads such a file. Each server is validated on its own: invalid ones are
skipped with an explanation, servers whose ID already exists are skipped, and imported servers start
**disabled**, so nothing runs until you review them. A server that needs secrets opens in the editor so you can
enter them.

## Where settings are stored

Configurations are stored in Vinnie's database; secrets are in Windows Credential Manager as
`Vinnie/mcp/<server-id>/<env:NAME|header:Name>`.
