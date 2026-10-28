import { RANDOM_THEMES } from './theme'

export const HINT = [
  'merman, a mod (no tool), draws your markdown: tables, GitHub alerts, fenced code with a language tag and ```mermaid flowchart, sequenceDiagram, xychart-beta (line "name" [..]), pie, gantt.',
  'Chart numbers or flows that read better drawn, with short labels; not in short answers, code changes or reports, nor as a second picture of a figure.',
  'Fence commands and snippets to run or copy, never inline code: only fenced blocks get a copy button.',
].join(' ')

export const showcaseText = (themes: readonly string[]): string => `
# merman

Colored markdown for Claude Code replies: **bold**, *italic*, ~~struck~~, \`inline code\`, a [link](https://github.com/iamrohithrnair/merman) and a bare URL https://github.com/iamrohithrnair/merman/issues, both clickable, numbers like 99.9% and 250ms, paths like ~/src/app.ts.

Paths like ~/src/app.ts, ./README.md and /tmp/app.ts open on click in a terminal that draws hyperlinks, and so does a local link that shows its own path, like [/tmp/notes.md](file:///tmp/notes.md), while slash commands like /config stay text. A local link with any other name, like [notes](file:///tmp/notes.md), draws as its name and target, so it cannot hide where a click goes.

Paths written without ./, like docs/guide/ or src/app.ts:42, and Windows paths like C:\\work\\plan.md link too, once a check finds them on disk; prose like and/or stays text.

Programs and launchers stay plain text, so a click never runs one: ./install.sh, ~/Desktop/setup.command and /Applications/Calculator.app keep the path color without a link.

Code-shaped prose stays as written: f(*args, **kwargs), a link with parentheses [Foo_(bar)](https://en.wikipedia.org/wiki/Foo_(bar)), a file link [\`render.tsx\`](https://github.com/iamrohithrnair/merman/blob/main/hooks/render.tsx) and **bold with *italic* inside**.

## Commands

| Command | Does |
|---------|------|
| \`/merman\` | This screen |
| \`/merman theme <name>\` | Switch theme on the spot (\`/merman <name>\` works too), \`random\` for a new dark one now and each time the mod loads |
| \`/merman copy\` | Copy the last reply, or \`copy code\` for its last code block |
| \`/merman setup\` | Pick a theme and how tables, tasks, headings, copy buttons, prompts, times, tool rows, tool output, diffs and pie charts look, from drawn samples |
| \`/config\` | Edit any option |

> [!NOTE]
> ${themes.length} themes ship with it. \`mono\` uses no color, only bold and dim.

### Pick a theme

\`\`\`bash
/merman theme nord
/merman theme github-light
/merman theme random
\`\`\`

1. Dark: ${themes.filter(t => RANDOM_THEMES.includes(t)).join(', ')}
2. Light: ${themes.filter(t => /latte|light|dawn/.test(t)).join(', ')}
3. Plain
   - mono

> [!TIP]
> Any color slot beats the theme. Set \`headingColor\` or \`numberColor\` to a hex value in \`/config\`.

## Everything it draws

### Copy tables

Use \`⧉ md\` for Markdown, \`⧉ art\` for chat, or \`⧉ html\` for a formatted table. \`⧉ html\` shows in a local macOS, Linux or Windows terminal and writes HTML and tab-separated plain text together; Linux needs CopyQ running. Pasted into Slack it makes a native table; Slack keeps cell text but drops bold, links and alignment. If that fails, it copies the plain text alone. \`▣ png\` puts a picture of the drawn table, diagram or chart on the clipboard in the theme's colors, ready to paste into Slack, docs or slides; it shows in a local macOS or Windows terminal. Set \`copyButtonStyle\` to \`hover\` in \`/config\` and each block shows a dim ⧉ instead: point at it for its buttons.

| Item | Quantity[^count] | Status |
|:-----|---------:|:------:|
| **Apples** | 3 | *Ready* |
| Oranges | 5 | Pending |

### Alerts

> [!IMPORTANT]
> After updating the plugin, open sessions need \`/reload\`.

> [!WARNING]
> Terminals that copy on select (Warp) can turn a click on a copy button into a selection. Use the keyboard shortcut.
> Selecting a typeset formula copies blank cells. Its copy button copies the LaTeX.

> [!CAUTION]
> Claude Code refuses trees over 20000 nodes. A code block past about 500 highlighted lines falls back to plain text.

### Task lists

- [x] Parse the reply
- [x] Draw it
  - [x] Tables and code
  - [ ] Diagrams on the desktop app
- [ ] Ship the next release

### Your prompts

Scroll up: what you typed draws in a bubble. \`promptStyle\` switches to \`wide\`, \`bar\`, \`chevron\` or \`off\` in \`/config\`. Set \`clock\` to \`24h\` or \`12h\` and each prompt shows when you sent it. A paste of 4 lines or more draws in a double frame of its own, folded to one button that opens it as highlighted code.

### Tool rows

Off by default: set \`toolRows\` to \`true\` in \`/config\` and tool calls draw as one line, dimmed on the right, and the file each one read or edited opens on click in a terminal that draws hyperlinks. Set \`toolStyle\` in \`/config\` to \`chat\`, \`tree-dim\`, \`tree-bold\` or \`classic\`. \`toolOutput: quiet\` in \`/config\` hides what Claude only read and says in plain words what each call did: \`Read src/app.ts lines 1–40\`, \`Searched src/ for "TODO"\`.

Each edit draws as a diff card headed \`+N −M\`: code highlighted in the file's language, added and removed lines on a tint of the theme's own green and red with the changed words in a deeper tint, kept readable in every theme, long lines wrapped, the first 20 lines and a \`+K more lines\` button that opens the rest, as does a click anywhere on the card. Files a shell command changes (\`sed -i\`, a script) get the same card, one per file, headed by its path. Set \`diffStyle\` in \`/config\` for the look: \`card\`, \`full\`, \`marks\` or \`bar\`.

A file Write creates shows its first 10 lines as numbered code in the theme's colors with no diff marks, and a click on it or on \`+K more lines\` opens the rest. A file an Edit or a shell command creates shows its first 10 lines as added lines under \`Created\`. A file a shell command removes is one \`Deleted\` line that opens to its removed lines on a click, and a file moved unchanged is one \`Renamed old → new\` line.

### Quotes and rules

> A quote keeps its text when you copy it, without the \`> \` markers.
>
> It keeps its paragraphs and lists too:
> - **bold** and \`inline code\` stay styled
> - each item gets its own row
>
> > A nested quote draws inside the bar.

<summary>
A line that holds only a tag draws dim, so wrapper tags show the reply's structure.
</summary>

---

### Code

\`\`\`json
{ "theme": "dracula", "headingStyle": "banner", "mermaid": true }
\`\`\`

Blocks of 10 lines or more get line numbers. Past 30 lines they fold to the first 20 and a \`+M more lines\` button, \`show less\` folds them back; \`⧉ copy\` still copies the whole block.

\`\`\`ts
type Item = { name: string; price: number; qty: number }

const basket: Item[] = [
  { name: 'apples', price: 1.2, qty: 3 },
  { name: 'oranges', price: 0.8, qty: 5 },
  { name: 'pears', price: 1.5, qty: 2 },
  { name: 'plums', price: 2.1, qty: 4 },
  { name: 'grapes', price: 3.4, qty: 1 },
  { name: 'lemons', price: 0.6, qty: 6 },
  { name: 'melons', price: 4.0, qty: 1 },
  { name: 'cherries', price: 5.5, qty: 2 },
  { name: 'figs', price: 2.8, qty: 3 },
  { name: 'limes', price: 0.5, qty: 8 },
  { name: 'peaches', price: 1.9, qty: 4 },
  { name: 'kiwis', price: 0.9, qty: 6 },
]

const total = (items: Item[]): number =>
  items.reduce((sum, item) => sum + item.price * item.qty, 0)

const cheapest = (items: Item[]): Item | undefined =>
  [...items].sort((a, b) => a.price - b.price)[0]

const byName = (items: Item[]): Item[] =>
  [...items].sort((a, b) => a.name.localeCompare(b.name))

const receipt = (items: Item[]): string[] =>
  byName(items).map(item => \`\${item.name.padEnd(10)} \${item.qty} x \${item.price.toFixed(2)}\`)

console.log(receipt(basket).join('\\n'))
console.log('total', total(basket).toFixed(2))
console.log('cheapest', cheapest(basket)?.name)
\`\`\`

#### Math

$$
\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}
$$

#### Images

In kitty and Ghostty a PNG on a line of its own draws as a picture: a local path, \`~/\`, \`file://\` or a \`data:\` URL. Web images stay links, merman downloads nothing. Other terminals show the alt text in link color.

![prism band](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAUAAAAAoCAIAAAAAIrR+AAACdElEQVR42u3TewcQBgAA8ZNkkkySJEmSJJOWrW3t/cyWJJlMkmQmSZIkSSaTJEmSJEmStLS0trX3smVLkiRJkiTJZCZJdrNvsP0xNu73Fc4hOBAfwyH4OA7HkTgax+J4nIiTcQpOw+k4A1/EV/FNfBtn41x8F9/DhbgY38eluBxX4mpci+vxQ/wIN+NW3I47cTfuxf14EA/jUTyOJ/EUfo3f44/4M57DC3gJr+A1vIG38A7+ir/hfXyIf/BIHsjvck/uym25KdflqlyWi3JezsoZOS3fyVfyuZyQY3JEDskB2Sd7ZJfskG2yRTbJRtkg62SNrJIVskw+kCWySBbIfJknc2SWzJQ35BV5QZ6Vp2SqPCGTZIKMkzEySkbIMBkqg2WQDPgrwAAchINxKA7DETgKx+A4nICT8Amcik/hM/g8voyv40ychXNwHs7HBbgIl+AHuAxX4Cpcg+twA27ETbgFt+EO3IV7cB8ewEN4BI/hCfwMv8Rv8TSewbN4Hi/iZbyK1/Em3sa7eA9/xwf4iD/kodyX3+RXuSO35IZckytySS7IOflFfpIf5Bs5JSfluByVw3JQ9ste2S07Zbtslc3ykXwo62WtrJaVslyWyvuyWBbKe/KuzJXZ8o68Ja/JSzJDpss0mSKTZaKMl7EyWkbKcHlchshjMvDvHvAkPo3P/TsHfIyf4Kf4xT88YABJ/rcaOGngJA2cpIGTBk7SwEkaOEkDJw2cpIGTNHDSwEkaOEkDJ2ngpIGTNHCSBk7SwEkDJ2ngJA2cNHCSBk7SwEkaOGngJA2cpIGTNHDSwEkaOEkDJw2cpIGTNHCSBk4aOMl/yZ8SRd1gPq93WQAAAABJRU5ErkJggg==)

#### Footnotes

Latency fell to 120ms[^lat] after the cache change[^cache].

Click a mark to see its note. Point at a note to light the marks that cite it. Both need Claude Code 2.1.295 or later.

[^count]: Counted at close.
[^lat]: Median of 50 runs.
[^cache]: Entries expire after 10m.

#### Diagrams

\`\`\`mermaid
flowchart LR
    R["<i>Reply</i>"] --> P["<b>Parse</b>"]
    P --> D["<u>Draw</u>"]
    D --> S["<s>Screen</s>"]
\`\`\`

\`\`\`mermaid
sequenceDiagram
    participant U as You
    participant C as Claude
    participant P as merman
    U->>C: prompt
    C->>P: markdown
    P-->>U: colored reply
\`\`\`

\`\`\`mermaid
xychart-beta
    title "Color options per group"
    x-axis [text, head, num, code, diag]
    y-axis "options" 0 --> 8
    bar [7, 3, 2, 6, 2]
\`\`\`

Name each series and the legend says which line is which:

\`\`\`mermaid
xychart-beta
    title "Replies per hour"
    x-axis [09, 10, 11, 12, 13]
    y-axis 0 --> 40
    line "east" [30, 34, 22, 26, 31]
    line "west" [12, 18, 25, 20, 14]
\`\`\`

A pie draws round with a legend. Set \`pieStyle\` to \`bars\` in \`/config\` for one bar per slice:

\`\`\`mermaid
pie showData title Time per reply stage
    "Parse" : 3
    "Draw" : 9
    "Paint" : 5
\`\`\`

\`\`\`mermaid
gantt
    title Release week
    dateFormat YYYY-MM-DD
    section Build
    Parser   :p, 2026-10-05, 2d
    Renderer :r, after p, 3d
    section Ship
    Review   :after r, 2d
    Release  :milestone, 2026-10-12, 0d
\`\`\`

A diagram wider than the terminal stays source, with a dim line saying why:

\`\`\`mermaid
flowchart TD
    Q[Queue] --> W1[Worker 1] & W2[Worker 2] & W3[Worker 3] & W4[Worker 4] & W5[Worker 5] & W6[Worker 6] & W7[Worker 7] & W8[Worker 8] & W9[Worker 9] & W10[Worker 10] & W11[Worker 11] & W12[Worker 12] & W13[Worker 13] & W14[Worker 14] & W15[Worker 15] & W16[Worker 16]
\`\`\`

A figure draws as written, its markup colored by role:

\`\`\`figure
{dim:timeout at 10 s, handler books at 12 s, retry books again}
          {note:0 s}           {note:10 s}  {note:12 s}              {note:later}
          {accent:▏─────────────▏─────▏─────────────────▏}
Provider  {accent:██████████████}{warn:✗} timeout               {accent:█} retry
Handler   {ok:████████████████████} 200, nobody waits
Bookings  0                   {ok:1}                 {warn:2 twice}
\`\`\`

A box whose rows slip off its frame is lined up with its corner:

\`\`\`figure
{accent:┌─ queue ──────────┐}
{accent:│} {ok:● worker 1} {accent:│}
{accent:│} {warn:▲ worker 2 slow}      {accent:│}
{accent:└──────────────────┘}
\`\`\`
`

