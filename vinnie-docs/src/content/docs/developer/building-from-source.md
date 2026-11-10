---
title: "Building from Source"
description: "Set up a development environment and build Vinnie."
sidebar:
  order: 14
---
## Prerequisites

See [System requirements](/getting-started/system-requirements/#to-build-vinnie-from-source): Node.js 20.19+,
pnpm 12.15 (via corepack), Rust stable (MSVC), Visual Studio C++ Build Tools, and Windows 10/11.

If `corepack enable` fails with a permissions error, install the shim into your user npm folder:

```powershell
corepack enable pnpm --install-directory "$env:APPDATA\npm"
```

## Get and run

```powershell
git clone https://github.com/1anP33in/vinnie.git
cd vinnie
pnpm install
pnpm app:dev
```

`pnpm app:dev` starts Vite and the Tauri app with hot reload. Rust changes rebuild and restart the app.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm app:dev` | Run the desktop app in development |
| `pnpm app:build` | Release build and NSIS installer (`src-tauri\target\release\bundle\nsis\`) |
| `pnpm typecheck` | TypeScript (strict) |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest + React Testing Library |
| `pnpm build` | Production frontend build |
| `pnpm rust:test` | Rust tests |
| `pnpm rust:clippy` | Clippy with warnings as errors |
| `pnpm check` | All of the above checks |

## Notes

- Run pnpm from PowerShell. Under Git Bash, MSYS's own `link` can shadow the MSVC linker, so use PowerShell for
  Rust builds too.
- A second running instance of Vinnie with different WebView2 arguments needs its own
  `WEBVIEW2_USER_DATA_FOLDER`.
- The dev and installed apps share the same data folder, so test data you create in development appears in your
  installed Vinnie.
