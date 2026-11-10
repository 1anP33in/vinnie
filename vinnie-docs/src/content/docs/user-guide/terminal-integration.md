---
title: "Terminal Integration"
description: "Run commands, and see the commands Vinnie runs."
sidebar:
  order: 8
---
The **Terminal** tab in the bottom panel (<kbd>Ctrl</kbd>+<kbd>`</kbd>) runs development commands in the project
folder and shows their output. Commands Vinnie runs appear here too, so you always see what happened.

## Running a command

Type a command in the **Terminal command** field and press <kbd>Enter</kbd>, for example:

```text
npm test
```

Each command runs **on its own, without a shell**:

- no pipes (`|`), redirects (`>`), chaining (`&&`, `;`), or variables (`%VAR%`, `$VAR`);
- programs are found on `PATH`, never in the project folder (so a planted `git.exe` can't hijack a command);
- stdin is closed, so commands that wait for input wait until they time out or you stop them.

Output streams live. Each run shows its exit code, duration, and whether it timed out or was stopped. Click the
stop button on a running command to end it and its child processes.

## Command safety levels

Every command, yours or Vinnie's, is classified by the backend:

| Level | Examples | What happens |
| --- | --- | --- |
| **Low risk** | `npm test`, `npm run build`, `pnpm run typecheck`, `git status`, `git diff`, `cargo test`, `dotnet build`, `python -m pytest`, `node --version` | Runs directly |
| **Needs approval** | `npm install`, `git commit`, `git checkout`, `npx …`, unknown programs | Runs when allowed by your *Run commands* or *Install dependencies* permission, or after you approve |
| **Blocked** | `rm`, `del`, `format`, `diskpart`, `shutdown`, `reg`, `git clean`, `cmd`, `powershell`, `bash`, `wsl` | Never runs |

See [Command execution security](/security/command-execution-security/) for the full rules.

## Timeouts

Commands Vinnie runs stop after **Settings → Agent → Command timeout** (default 600 seconds, up to 3,600).

## Always-allowed commands

When you choose **Always allow** on a command approval card, that exact command is remembered **for this
project**. Review or remove them under **Settings → Assistant permissions → Always-allowed commands in this
project**.
