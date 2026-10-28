---
name: live-check
description: Load the working copy of merman into a real Claude Code session and render how replies draw, with no screenshot. Use after any visual change, when asked to "screenshot", "see it", "try it live", or before claiming a rendering fix works.
---

# Live check

Tests prove the tree. Only a real render proves the look.

1. **Load the working copy:**
   - From a new terminal: `claude --plugin-dir <repo path>`. Saving files hot-reloads it.
   - From inside a session that loaded the `plugin-authoring` skill: copy `.claude-plugin/plugin.json`, `hooks/` and `types/` into that session's dev-mods folder. The person answers the one-time "Enable hot reloading" prompt, and the mod loads when the turn ends. Copy again after every edit.
2. **Print a sample reply** containing everything the change touches: a table with numbers and an aligned column, a `bash` block with flags and a quoted string, a path, a link, a heading and a `mermaid` block.
3. **Render it, never screenshot.** Window captures are blocked for agents and grab whatever else is open. Instead run the session in a hidden terminal, record every byte it draws, and replay that into xterm.js in headless Chrome. This works with the screen locked and in parallel:
   ```
   npm i -s --prefix <scratch> @xterm/xterm
   timeout 70 python3 .claude/skills/live-check/capture.py <scratch>/demo.bin <repo> 110 80 '[[45,""]]' claude --plugin-dir <repo> "/merman demo"
   node .claude/skills/live-check/render.mjs <scratch>/demo.bin <scratch>/demo.png 110 80 <scratch>/node_modules/@xterm/xterm
   ```
   Then read the PNG. `capture.py` takes the output file, working directory, columns, rows and a JSON list of `[seconds to wait, keys to type]` steps, then the command. Raise the rows to see more of a long reply. `render.mjs` finds Chrome or Chromium itself, or reads `CHROME`. On Windows, ask the person for a Win+Shift+S capture. xterm.js draws no kitty images and no desktop surface, so say those are unchecked.
4. **Check** column alignment, rule lengths, colors against the theme tokens, wrapping at narrow widths, and that nothing falls back to the engine renderer. A dim line naming `merman` in the transcript means a hook was refused; fix that first.
   **Hebrew, every time:** also render `/merman demo-rtl` and read every Hebrew line right to left against `rtlShowcaseText` in hooks/help.ts: sentences, list items, table cells, quotes and every diagram label. Word order and letter order both count. If something looks off, read the bytes in the `.bin` before blaming the render: on a terminal without bidi they must be in display order (`םולש`, not `שלום`).
5. **Before publishing a render**, check it, including the status line under the prompt, shows no private repo names, hostnames, internal versions or other work data. Use a neutral sample for README images.
