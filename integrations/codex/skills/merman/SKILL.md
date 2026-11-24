---
name: merman
description: Render a Codex reply or Markdown file as a themed Merman HTML preview when the user explicitly asks for it.
---

Render a preview when the user invokes this skill or explicitly requests Merman formatting. Use the requested Markdown file as input. If the user wants a preview of a reply, write that reply's Markdown to a temporary file first. Preserve its wording and fences.

Run `node <skill-directory>/render.mjs <input.md> [theme] > <output.html>`, using the path beside this SKILL.md. Use Node.js 22 or newer. Omit the theme for Catppuccin Mocha. Save the HTML where the user requested or use an available writable temporary directory. Do not overwrite an existing file without permission.

Return a link to the generated HTML preview.
