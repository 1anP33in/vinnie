---
title: "Project Workspaces"
description: "How Vinnie understands and navigates your project."
sidebar:
  order: 4
---
When a project is open, Vinnie builds a picture of it from evidence in the folder. The project information
panel at the top of the Explorer shows the results; click **Re-analyze project** after big changes.

## What Vinnie detects

| Fact | How it's detected |
| --- | --- |
| Project types | Files and manifests: for example `fxmanifest.lua` → *FiveM Resource*; `package.json` → *Node.js Project*, *React Application*, *Next.js Application*, or *Tauri Desktop App*; `pyproject.toml` / `requirements.txt` → *Python Project*; `*.csproj` → *C# Project*; `Cargo.toml` → *Rust Project*; `go.mod` → *Go Module*; HTML files → *Static Website* |
| Languages | File counts by extension |
| Frameworks | Dependencies in manifests |
| Package managers | Lockfiles and manifests; see below |
| Entry points | Common entry files and manifest fields |
| Config files | For example `package.json`, `tsconfig.json`, `Cargo.toml`, `pyproject.toml`, `fxmanifest.lua`, `Dockerfile` |
| Instruction files | `AGENTS.md`, `CLAUDE.md`, `VINNIE.md`, `.cursorrules`, `.github/copilot-instructions.md`, `CONTRIBUTING.md`, `.windsurfrules` |
| FiveM manifest | Scripts, `ui_page`, files, and dependencies listed in `fxmanifest.lua` or `__resource.lua` |
| Git | Branch and modified/untracked files (if Git is installed) |

The analysis scans up to 20,000 files and 8 folder levels and says when it stopped early.

## Package managers

| Ecosystem | Detected from |
| --- | --- |
| Node.js | `pnpm-lock.yaml` (pnpm), `package-lock.json` (npm), `yarn.lock` (yarn), `bun.lock` / `bun.lockb` (bun) |
| Python | `uv.lock` (uv), `poetry.lock` or `[tool.poetry]` (poetry), `Pipfile` (pipenv), `requirements.txt` (pip) |
| Rust | `Cargo.toml` (cargo) |
| .NET | project files (dotnet) |
| Go | `go.mod` (go) |

When the evidence is ambiguous (for example `package.json` without a lockfile), Vinnie says so, and an install
approval card lets you pick the package manager.

## Ignored folders

Folders such as `node_modules`, `.git`, `.vscode`, `.idea`, `bin`, `obj`, `dist`, `build`, `__pycache__`, and
`target` are shown dimmed in the Explorer and skipped by search and analysis. Change the list under
**Settings → Ignored folders**. Search also respects `.gitignore`.

## How the agent uses this

The agent can call `get_project_info` to read these facts, and [verification](/agent-system/verification-system/)
uses the detected package manager and scripts to choose which checks to run.
