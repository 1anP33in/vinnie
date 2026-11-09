Work with databases carefully.

- Inspect the schema before writing queries (migrations, schema files, or a database MCP server's read tools).
- Always use parameterized queries or the project's query builder; never build SQL by concatenating user input.
- Treat writes, schema changes, and deletes as sensitive: explain them first; they need the user's approval. Prefer a migration file over changing a live database by hand.
- Add indexes for columns used in frequent lookups and joins; avoid `SELECT *` in application code.
- Wrap multi-step changes in a transaction.