export const helpText = (themes: readonly string[]): string => `
## Commands

| Command | Does |
|---------|------|
| \`/merman theme <name>\` | Switch theme on the spot (\`/merman <name>\` works too), \`random\` for a new dark one now and each time the mod loads |
| \`/merman copy\` | Copy the last reply, or \`copy code\` for its last code block |
| \`/merman setup\` | Pick a theme and how tables, tasks, headings, copy buttons, prompts, times, tool rows, tool output, diffs and pie charts look, from drawn samples |
| \`/merman demo\` | Full showcase, every element and diagram, plus a section in your language (Korean so far, or \`demo ko\`) |
| \`/merman demo-rtl\` | Hebrew right-to-left showcase |

### ${themes.length} themes

- Dark: ${themes.filter(t => RANDOM_THEMES.includes(t)).join(', ')}
- Light: ${themes.filter(t => /latte|light|dawn/.test(t)).join(', ')}
- Plain: mono, no color, only bold and dim

Docs and issues: https://github.com/iamrohithrnair/merman

> [!TIP]
> Any color slot beats the theme. Set \`headingColor\` or \`numberColor\` to a hex value in \`/config\`.

### Task lists

- [x] Tables, diagrams and charts drawn in the terminal
- [x] Copy tables as Markdown, art or HTML (macOS/Linux), and tables, diagrams and charts as a PNG image (macOS/Windows)
- [ ] Pick a \`taskStyle\` in \`/config\`: checks, ticks, box or progress

\`\`\`mermaid
flowchart LR
    R[Reply] --> P[Parse]
    P --> D[Draw]
    D --> S[Screen]
\`\`\`

\`\`\`mermaid
xychart-beta
    title "Color options per group"
    x-axis [text, head, num, code, diag]
    y-axis "options" 0 --> 8
    bar [7, 3, 2, 6, 2]
\`\`\`

> [!CAUTION]
> Claude Code refuses trees over 20000 nodes. A code block past about 500 highlighted lines falls back to plain text.
`

