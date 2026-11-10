---
title: "Introduction to Skills"
description: "Skills are reusable instructions that guide Vinnie for a kind of work."
sidebar:
  order: 1
---
A **skill** is a folder of instructions (and optional reference files) that tells Vinnie how to approach a
kind of work, for example FiveM resources or Git workflows.

- Vinnie picks **at most 3** relevant skills per request, based on your words and the open project.
- Only the chosen skills' instructions are loaded into the model's context, which matters for local models
  with small context windows.
- The agent panel shows which skills a task used and why. Hover a skill chip to see the reasons.
- You can force a skill **on** or **off** for the session with the book button next to the message box.

Skills are **guidance, not permissions**. A skill can't grant itself permissions, bypass approvals, or change
Vinnie's rules. Its tool hints only affect which tools are offered. See [Built-in skills](/skills/built-in-skills/)
and [Creating custom skills](/skills/creating-custom-skills/).
