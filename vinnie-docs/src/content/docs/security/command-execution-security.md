---
title: "Command Execution Security"
description: "The command policy in detail."
sidebar:
  order: 3
---
Every command, typed by you in the terminal or requested by the agent, is checked by
`src-tauri/src/process/policy.rs`.

## Parsing

- One command per line, at most 2,000 characters, no control characters.
- **Shell operators are refused**: `&`, `|`, `<`, `>`, `^`, `%`, `` ` ``, `;`, `$`. No pipes, redirects,
  chaining, or variables.
- Arguments are split with simple quoting and passed directly to the program. **No shell is involved.**

## Blocked programs (never run)

File and disk destruction (`rm`, `rmdir`, `rd`, `del`, `erase`, `format`, `diskpart`, `fdisk`, `mkfs`, `dd`,
`sdelete`, `cipher`, `vssadmin`, `wbadmin`, `chkdsk`, `defrag`), system control (`shutdown`, `bcdedit`, `reg`,
`regedit`, `regsvr32`, `rundll32`, `mshta`, `takeown`, `icacls`, `attrib`, `net`, `netsh`, `sc`, `schtasks`,
`taskkill`, `wmic`, `bitsadmin`, `certutil`, `runas`, `setx`, …), and **shells** (`cmd`, `powershell`,
`pwsh`, `bash`, `sh`, `zsh`, `wsl`, `wscript`, `cscript`, `start`), which would bypass the policy.
`git clean` is blocked too. Drive-relative program paths (`C:tool.exe`) are blocked.

## Low risk (run directly)

Version checks of known tools, `npm`/`pnpm`/`yarn`/`bun` `test` and `run build|test|lint|typecheck|check`,
dependency listings, `cargo build|check|test|clippy`, `cargo fmt --check`, `dotnet build|test`,
`go build|test|vet`, `python -m pytest`, `pytest`, read-only `git` (`status`, `diff`, `log`, `show`, `blame`,
`branch`, `remote -v`), `tsc --noEmit`, `eslint` without `--fix`, and `prettier --check`.

## Needs approval

Everything else, including installs (`npm install`, `pip install`, `cargo add`, …), `npx`, state-changing Git
commands, running Python code, and unknown programs.

## Execution

- Programs are resolved on `PATH`, **never from the project folder**, and the resolved executable is checked
  against the blocked list again.
- No console window; stdin closed; output tails kept (64 KB).
- Timeout (default 600 s); stopping kills the whole process tree.
