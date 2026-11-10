---
title: "Verification System"
description: "How Vinnie checks changes independently of the model."
sidebar:
  order: 7
---
The model can't declare its own success. When it finishes a task that changed files, and
**Settings → Agent → Verify changes automatically** is on (the default), Vinnie runs its own checks.

## Checks

1. **File checks**: every changed file exists and contains exactly what was written. Deleted files are really
   gone, and moves land at the new path.
2. **JSON and config checks**: changed `.json` files must parse; `.jsonc` and `tsconfig`/`jsconfig` files
   are parsed with comments removed.
3. **FiveM manifest check**: when Lua or manifest files changed, every file referenced in `fxmanifest.lua`
   or `__resource.lua` must exist. The check notes that it doesn't test the resource in-game.
4. **Project commands**, when code changed, chosen from what the project defines:

| Project | Commands |
| --- | --- |
| Node.js | The `package.json` scripts `typecheck`, `lint`, `test`, and `build`, in that order, at most 3. `build` runs only if nothing lighter exists; npm's placeholder `test` script is skipped |
| Rust | `cargo check` |
| Go | `go build ./...` |
| .NET | `dotnet build` |
| Python with pytest | `python -m pytest -q` |

Commands run through the normal [command policy](/security/command-execution-security/). If a check command
needs approval and you deny it, that check is **skipped**, not failed.

## Results

The agent panel and the task report list every check with ✓ (passed), ✗ (failed, with the first line of
the error), or – (skipped). The summary is one of:

- *All N checks passed.*
- *N of M checks failed: …*
- *Nothing could be verified automatically.*

## When verification fails

Vinnie sends the failures back to the model to repair, up to **Max retries** times (default 2). If checks still
fail, the task ends as **failed**, whatever the model claims.

## Turning it off

With *Verify changes automatically* off, the report says *"Changes made (automatic verification is turned off)."*