export const rtlShowcaseText = (): string => `
# עברית מימין לשמאל

**שלום חברים**, זו הדגמה של עברית עם מונחים באנגלית כמו \`kubectl\`, מספרים כמו 99.9% ו-250ms, נתיב כמו ~/src/app.ts וגם [קישור](https://github.com/iamrohithrnair/merman).

## רשימות

- פרוסים בשני אזורים (us-east ו-eu-west)
- Python מתאים גם לסקריפטים קצרים
- מחליפים ערכת נושא עם \`/merman theme nord\`

1. מתקינים את התוסף
2. שואלים שאלה בעברית

> עברית נקראת מימין לשמאל, גם בטרמינל בלי תמיכה בכיווניות

> [!TIP]
> כל ערכת נושא עובדת גם בעברית

| שירות | אזור | גרסה |
| :--- | :--- | ---: |
| שער | us-east | 2.14.0 |
| חיוב | eu-west | 1.8.3 |

\`\`\`bash
ls -la # רשימת הקבצים בתיקייה
\`\`\`

\`\`\`text
טיוטה להודעה: הגרסה עלתה ב-14:20
\`\`\`

\`\`\`mermaid
flowchart LR
  A[בקשה חדשה] --> B{האם יש cache?}
  B -->|כן| C[מחזירים מה-cache]
  B -->|לא| D[פונים לשרת]
\`\`\`
`

