# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-28

First release of merman as its own project.

### Added

- Mermaid diagrams and charts drawn as colored box art in Claude Code replies: flowcharts, sequence, state, class and ER diagrams, `xychart-beta` bar and line charts, pie charts and gantt charts.
- Colored tables, headings, lists, quotes, GitHub alerts, task lists, footnotes and figures, with highlighted code in two dozen languages.
- 16 color presets plus `mono`, switched on the spot with `/merman theme <name>`, and `/merman setup` to pick every style from drawn samples.
- Copy buttons on tables, code, diagrams and replies (`⧉ md`, `⧉ art`, `⧉ html`, `▣ png`).
- LaTeX math as images in kitty and Ghostty, off until you set `latex`.
- A short demo GIF and a Performance section in the README: a full reply renders in about 2 ms, and the only model-facing cost is a 355-token hint once per conversation.

### Changed

- Requires Claude Code 2.1.311 or later.
- Tool rows and results are Claude Code's own by default. Merman's compact tool rows, diff cards and quiet output are opt-in with `toolRows: true`.
- The line that closes a turn is Claude Code's own again, with its `done` time. `clock` adds the time to your prompts only.

### Fixed

- Collapsed tool groups count calls the way Claude Code does, and say `(ctrl+o to expand)` on the terminal.
- In the ctrl+o transcript, tool rows and quiet results draw in full, and summary blocks keep their `· summary` mark.
- A setup pane pick whose save fails no longer leaves an unhandled error.
