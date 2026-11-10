---
title: "Skill Configuration"
description: "The skill.json format and how selection uses it."
sidebar:
  order: 5
---
`skill.json`:

```json
{
  "id": "duty-system",
  "name": "Duty System",
  "description": "Helps build FiveM duty systems.",
  "version": "1.0.0",
  "author": "Me",
  "tags": ["fivem", "duty"],
  "match": {
    "keywords": ["duty", "on duty", "shift"],
    "languages": ["Lua"],
    "projectTypes": ["FiveM"]
  },
  "tools": ["database.*"]
}
```

## How selection scores a skill

| Evidence | Points |
| --- | --- |
| The request mentions a keyword or tag (simple plurals count) | +3 each |
| The request contains a word from the skill name | +2 |
| The project uses a listed language (top 4 languages) | +2 |
| The project type contains a listed project type | +2 |
| A FiveM manifest is present and the skill is tagged `fivem` | +2 |

Skills scoring at least 3 are chosen, best first, up to 3 in total. Skills you turned **on** for the session
always count; skills turned **off** never do. Disabled skills and skills with errors are skipped.

In the prompt, each skill's instructions are limited to 2,400 characters, and all skills together to 6,000.
