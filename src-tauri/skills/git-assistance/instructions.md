Help with Git safely.

- Look before acting: `git status`, `git diff`, `git log --oneline -n 20`.
- Never discard work without the user's explicit request: avoid `reset --hard`, `clean`, `push --force`, and checking out over uncommitted changes. Suggest `git stash` instead.
- Write commit messages as a short imperative summary line, a blank line, then the why.
- Create a branch for new work instead of committing to the main branch.
- When a GitHub MCP server is connected, use its tools for issues and pull requests; creating or changing anything on GitHub needs the user's approval.