const KOREAN_SHOWCASE = `
## 한국어

**안녕하세요**, merman는 한국어 답변도 그대로 보여 줍니다. \`kubectl\` 같은 영문 명령어, 숫자 99.9%와 250ms, 경로 ~/src/app.ts도 함께 표시됩니다.

- 서울 리전과 도쿄 리전에 배포
- \`/merman theme nord\`로 테마 변경

| 서비스 | 리전 | 버전 |
| :--- | :--- | ---: |
| 게이트웨이 | ap-northeast-2 | 2.14.0 |
| 결제 | ap-northeast-1 | 1.8.3 |

\`\`\`figure
{accent:┌─ 빌드 ─────────────┐}
{accent:│} 이미지 생성 완료   {accent:│}
{accent:│} {ok:✓ 테스트 통과}      {accent:│}
{accent:│} {warn:▲ 배포 대기}        {accent:│}
{accent:└────────────────────┘}
\`\`\`

\`\`\`mermaid
flowchart LR
  A[새 요청] --> B{캐시 있음?}
  B -->|예| C[캐시에서 반환]
  B -->|아니오| D[서버 호출]
\`\`\`
`

export const HELP_SHOWN = 'Showed the merman help.'

export const DEMO_SHOWN = 'Showed the merman demo.'

export const KOREAN_DEMO_SHOWN = 'Showed the merman demo with its Korean section.'

