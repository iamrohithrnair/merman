---
name: drive-check
description: Drive an interactive merman surface (the setup pane, buttons, anything with keys or Enter) like a person would, in a real Claude Code session, and look for bugs. Use before merging a change to panes, buttons, focus or saved options, or when asked to "try it", "click through it", "test the menu", "look for bugs".
---

# Drive check

`live-check` shows how a reply draws. This one presses keys. It installs the working copy into a throwaway Claude Code config, so Enter can save options without touching yours, then replays a list of keys in a hidden terminal and renders the result.

## Setup, once per working copy

```bash
.claude/skills/drive-check/drive.sh setup <repo or worktree path>
```

Run it again after every edit: it copies the code into the install.

Three traps it handles, each found the hard way:

- **Your real config:** Enter saves through `$.config.set`. The throwaway `CLAUDE_CONFIG_DIR` takes the writes.
- **`--plugin-dir`:** an inline plugin has no `/config` rows, so `$.config.set` throws and a press looks dead. The script installs from a local marketplace instead.
- **`CLAUDE_CODE_PLUGIN_DIRS`:** if your shell sets it, it loads that checkout over the install. The script unsets it.

## Run a scenario

```bash
.claude/skills/drive-check/drive.sh <name> <cols> <rows> '[[12,"/merman setup"],[2,"\r"],[8,"\u001b[B"],[1,"\r"],[5,""]]'
```

Steps are `[seconds to wait, keys to type]`. Keys: Down `\u001b[B`, Up `\u001b[A`, Tab `\t`, Enter `\r`, Esc `\u001b`. It prints the PNG path and the options that got saved. Read the PNG; do not grep the capture for words, color codes split them.

## What to try

Every interactive change, at 120×45, 110×40 and 80×24:

1. Open it, move, Enter: did the right value save, and did it move on?
2. A pick that **changes** a value: saving reloads the mod. Is the next step shown, with focus on its current value?
3. Walk every step changing each one, and check every saved value against the keys pressed.
4. Esc halfway: earlier picks kept, pane closed.
5. Open it again while it is open, and again after it closed.
6. The smallest size: do arrows still move focus, or do they only scroll?
7. Then `/merman demo-rtl`, every Hebrew line read right to left.

Write each bug as keys, size, expected, got. That is the repro the author needs.
