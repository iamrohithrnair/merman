# Tool output: quiet

`toolOutput` picks how much of a call shows. The default, `full`, is what Claude Code shows. `quiet`, set in `/config` or as `"toolOutput": "quiet"` in `settings.json`, shows what Claude did, not what it read. Needs `toolRows` on.

- Read, Grep, Glob, web fetches and shell commands made only of read-only programs (`cat`, `grep`, `rg`, `ls`, `find`, `git log`, `gh pr view`, …) draw their row and nothing under it, and the row says it in plain words: `Read src/report.py lines 1–10`, `Searched src/ for "TODO"`, `Listed tests`.
- A shell call with no such form shows the description Claude gave it and the programs it ran: `Run the unit tests · python3`.
- Other shell commands show their first 3 lines and a count, without the approval line, also when Claude Code folded the call into a collapsed group.
- Edits keep their diff card, and a shell command that changed files keeps one card per file under its first lines. New, deleted and renamed files keep their preview, `Deleted` line and `Renamed` line.
- A failed call shows the last real line of its error instead of `Exit code 1`; a refused call (a permission rule, the auto mode classifier) shows its full reason.

## What counts as read-only

A command counts as read-only only when every part of it is, after a quote-aware split on `;`, `&&`, `||`, `|`, `&` and newlines, with no redirect into a file, no `$(…)`, no heredoc and no write flags (`sed -i`, `find -delete`, …). In doubt, the result shows.
