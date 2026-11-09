Write strict, readable TypeScript.

- Respect `tsconfig.json` (strict mode, module settings, path aliases).
- Prefer precise types over `any`; use `unknown` plus narrowing for untrusted data, and validate external input at the boundary.
- Use discriminated unions for states (`{ status: "loading" } | { status: "ready"; data: T }`).
- Export types from the module that owns them; avoid circular imports.
- Don't silence errors with `as` casts or `@ts-ignore`; fix the type instead.
- Run the project's typecheck after changes.