export const RTL_DEMO_SHOWN = 'Showed the merman Hebrew right-to-left demo.'

export const demoShown = (lang: string): string => (/^ko/i.test(lang) ? KOREAN_DEMO_SHOWN : DEMO_SHOWN)

export const shownScreen = (themes: readonly string[], text: string): string | undefined => {
  const screens: [string, () => string][] = [[HELP_SHOWN, () => helpText(themes)], [DEMO_SHOWN, () => showcaseText(themes)], [KOREAN_DEMO_SHOWN, () => showcaseText(themes) + KOREAN_SHOWCASE], [RTL_DEMO_SHOWN, rtlShowcaseText]]
  const shown = screens.find(([line]) => text.endsWith(line))
  return shown && text.slice(0, -shown[0].length) + shown[1]()
}

export type SetupStep = { name: string; key: 'theme' | 'tableStyle' | 'taskStyle' | 'headingStyle' | 'copyButtonStyle' | 'promptStyle' | 'clock' | 'toolStyle' | 'toolOutput' | 'diffStyle' | 'pieStyle'; title: string; note: string; options: readonly string[]; sample: string }

export const setupSteps = (themes: readonly string[]): SetupStep[] => [
  { name: 'theme', key: 'theme', title: 'Theme', note: 'Each theme draws the same line. `random` picks a new dark one each time the mod loads.', options: themes, sample: '**Bold**, `inline code`, 250ms and ~/src/app.ts.' },
  { name: 'tables', key: 'tableStyle', title: 'Tables', note: 'How markdown tables draw.', options: ['box', 'rules', 'grid', 'minimal'], sample: '| Item | Qty |\n|:-----|----:|\n| Apples | 3 |\n| Pears | 5 |' },
  { name: 'tasks', key: 'taskStyle', title: 'Tasks', note: 'How `- [ ]` and `- [x]` items draw.', options: ['checks', 'ticks', 'box', 'progress'], sample: '- [x] Parse the reply\n- [x] Draw it\n- [ ] Ship it' },
  { name: 'headings', key: 'headingStyle', title: 'Headings', note: 'How `#` and `##` headings draw. Terminals have one font size, so headings stand out through style and color.', options: ['banner', 'bold', 'underline', 'uppercase'], sample: '# Release notes\n\n## Fixes\n\nTables keep their width.' },
  { name: 'copy', key: 'copyButtonStyle', title: 'Copy buttons', note: 'Where the copy buttons on tables, code, diagrams and replies sit. `inline` shows them beside or above each block. `hover` puts a dim ⧉ beside each block instead and shows its buttons only while the pointer is on that ⧉, so they take no line; ctrl+x tab does not reach a hidden one, and the mobile app draws them inline. Needs `copyButtons` on.', options: ['inline', 'hover'], sample: '' },
  { name: 'prompts', key: 'promptStyle', title: 'Your prompts', note: 'How what you type draws in the transcript. `off` keeps Claude Code\'s own look.', options: ['bubble', 'wide', 'bar', 'chevron', 'off'], sample: '' },
  { name: 'clock', key: 'clock', title: 'Times', note: 'Whether your prompts show when you sent them. A time from another day gets its date.', options: ['off', '24h', '12h'], sample: '' },
  { name: 'tools', key: 'toolStyle', title: 'Tool rows', note: 'How tool rows sit next to Claude\'s sentences. Sharing sessions as screenshots? `chat` and `tree-dim` draw tool rows in dim gray, the first thing to blur when an image gets resized, so pick `tree-bold` or `classic`. Needs `toolRows` on.', options: ['chat', 'tree-dim', 'tree-bold', 'classic'], sample: '' },
  { name: 'output', key: 'toolOutput', title: 'Tool output', note: 'How much of a tool call shows. `full` keeps Claude Code\'s own results under each row. `quiet` names a shell call by what it does and shows a failure\'s last real line instead of its whole output; it also shows reads, searches and listings as their row only and drops approval lines. Edits keep their diff either way. Needs `toolRows` on.', options: ['full', 'quiet'], sample: '' },
  { name: 'diffs', key: 'diffStyle', title: 'Diffs', note: 'How an edit or a new file draws under its row. `card` frames the lines in a rounded box, `full` drops the box and tints each changed line across the width, `marks` drops the tint and colors only the `+` and `−` marks, `bar` puts a colored `▌` before each changed line. Every look highlights the code and the words that changed. Needs `toolRows` on.', options: ['card', 'full', 'marks', 'bar'], sample: '' },
  { name: 'pies', key: 'pieStyle', title: 'Pie charts', note: 'How mermaid `pie` charts draw. `round` falls back to bars in ascii mode, with more slices than the theme has distinct colors (mono always) or in a narrow terminal.', options: ['round', 'bars'], sample: '```mermaid\npie title Time per reply stage\n    "Draw" : 9\n    "Paint" : 5\n    "Parse" : 3\n```' },
]

