---
title: "Skill Folder Structure"
description: "How a skill is stored on disk."
sidebar:
  order: 4
---
Each skill is a folder in `%APPDATA%\ai.vinnie.desktop\skills\`:

```text
skills/
└── duty-system/
    ├── skill.json         metadata
    ├── instructions.md    instructions (loaded only when the skill is used)
    └── references/        optional text files, at most 20, each up to 200 KB
        └── natives.md
```

Reference file names must be plain names with a text extension (`.md`, `.txt`, `.json`, `.lua`, `.js`, `.ts`,
`.tsx`, `.py`, `.cs`, `.sql`, `.yaml`, `.yml`, `.toml`, `.html`, `.css`, `.xml`, `.ini`, `.cfg`). Folder ids and
file names are validated before any path is built, so a skill can't reach outside its folder.

A folder whose `skill.json` is invalid, whose `id` doesn't match the folder name, or that has no
`instructions.md` is listed in the Skills manager with the error and is never used.
