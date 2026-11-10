---
title: "Importing and Exporting Skills"
description: "Share skills as single JSON files."
sidebar:
  order: 6
---
**Export** (in a skill's editor) saves a `<id>.vinnie-skill.json` file with the metadata, instructions, and
reference files:

```json
{
  "format": "vinnie-skill",
  "version": 1,
  "skill": { "id": "duty-system", "name": "Duty System", "description": "…", "version": "1.0.0", "author": "Me", "tags": [], "match": { "keywords": [], "languages": [], "projectTypes": [] }, "tools": [] },
  "instructions": "When building duty systems…",
  "references": [{ "name": "natives.md", "content": "# Natives…" }]
}
```

**Import skill** opens such a file. Everything is validated before anything is written. If a skill with the same
id exists, Vinnie asks before replacing it. Treat imported instructions as untrusted: read them before relying
on the skill.
