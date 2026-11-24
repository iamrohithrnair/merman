---
name: mermaid
description: Draw a mermaid diagram (flowchart, sequence, state, class, ER, pie, gantt, xychart, C4) as box-drawing text with merman. Use whenever a reply would contain a mermaid block, or when asked to draw, chart or diagram something.
---

Devin shows mermaid source as raw text, so draw each diagram before it goes in a reply.

1. Write the mermaid source and pipe it to the renderer beside this file. It needs Node.js 22 or newer.

   ```bash
   node <this skill's directory>/render.mjs <<'MERMAID'
   flowchart LR
     A[Plan] --> B[Ship]
   MERMAID
   ```

   Set `COLUMNS` to change the width (default 100), or `MERMAN_ASCII=1` for plain ASCII.
2. Paste the output unchanged into the reply inside a fence with no language, so Devin keeps every space and box character. Do not retype or adjust it.
3. Leave the mermaid source out of the reply unless the user asks for it.

If the renderer exits with an error, fix the syntax and retry. If it still fails, show the source in a `mermaid` fence.
