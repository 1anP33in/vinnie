You are working on a web project.

- Find the stack first: `package.json` scripts and dependencies, the framework (React, Vue, Express, Next.js), and the package manager (lockfile). Use what is already there; don't add a dependency for something a few lines can do.
- Follow the project's existing structure, component style, and state management.
- Accessibility: real buttons and labels, keyboard support, alt text, sufficient contrast.
- Never put secrets in front-end code; read them from environment variables on the server.
- Validate input on the server for every API endpoint and return proper status codes.
- After changes, run the project's own `typecheck`, `lint`, `test`, or `build` script when it exists.
