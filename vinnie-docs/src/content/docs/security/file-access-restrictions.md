---
title: "File Access Restrictions"
description: "How the project boundary is enforced."
sidebar:
  order: 2
---
All file access by Vinnie, whether by you in the editor or by the agent, goes through the Rust workspace module,
which enforces the **project boundary**.

## Path rules

Paths are relative to the project root. The backend rejects:

- absolute paths and drive letters (`C:\…`, `\\server\share`);
- `..` segments (parent-folder references);
- NTFS alternate data streams (`file.txt:stream`);
- reserved device names (`CON`, `NUL`, `COM1`, …);
- paths longer than 1,024 characters.

Paths are then **resolved to their real location**, following symlinks and junctions, and refused if the real
location is outside the project. A junction inside the project that points elsewhere can't be used to escape.

## Size limits

| Operation | Limit |
| --- | --- |
| Reading text files | 2 MB |
| Writing a file | 5 MB |
| Directory listing | 5,000 entries |
| Search | Files up to 1 MB, 15 seconds, 2,000 results |
| Change snapshots | Files up to 10 MB |

## Secret-looking files

Reading `.env` and `.env.*` (except examples and templates), `*.pem`, `*.key`, `*.pfx`, `*.p12`, `id_rsa`,
`id_ed25519`, `.npmrc`, `.pypirc`, `credentials.json`, `secrets.json`, or `server.cfg` always asks first,
because the contents would be sent to the model.

## Deletion

Only files and empty folders can be deleted, deleting always asks, and a snapshot is kept so the file can be
restored from **Changes**.
