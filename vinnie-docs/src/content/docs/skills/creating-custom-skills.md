---
title: "Creating Custom Skills"
description: "Write your own skill in the Skills manager."
sidebar:
  order: 3
---
Open **Skills** (book icon on the left rail) and click **Create skill**.

| Field | Notes |
| --- | --- |
| Name | For example `Duty System` |
| ID | Derived from the name (`duty-system`) if left empty: lowercase letters, digits, and dashes, 2–64 characters |
| Description | What the skill helps with (required) |
| Version / Author / Tags | Version like `1.0.0`; tags are comma separated |
| Use when the request mentions | Keywords, comma separated |
| Or the project uses these languages | For example `Lua, TypeScript` |
| Or is one of these project types | For example `FiveM, Node.js` |
| Tool hints | Optional, for example `github.*` or `run_command`; they only affect which tools are offered |
| Instructions | Markdown, up to 20,000 characters |

After saving, add **reference files** (for example `natives.md`). The agent can read them with
`read_skill_reference` while the skill is active.

Example instructions:

```markdown
When building duty systems for this server:
- Store shifts with oxmysql in the `duty_logs` table.
- Validate the player's job on the server before toggling duty.
- Use ox_lib notifications for player feedback.
```
