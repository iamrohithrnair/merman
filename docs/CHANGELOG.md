# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.2.1] - 2026-10-29

### Changed

- Resizing the terminal reuses a C4 diagram's routes at every width that packs its boxes the same way, so dragging from 200 to 120 columns lays out the largest diagram 14 times instead of 81: about 0.8 s in all instead of 3.6 s, and about 0.1 s to drag back.
- Once its fence closes, a C4 diagram keeps its drawing while the rest of the reply streams in, so each redraw costs about 0.1 ms, as with a flowchart, instead of 0.4 to 4 ms.
- C4 drawings hold less memory while on screen: at most about 10 to 14 MB for large diagrams, against about 15 MB in 0.2.0. Up to about 7.5 MB stays cached after they scroll away, which is what makes resizing and redraws cheap.
- Kept replies are weighed by what they draw as well as by their text, so a transcript full of large diagrams can no longer hold many megabytes. Replies with very large tables leave that cache a little sooner.

## [0.2.0] - 2026-10-29

### Added

- C4 diagrams draw in replies: mermaid `C4Context`, `C4Container`, `C4Component`, `C4Dynamic` and `C4Deployment` blocks, and C4-PlantUML in `plantuml` blocks. Each box shows its name in bold, its type in brackets and its description; boundaries and deployment nodes draw as nested frames, and external systems in the comment color. Relationships are numbered lines routed around the boxes, with a legend underneath, and pointing at a line or its legend row lights both. A diagram too large or too deeply nested to lay out quickly shows its source with the usual failure note, and a reply close to Claude Code's node limit drops the C4 hover highlights first. Contributed by Justin Lindh ([#1](https://github.com/iamrohithrnair/merman/pull/1)).
- One-command install from the repo's own marketplace: `claude plugin marketplace add iamrohithrnair/merman && claude plugin install merman@merman`, and `claude plugin update merman@merman` to update.

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
