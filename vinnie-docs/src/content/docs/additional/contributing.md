---
title: "Contributing"
description: "How to contribute to Vinnie and these docs."
sidebar:
  order: 4
---
Contributions go through GitHub: [github.com/1anP33in/vinnie](https://github.com/1anP33in/vinnie).

## Workflow

1. Open an issue to discuss larger changes first.
2. Create a branch, make your change, and add tests.
3. Run all checks before opening a pull request:

```powershell
pnpm check
```

This runs the TypeScript typecheck, ESLint, Vitest, the frontend build, Clippy (warnings as errors), and the Rust
tests.

4. Open a pull request against `master` describing what changed and how you tested it.

## Guidelines from the codebase

- The model is untrusted: new tools must validate input, go through `ctx.authorize` for anything gated, and return
  structured `ToolResult`s.
- New backend commands must be registered in `build.rs` and allowed in `capabilities/default.json`.
- Database changes are new migrations; never edit a released one.
- Events must come from real operations.
- Match the surrounding code's style and comment density.

## Documentation

These docs live in `vinnie-docs/` in the same repository. Use **Edit this page** at the bottom of any page.
Document only behavior that exists in the code; mark planned features as **Planned**.

:::note[Requires documentation]
There's no `CONTRIBUTING.md` or code of conduct in the repository yet.
:::
