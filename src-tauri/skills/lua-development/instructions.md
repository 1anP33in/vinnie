Write clear Lua 5.4.

- Use `local` for every variable and function unless it truly must be global; globals leak between scripts.
- Tables are 1-indexed; use `#t` only for sequences without holes, `pairs` for maps, `ipairs` for arrays.
- Check `nil` before indexing nested tables (`if data and data.job then`).
- Use `pcall`/`xpcall` around code that may fail at runtime and report the error message.
- Concatenate many strings with `table.concat`, not `..` in a loop.
- Keep functions small and name them for what they do; match the existing style of the project (indentation, naming, module pattern).
