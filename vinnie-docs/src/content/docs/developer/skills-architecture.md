---
title: "Skills Architecture"
description: "How skills are stored, selected, and injected."
sidebar:
  order: 9
---
| Layer | File | Role |
| --- | --- | --- |
| Storage | `src-tauri/src/skills.rs` | Skill folders, validation, built-in install, references, import/export |
| Built-ins | `src-tauri/skills/<id>/` | Compiled into the binary with `include_str!` |
| Store | `src/state/skillStore.ts` | Skill list, session overrides, lazy instruction cache, activation |
| Selection | `src/skills/selection.ts` | Scoring by request and project; at most 3 |
| Validation | `src/skills/validation.ts` | Metadata, bundles, reference names |
| Prompt | `src/agent/runtime/systemPrompt.ts` | `buildSkillsSection`: framed as guidance, size-limited |
| Tool | `read_skill_reference` | Reads reference files of active skills |

## Flow per request

1. The chat store calls `skillStore.activate(request, projectMetadata)`.
2. Selection scores enabled skills; manual *on* skills are always included.
3. Instructions are read from disk once per skill version and cached.
4. The runtime receives `RunInput.skills`. They appear in the system prompt, in the task's `skills` field, as a
   timeline step, and as hints for tool selection.

Enabled flags live in the SQLite table `skill_settings`. Built-ins already installed are recorded under the key
`skills_builtins_installed`.
