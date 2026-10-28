---
name: add-theme
description: Add, rename or update a merman color preset from an existing theme (Dracula, Nord, a VS Code theme, ...). Use when someone says "add a theme", "support <theme name>", "new palette" or "rename a preset".
---

# Add a theme

1. **License first.** Open the theme's original repo (not a port) and confirm MIT in its LICENSE file or README. Not MIT, or no license at all: stop and say so.
2. **Take colors from the official palette file** (the theme's palette repo or JSON/YAML spec), not from screenshots or a port.
3. **Map the palette onto all 22 tokens** in `PRESETS` in `hooks/presets.ts`. Every preset defines every token:

   | Token | Pick |
   | --- | --- |
   | `heading`, `tableHeader` | the theme's warm accent (yellow/orange) |
   | `number`, `codeString` | green |
   | `codeCommand`, `link`, `diagram` | blue |
   | `codeFlag` | red/pink |
   | `inlineCode`, `path` | cyan/teal |
   | `accent`, `bullet` | the signature color (purple for Catppuccin and Dracula) |
   | `emphasis` | pink/magenta |
   | `strong` | brightest foreground |
   | `codeText`, `diagramText` | normal foreground |
   | `codeComment`, `quote` | a muted foreground |
   | `rule`, `tableRule` | a subtle border/surface color |
   | `diffAdded`, `diffRemoved` | the theme's own green and red, its git or diff colors when it names them; the test wants code text at 4.5:1 on their tints and the two at least ΔE 13 apart |

4. **Name it after the source**, lowercase-hyphenated with the variant (`catppuccin-mocha`, `github-light`). Add it to `options` on the `theme` field in `.claude-plugin/plugin.json`.
5. **Credit it** in `docs/THIRD_PARTY_NOTICES.md` with the repo URL, the copyright line and the license name.
6. **Document it** in the README theme list (dark or light).
7. **Test** that `resolveStyle({ theme: '<name>' })` returns its `tableHeader`, then run the AGENTS.md Verify steps.
8. **Look at it** with `live-check` on a dark and a light terminal background.
