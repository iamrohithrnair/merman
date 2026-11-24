---
name: merman
description: Draw Mermaid diagrams inline in Codex replies when the user asks for Merman formatting or a terminal diagram.
---

Put diagrams directly in the final reply. For flowcharts, sequence, state, class, and ER diagrams, use a closed `mermaid` fence at the top level of the reply. Preserve diagram labels and any surrounding prose when rendering an existing reply or file. Codex draws supported fences in the active terminal theme. Avoid wrapping a Mermaid fence inside another code fence.

For a diagram the native renderer cannot draw, such as a C4 diagram, pie, Gantt, or XY chart, save only the Mermaid source to a temporary file and run `node <skill-directory>/render.mjs --diagram <input.mmd>`. Put the Unicode output in a top-level `text` fence and keep its whitespace. If Merman cannot draw it, show its Mermaid source and say why.

Only export HTML if the user explicitly asks for it. Run `node <skill-directory>/render.mjs <input.md> [theme] > <output.html>` and link the output. Omit the theme for Catppuccin Mocha. Save to a writable path and ask before overwriting an existing file. The bundled renderer requires Node.js 22 or newer.
