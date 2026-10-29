---
name: demo
description: Print the merman demo reply to eyeball every rendering feature after a change. Use after any visual change, when asked for "the demo", "show all features", "visual test", or before a release screenshot.
---

# Demo

The visual test. Unit tests prove the tree; this proves the look.

1. **Load the working copy** in this session (see `live-check` step 1). The new version shows only after the turn that made the edit ends.
2. **Print `docs/demo.md` verbatim as the whole final message of a turn**, with nothing before it and no tool call after it. Claude Code condenses text written right before a tool call, so the demo must close the turn.
3. **The person looks at it**, or screenshots it on the next turn (`live-check` step 3). Check:
   - `merman` in a heavy box on the first line, and `Roster` with a heavy rule under it
   - the table: yellow header, rules between rows, the right-aligned `Size` column, colored numbers
   - the four diagrams and the table on one row on a wide terminal, wrapping on a narrow one
   - every flowchart box and sequence participant in its own color, with matching colors at both ends of the sequence
   - a value above each bar, the tallest bar highlighted and the rest muted, labels without quotes, dim gridlines, colored axis numbers
   - the C4 diagram: `Shop` as a frame around `Orders` and `Ledger`, each box with its bold name and bracketed type (`[Container: Go]`), `Payments` and `[External Software System]` all in the comment color, lines numbered 1 to 3 that each start on one box and end in an arrowhead on another, and a legend under it reading `1  Baker → Orders  Uses`; pointing at a line lights its legend row
   - shell colors: command, flags, the quoted string, `&&`
   - code blocks with a language header and no frame, and Prism colors in the TypeScript block
   - path, link and inline-code colors, the paths opening their files on click in a terminal that draws hyperlinks while `/kick` stays unlinked text, the quote bar running down its paragraph and both list rows, and the green `Tip` alert box
   - accent `⧉ md`, `⧉ art` and `⧉ html` buttons on the table (`⧉ html` in a local macOS or Linux terminal only), and an accent `[ ⧉ copy ]` button on every diagram, the list, the shell block, the alert and the quote
   - the timeline figure: drawn line by line with no `── figure` header, the caption in the comment color, the `▏───▏` axis and the Provider bar in the diagram color, `✗` and `2 twice` in the theme's reddest accent color, the Handler bar and `1` in its greenest, the time labels in its most amber, those three different from each other and from the diagram color, the bars ending on the axis ticks, `⧉ source` and `⧉ art` above it
   - the Hebrew section: lines read right to left (the first bullet shows `eu-west` and `us-east` after the Hebrew, mirrored parentheses), bullets and `1.` on the right, the quote bar on the right, the table cells right aligned, and the shell comment reversed while `ls -la` stays
4. **Fix what looks wrong**, then run the demo again.
5. **Keep it current.** A new feature adds a line to `docs/demo.md` and to the checklist above. All data stays invented and neutral.