export type SetupParts = { head: string; options: { value: string; text: string }[]; tail: string }

export const setupParts = (themes: readonly string[], at: number): SetupParts => {
  const steps = setupSteps(themes)
  const step = steps[at]!
  const next = steps[at + 1]
  return {
    head: `## Setup ${at + 1}/${steps.length}: ${step.title}\n\n${step.note}`,
    options: step.options.map((value, i) => ({ value, text: `### ${i + 1}. ${value}${step.key === 'theme' && value !== 'mono' && !RANDOM_THEMES.includes(value) ? ' (for a light terminal)' : ''}${step.sample ? `\n\n${step.sample}` : ''}` })),
    tail: `Pick with \`/merman setup ${step.name} <number or name>\`${step.key === 'theme' ? ' or `random`' : ''}.${next ? ` Skip with \`/merman setup ${next.name}\`.` : ''} Stop any time, \`/merman setup\` starts over.`,
  }
}

export const setupText = (parts: SetupParts): string => [parts.head, ...parts.options.map(o => o.text), parts.tail].join('\n\n')

export const THEME_PREVIEW = [
  '#### Release notes',
  '',
  '**Bold**, `inline code`, 250ms and ~/src/app.ts.',
  '',
  '| Service | Status | p95 |',
  '|:--|:--|--:|',
  '| api | healthy | 120ms |',
  '| billing | degraded | 840ms |',
  '',
  '```ts',
  'const total = items.reduce((sum, item) => sum + item.qty, 0)',
  '```',
].join('\n')

export const SETUP_PANE_OPENED = 'Setup opened in a pane: ↑↓ or Tab moves through the styles with a preview, Enter saves it and shows the next step, Esc closes the pane. `/merman setup theme` walks the steps here instead.'

export const SETUP_PANE_KEYS = '↑↓ or Tab moves, Enter saves and shows the next step, Esc closes.'

export const SETUP_DONE = 'Setup done. Run `/merman setup` again any time, and `/config` has every other option.'

export const findSetup = (themes: readonly string[], text: string): { at: number; before: string; parts: SetupParts } | undefined => {
  for (let at = 0; at < setupSteps(themes).length; at++) {
    const parts = setupParts(themes, at)
    const whole = setupText(parts)
    if (text.endsWith(whole)) return { at, before: text.slice(0, -whole.length).trim(), parts }
  }
  return undefined
}
