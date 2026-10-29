import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock } from 'claude-code/testing'
import { test } from './tool-rows'

import { helpText, setupParts, setupText, showcaseText } from '../hooks/help'
import { inlineText, parse } from '../hooks/markdown'
import { tableHtml, tableText } from '../hooks/html'
import { inlineMarks, mermaidText, shortenEdgeLabels } from '../hooks/mermaid'
import type { TerminalEnv } from '../hooks/render'
import { drawsHyperlinks, isReadOnlyCall, renderBashEdits, renderBlocks, tableArt, takesClickableMarks, takesEditorLinks, takesHttpLinks, width } from '../hooks/render'
import { PRESET_NAMES, PRESETS } from '../hooks/presets'
import { resolveStyle } from '../hooks/theme'
import { claudeAt, linksHttp } from './claude-version'
import { clipboardEnv, recordCopies, recordToasts } from './clipboard-env'
import { paintOf, runsOf, shownLines } from './paint'

const hl = { numbers: true, paths: true }

const tableOf = (source: string) => {
  const [table] = parse(source, hl)
  if (table?.kind !== 'table') throw new Error('not a table')
  return table
}

const mount = (text: string, columns = 120) => ({
  plugin: 'merman',
  component: 'AssistantMessage' as const,
  props: { text, isFirstOfReply: true },
  viewport: { columns, rows: 40 },
  surface: 'terminal' as const,
})

const drawn = (node: unknown): string =>
  typeof node === 'string' ? node : ((node as { children?: unknown[] }).children ?? []).map(drawn).join('')

const stubClipboard = (on: On) => {
  clipboardEnv(on, 'other')
  return recordCopies(on)
}

test('a long run of backticks parses in linear time', async () => {
  const started = Date.now()
  parse('`'.repeat(32000), hl)
  expect(Date.now() - started < 100).toBe(true)
})

test('a four-backtick fence keeps triple-backtick examples inside one code block', async () => {
  const blocks = parse('````md\n```bash\nls\n```\n````', hl)
  expect(blocks.map(b => b.kind)).toEqual(['code'])
  const [code] = blocks
  if (code?.kind !== 'code') throw new Error('not code')
  expect(code.lines).toEqual(['```bash', 'ls', '```'])
})

for (const [input, expected] of [
  ['## Using C#', [{ kind: 'text', text: 'Using C#' }]],
  ['## Title ##', [{ kind: 'text', text: 'Title' }]],
  ['[Foo](https://e.org/wiki/Foo_(bar)) ok', [{ kind: 'link', text: 'Foo', href: 'https://e.org/wiki/Foo_(bar)' }, { kind: 'text', text: ' ok' }]],
  ['see https://e.org/wiki/Foo_(bar) ok', [{ kind: 'text', text: 'see ' }, { kind: 'link', text: 'https://e.org/wiki/Foo_(bar)', href: 'https://e.org/wiki/Foo_(bar)' }, { kind: 'text', text: ' ok' }]],
  ['see (https://e.org/x) ok', [{ kind: 'text', text: 'see (' }, { kind: 'link', text: 'https://e.org/x', href: 'https://e.org/x' }, { kind: 'text', text: ') ok' }]],
  ['[`render.tsx`](hooks/render.tsx)', [{ kind: 'link', text: 'render.tsx', href: 'hooks/render.tsx' }]],
  ['call f(*args, **kwargs) now', [{ kind: 'text', text: 'call f(*args, **kwargs) now' }]],
  ['**a *b* c**', [{ kind: 'strong', children: [{ kind: 'text', text: 'a ' }, { kind: 'emphasis', children: [{ kind: 'text', text: 'b' }] }, { kind: 'text', text: ' c' }] }]],
  ['f(_a, _)', [{ kind: 'text', text: 'f(_a, _)' }]],
  ['f(*args, **kwargs) and **b**', [{ kind: 'text', text: 'f(*args, **kwargs) and ' }, { kind: 'strong', children: [{ kind: 'text', text: 'b' }] }]],
] as const) test(`inline markdown: ${input}`, async () => {
  const [block] = parse(input, hl)
  expect(block && 'inline' in block ? block.inline : block).toEqual(expected)
})

test('a one-dash delimiter row makes a table', async () => {
  const table = tableOf('| a | b |\n|-|-|\n| x | y |')
  expect(table.header.length).toBe(2)
  expect(table.rows.length).toBe(1)
})

test('an escaped trailing pipe stays in the cell', async () => {
  const [table] = parse('| a | b |\n|---|---|\n| x | y\\|', hl)
  if (table?.kind !== 'table') throw new Error('not a table')
  expect(table.rows[0]?.[1]?.map(n => ('text' in n ? n.text : '')).join('')).toBe('y|')
})

for (const surface of ['terminal', 'desktop'] as const) test(`tables copy their exact Markdown on ${surface}`, async ($, on) => {
  const copied = stubClipboard(on)
  const source = '| a | b |\n|:--|--:|\n| `x\\|y` | **2** |'
  const ui = await $.ui.mount({ ...mount(source), surface })
  await ui.press({ key: 'copy0' })
  expect(copied).toEqual([source])
  await ui.unmount()
})

test('tab-separated copying unescapes pipes and drops inline formatting', async () => {
  expect(tableText(tableOf('| a | b |\n|:--|--:|\n| `x\\|y` | **2** |'))).toBe('a\tb\nx|y\t2')
})

test('HTML table copying escapes content and preserves safe inline formatting', async () => {
  const source = '| <Title> | Link |\n|:--:|--|\n| **bold *italic*** ~~old~~ `x<y` & "quoted" | [go](https://example.com/?a=1&b="2") |\n| <script>alert | [bad](javascript:alert) |\n| short |'
  const html = tableHtml(tableOf(source))
  expect(html).toContain('<th style="text-align: center">&lt;Title&gt;</th>')
  expect(html).toContain('<em>italic</em>')
  expect(html).toContain('<del>old</del>')
  expect(html).toContain('<code style="white-space: pre-wrap">x&lt;y</code> &amp; &quot;quoted&quot;')
  expect(html).toContain('<a href="https://example.com/?a=1&amp;b=&quot;2&quot;">go</a>')
  expect(html).toContain('&lt;script&gt;alert')
  expect(html).not.toContain('javascript:')
  expect(html).toContain('<td style="text-align: left"></td>')
})

test('tab-separated copying quotes embedded separators and literal quotes', async () => {
  expect(tableText(tableOf('| Name | Value |\n|--|--|\n| `a\tb` | "quoted" |'))).toBe('Name\tValue\n"a\tb"\t"""quoted"""')
})

test('tab-separated copying keeps link targets', async () => {
  expect(tableText(tableOf('| Docs | Site |\n|--|--|\n| [guide](https://x.y/z) | https://a.b |'))).toBe('Docs\tSite\nguide (https://x.y/z)\thttps://a.b')
})

test('HTML copying preserves repeated spaces inside code', async () => {
  expect(tableHtml(tableOf('| Code |\n|--|\n| `a  b` |'))).toContain('<code style="white-space: pre-wrap">a  b</code>')
})

test('copying a list returns its exact markdown', async ($, on) => {
  const copied = stubClipboard(on)
  const source = '- **bold** item\n  - `code` child'
  const ui = await $.ui.mount(mount(source))
  const [button] = await ui.findAll({ type: 'Button' })
  await ui.press({ key: button!.key! })
  expect(copied).toEqual([source])
  await ui.unmount()
})

test('table columns never exceed the terminal width', async $ => {
  const ui = await $.ui.mount(mount('| a | bbbbbbbbbbbbbbbb | c | d | e |\n|---|---|---|---|---|\n| 1 | 2 | 3 | 4 | 5 |', 24))
  const cells = (await ui.findAll({ type: 'Box' })).filter(b => typeof b.props.width === 'number' && b.props.flexShrink === 0).slice(1)
  const firstRow = cells.slice(0, 5).map(b => b.props.width as number)
  expect(firstRow.reduce((a, b) => a + b, 0) + 2 * 4 <= 20).toBe(true)
  await ui.unmount()
})

test('a boxed row that wraps keeps its borders on every line', async $ => {
  const file = 'handoffs/handoff-scheduled-event-pushes-21082026.md'
  const evidence = 'Its blocking question is unanswered; BACKLOG row 16 cites it'
  const ui = await $.ui.mount(mount(`| File | Evidence |\n|---|---|\n| ${file} | ${evidence} |`, 40))
  const shown = await shownLines(ui)
  const top = shown.find(l => l.startsWith('┌'))!
  const rows = shown.slice(shown.findIndex(l => l.startsWith('╞')) + 1, shown.findIndex(l => l.startsWith('└')))
  expect(rows.length > 3).toBe(true)
  expect(rows.every(l => l.startsWith('│ ') && l.endsWith(' │') && width(l) === width(top))).toBe(true)
  const cells = rows.map(l => l.slice(2, -2).split(' │ ').map(c => c.trim()))
  expect(cells.map(c => c[0]).join('')).toBe(file)
  expect(cells.map(c => c[1]).join(' ')).toBe('Its blocking question is unanswered; BACKLOG row 16 cites it')
  expect((await ui.find({ type: 'Text', text: /^16$/ }))?.props.color).toBe(PRESETS['catppuccin-mocha'].number)
  await ui.unmount()
})

for (const [kind, cell] of [
  ['named link', 'see [docs](https://github.com/org/repo/blob/main/docs/spec.md) for more'],
  ['bare URL', 'https://example.com/a/rather/long/path/that/cannot/fit/on/one/line'],
] as const) {
  test(`a boxed row with a ${kind} keeps the link whole and clips its borders to the row`, async $ => {
    const ui = await $.ui.mount(mount(`| n | link |\n|---|---|\n| 1 | ${cell} |`, 40))
    const links = await ui.findAll({ type: 'Link' })
    const boxes = await ui.findAll({ type: 'Box' })
    const clips = boxes.filter(b => b.props.overflow === 'hidden' && b.props.height === 0)
    expect(links.length).toBe(1)
    expect(clips.length).toBe(3)
    expect(clips.every(b => drawn(b).split('\n').length > 2)).toBe(true)
    expect(boxes.some(b => b.props.position === 'absolute' && drawn(b).includes('│'))).toBe(false)
    await ui.unmount()
  })
}

test('a link column is sized for the URL it shows', async $ => {
  const url = 'https://example.com/a/rather/long/path'
  const ui = await $.ui.mount(mount(`| link | n |\n|---|---|\n| [go](${url}) | 1 |`))
  const cells = (await ui.findAll({ type: 'Box' })).filter(b => typeof b.props.width === 'number' && b.props.flexShrink === 0).slice(1)
  expect((cells[0]?.props.width as number) >= `go (${url})`.length).toBe(true)
  await ui.unmount()
})

test('highlight colors follow the theme in use: red', { options: { codeFlagColor: '#ff0000' } }, async $ => {
  const ui = await $.ui.mount(mount('```ts\nconst same = 1\n```'))
  expect((await ui.find({ type: 'Text', text: /^const$/ }))?.props.color).toBe('#ff0000')
  await ui.unmount()
})

test('highlight colors follow the theme in use: green', { options: { codeFlagColor: '#00ff00' } }, async $ => {
  const ui = await $.ui.mount(mount('```ts\nconst same = 1\n```'))
  expect((await ui.find({ type: 'Text', text: /^const$/ }))?.props.color).toBe('#00ff00')
  await ui.unmount()
})

test('presets stay intact', async () => {
  expect(PRESETS.dracula.tableHeader).toBe('#f1fa8c')
})

test('code blocks draw no frame, so a mouse selection copies only the code', async $ => {
  const ui = await $.ui.mount(mount('```bash\nls -la\n```'))
  expect((await ui.findAll({ type: 'Box' })).some(b => b.props.borderStyle !== undefined)).toBe(false)
  await ui.unmount()
})

test('stadium, cylinder and arrow-joined boxes get colors, containers stay plain', async $ => {
  const t = PRESETS['catppuccin-mocha']
  const source = '```mermaid\ngraph LR\n  subgraph S [Group]\n    A[Edge]\n  end\n  U([Users]) --> A\n  A --> DB[(db)]\n  B[Backup] --> A\n```'
  const ui = await $.ui.mount(mount(source, 160))
  const color = async (re: RegExp) => (await runsOf(ui, re))[0]?.paint.color
  for (const label of [/^Users$/, /^Edge$/, /^db$/, /^Backup$/]) {
    const c = await color(label)
    expect(c !== undefined && c !== t.diagramText).toBe(true)
  }
  const group = (await runsOf(ui, /^Group$/)).find(s => s.paint.color !== undefined)
  expect(group?.paint.color).toBe(t.diagramText)
  await ui.unmount()
})

test('an edge label after a space still draws both nodes', async $ => {
  const ui = await $.ui.mount(mount('```mermaid\ngraph LR\n  A --> |deploy| B\n```', 160))
  expect((await runsOf(ui, /^B$/)).length).toBeGreaterThan(0)
  expect(await ui.find({ type: 'Text', text: /deploy/ })).toBeDefined()
  await ui.unmount()
})

test('copying a quote returns its text without the > markers', async ($, on) => {
  const copied = stubClipboard(on)
  const ui = await $.ui.mount(mount('> built a mod\n> with **colors**'))
  const [button] = await ui.findAll({ type: 'Button' })
  await ui.press({ key: button!.key! })
  expect(copied).toEqual(['built a mod\nwith **colors**'])
  await ui.unmount()
})

test('edge labels with spaces keep the line out of their gaps', async $ => {
  const ui = await $.ui.mount(mount('```mermaid\ngraph TD\n  A -->|push = build| B\n```', 160))
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts.some(t => t.includes('push = build'))).toBe(true)
  expect(texts.some(t => t.includes('push =│build'))).toBe(false)
  await ui.unmount()
})

test('a chart that opens with a %% comment still draws', async $ => {
  const ui = await $.ui.mount(mount('```mermaid\n%% weekly deploys\nxychart-beta\n  x-axis [a, b]\n  bar [1, 2]\n```', 160))
  expect((await ui.findAll({ type: 'Text' })).some(t => /^█+$/.test(t.text))).toBe(true)
  await ui.unmount()
})

test('a left-to-right flowchart too wide for the terminal draws top-down instead of as source', async () => {
  const chain = ['flowchart LR', ...['A', 'B', 'C', 'D', 'E'].map((n, i, a) => (i ? `  ${a[i - 1]} --> ${n}["step ${n} with a long label"]` : '')).filter(Boolean)].join('\n')
  const art = mermaidText(chain, false, 100)
  expect(art).not.toBeNull()
  expect(art!.split('\n').every(l => width(l) <= 98)).toBe(true)
  expect(art).toContain('▼')
})

test('a GitHub alert draws its title and body, and copies without the > markers', async ($, on) => {
  const copied = stubClipboard(on)
  const ui = await $.ui.mount(mount('> [!WARNING]\n> disk is almost full'))
  expect(await ui.find({ type: 'Text', text: /^Warning$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^disk is almost full$/ })).toBeDefined()
  const [button] = await ui.findAll({ type: 'Button' })
  await ui.press({ key: button!.key! })
  expect(copied).toEqual(['[!WARNING]\ndisk is almost full'])
  await ui.unmount()
})

test('a bar chart shows each value, drops label quotes and highlights the tallest bar', async $ => {
  const ui = await $.ui.mount(mount('```mermaid\nxychart-beta\n  x-axis ["Q1", "Q2", "Q3"]\n  bar [5, 12, 8]\n```', 160))
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts.some(t => /\b12\b/.test(t) && !t.includes('┤'))).toBe(true)
  expect(texts.some(t => t.includes('"'))).toBe(false)
  await ui.unmount()
})

test('H1 gets a box and H2 a heavy rule by default', async $ => {
  const ui = await $.ui.mount(mount('# Title\n\n## Section'))
  expect(await ui.find({ type: 'Text', text: /^━+$/ })).toBeDefined()
  expect(await ui.find({ type: 'Box', text: /Title/ })).toBeDefined()
  await ui.unmount()
})

test('chart labels never run together', async $ => {
  const ui = await $.ui.mount(mount('```mermaid\nxychart-beta\n  x-axis [Dog, Human, Pigeon, Shrimp]\n  bar [2, 3, 4, 16]\n```', 120))
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts.some(t => /Human\s+Pigeon\s+Shrimp/.test(t))).toBe(true)
  await ui.unmount()
})

const best = (fn: () => void, runs = 5) => {
  let min = Infinity
  for (let i = 0; i < runs; i++) {
    const t = performance.now()
    fn()
    min = Math.min(min, performance.now() - t)
  }
  return min
}

const rows = (n: number) => `| id | name | pods |\n|---|---|---|\n${Array.from({ length: n }, (_, i) => `| ${i} | svc-${i} | ${i * 3} |`).join('\n')}`
const prose = (n: number) => Array.from({ length: n }, (_, i) => `Paragraph ${i} with **bold**, \`code\`, 99.9% and ~/src/app.ts here.\n\n- item ${i}\n- item ${i + 1}`).join('\n\n')
const quoted = (n: number) => prose(n).split('\n').map((line, i) => `${i % 3 ? '> > ' : '> '}${line}`).join('\n')

test('parse cost grows linearly with reply size', async () => {
  for (const make of [rows, prose, quoted]) {
    parse(make(200), hl)
    const small = Math.max(best(() => parse(make(200), hl)), 0.05)
    const large = best(() => parse(make(2000), hl))
    expect(large < small * 40).toBe(true)
  }
})

test('parse stays inside a generous budget on a large reply', async () => {
  expect(best(() => parse(prose(2000), hl)) < 250).toBe(true)
  expect(best(() => parse(rows(2000), hl)) < 250).toBe(true)
})

test('a 300-row table draws inside its budget', async $ => {
  const started = performance.now()
  const ui = await $.ui.mount(mount(rows(300), 160))
  expect(performance.now() - started < 1500).toBe(true)
  await ui.unmount()
})

test('a 400-line highlighted code block stays under the engine node limit and its time budget', async $ => {
  const code = `\`\`\`ts\n${Array.from({ length: 400 }, (_, i) => `const v${i} = await fetch("/api/${i}", { retries: ${i % 5} })`).join('\n')}\n\`\`\``
  const started = performance.now()
  const ui = await $.ui.mount(mount(code, 160))
  expect(performance.now() - started < 1500).toBe(true)
  await ui.unmount()
})

test('a half-streamed reply with an open fence and a cut table still draws', async $ => {
  for (const text of ['intro\n\n```mermaid\nflowchart LR\n  A --> B', '| a | b |\n|---|', '```ts\nconst x =', '> [!NOTE', '**bold and `cod', '> - item\n> ```ts\n> const x =', '> | a | b |\n> |---|', '> > [!NOTE', '> [!TIP]\n>']) {
    const ui = await $.ui.mount(mount(text))
    expect(await ui.findAll({ type: 'Text' })).toBeDefined()
    await ui.unmount()
  }
})

test('a line holding only a tag draws dim on its own, never as a path or joined to the paragraph next to it', () => {
  const blocks = parse('Answer text.\n\n<tldr>\n- First point, see /tmp/example.\n\nA closing sentence.\n</tldr>', hl)
  expect(blocks.map(b => b.kind)).toEqual(['paragraph', 'paragraph', 'list', 'paragraph', 'paragraph'])
  expect(blocks[1]).toMatchObject({ inline: [{ kind: 'dim', text: '<tldr>' }], raw: '<tldr>' })
  expect(blocks[3]?.raw).toBe('A closing sentence.')
  expect(blocks[4]).toMatchObject({ inline: [{ kind: 'dim', text: '</tldr>' }], raw: '</tldr>' })
  expect(parse('a <b>bold</b> word\n<br/>', hl).map(b => b.kind === 'paragraph' && b.inline.some(n => n.kind === 'dim'))).toEqual([false])
})

test('figure role markup outside a figure draws as its text in table cells and prose, and code keeps it', () => {
  const [table] = parse('| Tool | Fits a sidecar? |\n|---|---|\n| A | {ok:✓} single binary |\n| B | {warn:✗} needs tinyproxy |', hl)
  expect(table?.kind === 'table' && table.rows.map(row => inlineText(row[1]!))).toEqual(['✓ single binary', '✗ needs tinyproxy'])
  const [prose] = parse('Also {ok:healthy} and **{strong:bold}**, but `{ok:1}`, {err:x} and {id:42} stay.', hl)
  expect(prose?.kind === 'paragraph' && inlineText(prose.inline)).toBe('Also healthy and bold, but {ok:1}, {err:x} and {id:42} stay.')
})

test('the help screen shows every element merman draws', async () => {
  const blocks = parse(showcaseText(Object.keys(PRESETS)), hl)
  expect(showcaseText(Object.keys(PRESETS))).toContain('promptStyle')
  expect(showcaseText(Object.keys(PRESETS))).toContain('`wide`')
  expect(showcaseText(Object.keys(PRESETS))).toContain('A paste of 4 lines or more')
  expect(showcaseText(Object.keys(PRESETS))).toContain('`clock`')
  expect(showcaseText([])).toContain('⧉ html')
  expect(showcaseText([])).toContain('`▣ png`')
  expect(showcaseText([])).toContain('src/app.ts:42, and Windows paths like C:\\work\\plan.md')
  expect(showcaseText([])).toContain('<i>Reply</i>')
  expect(showcaseText([])).toContain('CopyQ')
  expect(showcaseText([])).toContain('plain text')
  expect(showcaseText([])).toContain('line "east" [')
  expect(showcaseText([])).toContain('System_Boundary(cc, "Claude Code") {')
  expect(showcaseText([])).toContain('!include <C4/C4_Context>')
  expect(blocks.some(b => b.kind === 'table' && b.align.includes('right') && b.align.includes('center'))).toBe(true)
  const kinds = new Set(blocks.map(b => b.kind))
  for (const kind of ['heading', 'paragraph', 'list', 'code', 'quote', 'alert', 'rule', 'table']) expect(kinds.has(kind as never)).toBe(true)
  expect(blocks.some(b => b.kind === 'quote' && b.blocks.filter(c => c.kind === 'paragraph').length >= 2 && b.blocks.some(c => c.kind === 'list') && b.blocks.some(c => c.kind === 'quote'))).toBe(true)
  expect(new Set(blocks.flatMap(b => (b.kind === 'heading' ? [b.level] : []))).size >= 4).toBe(true)
  expect(new Set(blocks.flatMap(b => (b.kind === 'alert' ? [b.level] : []))).size).toBe(5)
  const langs = blocks.flatMap(b => (b.kind === 'code' ? [b.lang] : []))
  for (const lang of ['bash', 'json', 'mermaid', 'math']) expect(langs.includes(lang)).toBe(true)
  const links = blocks.flatMap(b => (b.kind === 'paragraph' ? b.inline.filter(n => n.kind === 'link') : []))
  expect(links.some(l => l.kind === 'link' && l.text !== l.href) && links.some(l => l.kind === 'link' && l.text === l.href)).toBe(true)
  expect(links.some(l => l.kind === 'link' && l.href.endsWith('Foo_(bar)')) && links.some(l => l.kind === 'link' && l.text === 'render.tsx')).toBe(true)
  expect(links.some(l => l.kind === 'link' && l.href === `file://${l.text}`) && links.some(l => l.kind === 'link' && l.href.startsWith('file:///') && l.href !== `file://${l.text}`)).toBe(true)
  expect(blocks.some(b => b.kind === 'paragraph' && b.inline.some(n => n.kind === 'path' && n.text.startsWith('./')) && b.inline.some(n => n.kind === 'path' && n.text.startsWith('~/')))).toBe(true)
  expect(showcaseText([])).toContain('open on click in a terminal that draws hyperlinks')
  expect(showcaseText([])).toContain('/tmp/app.ts open on click')
  expect(showcaseText([])).toContain('slash commands like /config stay text')
  expect(showcaseText([])).toContain('the file each one read or edited opens on click')
  expect(showcaseText([])).toContain('f(*args, **kwargs)')
  expect(showcaseText([])).toContain('Programs and launchers stay plain text')
  expect(blocks.some(b => b.kind === 'paragraph' && b.inline.some(n => n.kind === 'path' && n.text.endsWith('.sh')) && b.inline.some(n => n.kind === 'path' && n.text.endsWith('.app')))).toBe(true)
  expect(blocks.some(b => b.kind === 'list' && b.items.some(i => i.task === true) && b.items.some(i => i.task === false) && b.items.some(i => i.depth > 0 && i.task !== undefined))).toBe(true)
  expect(kinds.has('notes')).toBe(true)
  expect(blocks.some(b => b.kind === 'paragraph' && b.inline.length === 1 && b.inline[0]?.kind === 'dim' && b.raw === '</summary>')).toBe(true)
  expect(blocks.some(b => b.kind === 'table' && b.header.some(h => h.some(n => n.kind === 'footnote')))).toBe(true)
  expect(showcaseText([])).toContain('Click a mark to see its note')
  expect(showcaseText([]).includes("toolStyle")).toBe(true)
  expect(showcaseText([]).includes("toolOutput")).toBe(true)
  expect(showcaseText([])).toContain('copyButtonStyle')
  expect(showcaseText([])).toContain('each block shows a dim ⧉ instead: point at it for its buttons')
  expect(showcaseText([])).toContain('+M more lines')
  expect(showcaseText([])).toContain('```figure')
  expect(showcaseText([])).toContain('lined up with its corner')
  expect(showcaseText([])).toContain('pie showData')
  expect(showcaseText([])).toContain('Release  :milestone')
  expect(blocks.some(b => b.kind === 'code' && b.lines.length > 30)).toBe(true)
  expect(showcaseText([])).toContain('diff card headed `+N −M`')
  expect(showcaseText([])).toContain('code highlighted in the file\'s language')
  expect(showcaseText([])).toContain('the changed words in a deeper tint')
  expect(showcaseText([])).toContain('Files a shell command changes')
  expect(showcaseText([])).toContain('Set `diffStyle` in `/config` for the look: `card`, `full`, `marks` or `bar`')
  expect(showcaseText([])).toContain('Set `pieStyle` to `bars` in `/config` for one bar per slice')
  expect(showcaseText([])).toContain("A file Write creates shows its first 10 lines as numbered code in the theme's colors with no diff marks")
  expect(showcaseText([])).toContain('A file an Edit or a shell command creates shows its first 10 lines as added lines under `Created`')
  expect(showcaseText([])).toContain('one `Deleted` line that opens to its removed lines on a click')
  expect(showcaseText([])).toContain('one `Renamed old → new` line')
  expect(showcaseText([])).not.toContain('diffAddedColor')
})

test('mermaid boxes stay closed around wide labels', async () => {
  const column = (line: string, marks: RegExp, nth: number) => {
    const chars = [...line]
    const at = chars.flatMap((ch, i) => (marks.test(ch) ? [i] : []))[nth]
    return at === undefined ? -1 : width(chars.slice(0, at).join(''))
  }
  for (const source of ['graph LR\n  A[日本語テスト] --> B[終了]', 'flowchart TD\n  A[한글 라벨 상자] --> B{ko 섞인 판단}', 'sequenceDiagram\n  사용자->>서버: 요청']) {
    const art = mermaidText(source, false, 100)
    expect(art).not.toBeNull()
    expect(art!).not.toContain('\uFDD0')
    const lines = art!.split('\n')
    const top = lines.findIndex(l => l.includes('┐'))
    expect(column(lines[top + 1]!, /[│├┤]/, 1)).toBe(column(lines[top]!, /┐/, 0))
  }
})

test('flowchart edges written without spaces draw the same as with spaces', async () => {
  for (const [compact, spaced] of [
    ['flowchart LR\n  A-->B-->C', 'flowchart LR\n  A --> B --> C'],
    ['flowchart LR\n  my-node-->other-node', 'flowchart LR\n  my-node --> other-node'],
    ['graph TD\n  A-.->B==>C---D', 'graph TD\n  A -.-> B ==> C --- D'],
    ['flowchart LR\n  A-->|yes|B', 'flowchart LR\n  A -->|yes| B'],
    ['flowchart LR\n  A[Start]-->B{ok?}', 'flowchart LR\n  A[Start] --> B{ok?}'],
  ]) {
    const art = mermaidText(spaced!, false, 100)
    expect(art).not.toBeNull()
    expect(mermaidText(compact!, false, 100)).toBe(art)
  }
})

test('a mounted diagram with wide labels draws its box borders on the same column', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...mount('```mermaid\ngraph LR\n  A[한글 라벨] --> B[終了]\n```', 160), surface })
    const label = drawn(await ui.find({ type: 'Text', text: /한글 라벨/ }))
    const top = drawn(await ui.find({ type: 'Text', text: /┐/ }))
    expect(label).not.toContain('\uFDD0')
    expect(width(label.trimEnd())).toBe(width(top.trimEnd()))
    await ui.unmount()
  }
})

test('every diagram on the help screen draws as art', async () => {
  const diagrams = parse(showcaseText(Object.keys(PRESETS)), hl).flatMap(b => (b.kind === 'code' && b.lang === 'mermaid' ? [b.lines.join('\n')] : []))
  expect(diagrams.length).toBe(8)
  for (const source of diagrams) expect(mermaidText(source, false, 100)).not.toBeNull()
})

test('the help screen fits one screen: few blocks, two alerts, a table, a list and two drawn charts', async () => {
  const blocks = parse(helpText(Object.keys(PRESETS)), hl)
  expect(blocks.length <= 12).toBe(true)
  expect(blocks.filter(b => b.kind === 'alert').length).toBe(2)
  for (const kind of ['heading', 'table', 'list']) expect(blocks.some(b => b.kind === kind)).toBe(true)
  expect(blocks.some(b => b.kind === 'list' && b.items.some(i => i.task !== undefined))).toBe(true)
  expect(blocks.some(b => b.kind === 'paragraph' && b.inline.some(n => n.kind === 'link'))).toBe(true)
  expect(helpText(Object.keys(PRESETS))).toContain('/merman copy')
  expect(helpText([])).toContain('`/merman setup`')
  expect(showcaseText([])).toContain('`/merman setup`')
  expect(helpText([])).toContain('`random`')
  expect(showcaseText([])).toContain('/merman theme random')
  expect(helpText([])).toContain('HTML (macOS/Linux)')
  expect(helpText([])).toContain('PNG image (macOS/Windows)')
  const diagrams = blocks.flatMap(b => (b.kind === 'code' && b.lang === 'mermaid' ? [b.lines.join('\n')] : []))
  expect(diagrams.length).toBe(2)
  for (const source of diagrams) expect(mermaidText(source, false, 100)).not.toBeNull()
})

test('the help screen draws as command output', async $ => {
  const ui = await $.ui.mount({
    plugin: 'merman',
    component: 'CommandOutput' as const,
    props: { command: 'merman', args: 'demo', text: showcaseText(Object.keys(PRESETS)), isErrored: false },
    viewport: { columns: 100, rows: 40 },
    surface: 'terminal' as const,
  })
  expect(await ui.find({ type: 'Box', text: /merman/ })).toBeDefined()
  await ui.unmount()
})

test('drawn replies add no emoji-capable glyphs', async $ => {
  const text = ['sequenceDiagram\n  A->>B: go\n  B-->>A: ok', 'classDiagram\n  direction LR\n  A <|-- B\n  C --> D', 'graph RL\n  A-->B'].map(d => '```mermaid\n' + d + '\n```').join('\n\n')
  const figure = ['```figure', 'a {accent:──▶} b {accent:◀──} c', '```'].join('\n')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...mount(`${text}\n\n${figure}`), surface })
    expect((await ui.find({ type: 'Text', text: /\p{Extended_Pictographic}/u }))?.text).toBeUndefined()
    await ui.unmount()
  }
})

test('a table art button copies boxed text ready for Slack', async ($, on) => {
  const copied = stubClipboard(on)
  const ui = await $.ui.mount(mount('| Queue | Sent |\n|---|--:|\n| tasks-east | 24 |\n| west | 0 |'))
  const art = (await ui.findAll({ type: 'Button' }))[1]
  await ui.press({ key: art!.key! })
  expect(copied).toEqual([[
    '```',
    '┌────────────┬──────┐',
    '│   Queue    │ Sent │',
    '├────────────┼──────┤',
    '│ tasks-east │   24 │',
    '├────────────┼──────┤',
    '│ west       │    0 │',
    '└────────────┴──────┘',
    '```',
  ].join('\n')])
  await ui.unmount()
})

test('bidi marks take no column, so a table cell that holds one is not drawn a column too wide', async () => {
  expect(width('\u200f13/10')).toBe(5)
  expect(width('\u200ekubectl\u200e')).toBe(7)
  expect(width('\u2067שלום\u2069')).toBe(4)
  const [table] = parse('| day | result |\n|---|---|\n| \u200f13/10 | ok |', hl)
  if (table?.kind !== 'table') throw new Error('not a table')
  expect(tableArt(table).split('\n')[1]!.split('┬')[0]).toBe(`┌${'─'.repeat(7)}`)
})

test('wide table art wraps long cells to stay 100 columns wide', async () => {
  const long = 'Wrong. With no default, databag_config raises No config key is found, so the render fails and nothing is applied, which is the fail-closed behaviour we want.'
  const [table] = parse(`| Codebot says | Verdict |\n|---|---|\n| A missing x_seen_by renders an empty value | ${long} |`, hl)
  if (table?.kind !== 'table') throw new Error('not a table')
  const lines = tableArt(table).split('\n')
  const body = lines.slice(1, -1)
  expect(body.every(l => [...l].length === [...body[0]!].length && [...l].length <= 100)).toBe(true)
  expect(body.length > 6).toBe(true)
  expect(body.filter(l => l.startsWith('│')).slice(1).map(l => l.split('│')[2]!.trim()).join(' ')).toBe(long)
})

test('short table columns keep their width next to a very wide one', async () => {
  const links = Array.from({ length: 4 }, (_, i) => `https://example.com/releases/${100 + i}/notes`).join(' , ')
  const [table] = parse(`| # | Pri | Task | Link |\n|---|---|---|---|\n| 10 | 🔵 P2 | Approved, not merged | ${links} |`, hl)
  if (table?.kind !== 'table') throw new Error('not a table')
  const cells = tableArt(table).split('\n').slice(1, -1).filter(l => l.startsWith('│')).map(l => l.split('│').slice(1, 4).map(c => c.trim()))
  expect(cells[1]).toEqual(['10', '🔵 P2', 'Approved, not merged'])
})

test('table art keeps a long path whole when the other wide column can give way', async () => {
  const path = 'src/services/reporting/exports/monthly_pdf_writer.py'
  const change = 'The monthly export now writes one summary file per region and uploads them after the nightly run is done'
  const [table] = parse(`| # | File | Change |\n|---|---|---|\n| 1 | ${path} | ${change} |`, hl)
  if (table?.kind !== 'table') throw new Error('not a table')
  expect(tableArt(table).split('\n').some(l => l.includes(path))).toBe(true)
})

test('copy reply copies the whole reply as written, Hebrew in reading order', { options: { rtl: 'warp' } }, async ($, on) => {
  const copied = stubClipboard(on)
  const text = 'שלום חברים, זו הדגמה של merman.\n\n| a | b |\n|---|---|\n| 1 | 2 |'
  const ui = await $.ui.mount(mount(text))
  const reply = (await ui.findAll({ type: 'Button' })).find(b => b.props.label === '⧉ copy reply')
  await ui.press({ key: reply!.key! })
  expect(copied).toEqual([text])
  await ui.unmount()
})

test('a one-paragraph English block gets no copy reply button', async $ => {
  const ui = await $.ui.mount(mount('Checking the tests next.'))
  expect((await ui.findAll({ type: 'Button' })).some(b => b.props.label === '⧉ copy reply')).toBe(false)
  await ui.unmount()
})

test('only http, https and file links become terminal hyperlinks', async ($, on) => {
  claudeAt(on, '2.1.289')
  mock.env(on, {})
  if (!(await linksHttp($.ui.mount(mount('[x](http://example.com)'))))) return
  const ui = await $.ui.mount(mount('[docs](https://example.com) [dev](http://localhost:3000) [plain](http://example.com) [mail](mailto:a@example.com) [run](javascript:alert(1)) [/etc/passwd](file:///etc/passwd)'))
  const links = (await ui.findAll({ type: 'Link' })).map(l => l.props.href)
  expect(links).toEqual(['https://example.com', 'http://localhost:3000', 'http://example.com', 'file:///etc/passwd'])
  expect(await paintOf(ui, 'run (javascript:alert(1))')).toBeDefined()
  await ui.unmount()
})

test('a named link drops its own underline so the terminal hyperlink style shows', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...mount('[merman on GitHub](https://github.com/iamrohithrnair/merman)'), surface })
    const [link] = await ui.findAll({ type: 'Link' })
    const label = await ui.find({ type: 'Text', text: /^merman on GitHub$/ })
    expect(link?.props.href).toBe('https://github.com/iamrohithrnair/merman')
    expect(label?.props.color).toBe(PRESETS['catppuccin-mocha'].link)
    expect(label?.props.underline).toBeFalsy()
    await ui.unmount()
  }
})

test('plain http links and bare URLs are hyperlinks drawn in the link color on the terminal', async ($, on) => {
  claudeAt(on, '2.1.289')
  if (!(await linksHttp($.ui.mount(mount('[x](http://example.com)'))))) return
  const ui = await $.ui.mount(mount('[plain http](http://example.com) http://example.org/raw https://example.com/raw'))
  expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toEqual(['http://example.com', 'http://example.org/raw', 'https://example.com/raw'])
  for (const text of [/^plain http$/, /^http:\/\/example\.org\/raw$/, /^https:\/\/example\.com\/raw$/]) {
    const drawnText = await ui.find({ type: 'Text', text })
    expect(drawnText?.props.color).toBe(PRESETS['catppuccin-mocha'].link)
    expect(drawnText?.props.underline).toBeFalsy()
  }
  await ui.unmount()
})

for (const [where, surface, base] of [
  ['on desktop, which links only https', 'desktop', '2.1.289'],
  ['on Claude Code 2.1.288, which refuses http hyperlinks', 'terminal', '2.1.288'],
  ['when the Claude Code version is unknown', 'terminal', undefined],
] as const) {
  test(`plain http links draw as plain text ${where}`, async ($, on) => {
    if (base) claudeAt(on, base)
    const ui = await $.ui.mount({ ...mount('[plain http](http://example.com) http://example.org/raw https://example.com/raw'), surface })
    expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toEqual(['https://example.com/raw'])
    for (const text of ['plain http (http://example.com)', 'http://example.org/raw']) {
      const drawnText = await paintOf(ui, text)
      expect(drawnText).toBeDefined()
      expect(drawnText?.color).toBeUndefined()
    }
    expect((await paintOf(ui, 'https://example.com/raw'))?.color).toBe(PRESETS['catppuccin-mocha'].link)
    await ui.unmount()
  })
}

test('http hyperlinks start at Claude Code 2.1.289', () => {
  for (const base of ['2.1.289', '2.1.289-dev', '2.1.296', '2.1.1000', '2.2.0', '3.0.0']) expect(takesHttpLinks(base)).toBe(true)
  for (const base of ['2.1.288', '2.1.287', '2.0.999', '1.9.400', 'dev', '', undefined]) expect(takesHttpLinks(base)).toBe(false)
})

const EDITOR_LINKS = '[note](vscode://file/C:/src/notes.md:12) [insiders](vscode-insiders://file/home/me/app.ts) [cursor](cursor://file/C:/src/app.ts:3:5) [windsurf](windsurf://file/home/me/run.py:7) [zed](zed://file/home/me/main.rs:9:2) [clone](vscode://vscode.git/clone?url=https://example.com/x.git) [zclone](zed://git/clone?repo=https://example.com/x.git) [settings](zed://settings)'

test('Editor file links become terminal hyperlinks from Claude Code 2.1.294', async ($, on) => {
  claudeAt(on, '2.1.294')
  if (!(await linksHttp($.ui.mount(mount('[x](vscode://file/C:/x.md)'))))) return
  const ui = await $.ui.mount(mount(EDITOR_LINKS))
  expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toEqual([
    'vscode://file/C:/src/notes.md:12',
    'vscode-insiders://file/home/me/app.ts',
    'cursor://file/C:/src/app.ts:3:5',
    'windsurf://file/home/me/run.py:7',
    'zed://file/home/me/main.rs:9:2',
  ])
  expect(await paintOf(ui, 'clone (vscode://vscode.git/clone?url=https://example.com/x.git)')).toBeDefined()
  expect(await paintOf(ui, 'zclone (zed://git/clone?repo=https://example.com/x.git)')).toBeDefined()
  expect(await paintOf(ui, 'settings (zed://settings)')).toBeDefined()
  await ui.unmount()
})

for (const [where, surface, base] of [
  ['on desktop, which links only https', 'desktop', '2.1.294'],
  ['on Claude Code 2.1.293', 'terminal', '2.1.293'],
  ['when the Claude Code version is unknown', 'terminal', undefined],
] as const) {
  test(`Editor file links draw as plain text ${where}`, async ($, on) => {
    if (base) claudeAt(on, base)
    const ui = await $.ui.mount({ ...mount(EDITOR_LINKS), surface })
    expect(await ui.findAll({ type: 'Link' })).toHaveLength(0)
    expect(await paintOf(ui, 'note (vscode://file/C:/src/notes.md:12)')).toBeDefined()
    expect(await paintOf(ui, 'zed (zed://file/home/me/main.rs:9:2)')).toBeDefined()
    await ui.unmount()
  })
}

test('Editor file hyperlinks start at Claude Code 2.1.294', () => {
  for (const base of ['2.1.294', '2.1.294-dev', '2.1.296', '2.1.1000', '2.2.0', '3.0.0']) expect(takesEditorLinks(base)).toBe(true)
  for (const base of ['2.1.293', '2.1.289', '2.1.287', '2.0.999', 'dev', '', undefined]) expect(takesEditorLinks(base)).toBe(false)
})

const PATHS = 'Open /srv/app/main.ts, ~/notes/todo.md or ./docs/guide.md.\n\n- Line 12 of ~/notes/list.md:12\n\n| file | rows |\n|---|---|\n| /srv/data/table.csv | 4 |'

const PATH_TEXTS = ['/srv/app/main.ts', '~/notes/todo.md', './docs/guide.md.', '~/notes/list.md', '/srv/data/table.csv']

const pathColored = async (ui: { findAll: (query: { type: 'Text'; text: RegExp }) => Promise<{ props: { color?: unknown } }[]> }) => {
  for (const text of PATH_TEXTS) {
    const found = await ui.findAll({ type: 'Text', text: exact(text) })
    if (!found.some(n => n.props.color === PRESETS['catppuccin-mocha'].path)) return false
  }
  return true
}

const filesAt = (on: On, base: string | undefined, env: Record<string, string> = {}) => {
  if (base) claudeAt(on, base)
  mock.env(on, { FORCE_HYPERLINK: '1', HOME: '/home/me', ...env })
  on('session.root', () => ({ value: '/work/app' }))
}

const withoutLinks = (node: unknown): unknown => {
  if (node === null || typeof node !== 'object') return node
  const { type, props, children } = node as { type?: string; props?: Record<string, unknown>; children?: unknown[] }
  if (type === 'Link') return props?.label
  const { key: _key, ...rest } = props ?? {}
  return { type, props: rest, children: children?.map(withoutLinks) }
}

for (const [where, env, root] of [
  ['outside WSL', {}, 'file://'],
  ['under WSL', { WSL_DISTRO_NAME: 'Ubuntu' }, 'file://wsl.localhost/Ubuntu'],
] as const) {
  test(`paths in a paragraph, a list and a table link to their files ${where}`, async ($, on) => {
    filesAt(on, '2.1.289', env)
    if (!(await linksHttp($.ui.mount(mount('[/x](file:///x)'))))) return
    const ui = await $.ui.mount(mount(PATHS))
    expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toEqual(
      ['/srv/app/main.ts', '/home/me/notes/todo.md', '/work/app/docs/guide.md', '/home/me/notes/list.md', '/srv/data/table.csv'].map(path => `${root}${path}`))
    expect(await pathColored(ui)).toBe(true)
    await ui.unmount()
  })

  test(`file:// markdown links become hyperlinks ${where}`, async ($, on) => {
    filesAt(on, '2.1.289', env)
    if (!(await linksHttp($.ui.mount(mount('[/x](file:///x)'))))) return
    const ui = await $.ui.mount(mount('[/home/me/notes.md](file:///home/me/notes.md) [/srv/x.log](file://localhost/srv/x.log) [C:\\Users\\me\\x.txt](file:///C:/Users/me/x.txt) [\\\\server\\share\\x.txt](file://server/share/x.txt)'))
    expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toEqual([`${root}/home/me/notes.md`, root === 'file://' ? 'file://localhost/srv/x.log' : `${root}/srv/x.log`, 'file:///C:/Users/me/x.txt', 'file://server/share/x.txt'])
    expect((await ui.find({ type: 'Text', text: /^\/home\/me\/notes\.md$/ }))?.props.color).toBe(PRESETS['catppuccin-mocha'].link)
    await ui.unmount()
  })
}

const LABELS: [label: string, href: string, linked: boolean][] = [
  ['/tmp/notes.md', 'file:///tmp/notes.md', true],
  ['file:///tmp/notes.md', 'file:///tmp/notes.md', true],
  ['FILE://localhost/tmp/notes.md', 'file:///tmp/notes.md', true],
  ['/tmp/notes.md.', 'file:///tmp/notes.md', true],
  ['~/notes/todo.md', 'file:///home/me/notes/todo.md', true],
  ['./docs/guide.md', 'file:///work/app/docs/guide.md', true],
  ['../shared/a.txt', 'file:///work/shared/a.txt', true],
  ['/tmp/a b.md', 'file:///tmp/a%20b.md', true],
  ['/home/me/', 'file:///home/me', true],
  ['/tmp/a.html', 'file:///tmp/a.html#s', true],
  ['C:\\Users\\me\\x.txt', 'file:///C:/Users/me/x.txt', true],
  ['\\\\server\\share\\x.txt', 'file://server/share/x.txt', true],
  ['notes', 'file:///tmp/notes.md', false],
  ['notes.md', 'file:///tmp/notes.md', false],
  ['the docs', 'file:///tmp/setup.command', false],
  ['/tmp/notes.md', 'file:///tmp/setup.command', false],
  ['/tmp/notes.md', 'file:///tmp/notes.md/../setup.command', false],
  ['~/notes.md', 'file:///tmp/notes.md', false],
  ['/srv/share/x.txt', 'file://srv/share/x.txt', false],
  ['/tmp/a.html#s', 'file:///tmp/a.html#s', false],
  ['/tmp/a%20b.md', 'file:///tmp/a%20b.md', false],
]

for (const [where, env] of [['outside WSL', {}], ['under WSL', { WSL_DISTRO_NAME: 'Ubuntu' }]] as const) {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`a file:// link stays a link only when its label shows its own path, ${where} on ${surface}`, async ($, on) => {
      filesAt(on, '2.1.289', env)
      if (!(await linksHttp($.ui.mount(mount('[/x](file:///x)'))))) return
      const ui = await $.ui.mount({ ...mount(LABELS.map(([label, href]) => `[${label}](${href})`).join(' and '), 400), surface })
      const linked = LABELS.filter(([, , links]) => links && surface === 'terminal')
      const hrefs = (await ui.findAll({ type: 'Link' })).map(l => String(l.props.href))
      expect(hrefs.length).toBe(linked.length)
      if (where === 'outside WSL') expect(hrefs).toEqual(linked.map(([, href]) => href))
      const missing: string[] = []
      for (const [label, href] of LABELS.filter(row => !linked.includes(row))) {
        const text = label === href ? href : `${label} (${href})`
        if (!(await paintOf(ui, text))) missing.push(text)
      }
      expect(missing).toEqual([])
      await ui.unmount()
    })
  }
}

test('a home folder with a space is percent-encoded in the file link', async ($, on) => {
  filesAt(on, '2.1.289', { HOME: '/home/Mara Schwartz' })
  if (!(await linksHttp($.ui.mount(mount('[/x](file:///x)'))))) return
  const ui = await $.ui.mount(mount('Settings live in ~/.claude/settings.json and ../shared/a+b@2.txt'))
  expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toEqual(['file:///home/Mara%20Schwartz/.claude/settings.json', 'file:///work/shared/a+b@2.txt'])
  await ui.unmount()
})

const COMMANDS = 'Run /config or /compact first.\n\n- /config opens the settings\n- /compact frees context\n\n| command | does |\n|---|---|\n| /config | settings |\n| /compact | context |'

const pathTexts = async (ui: { findAll: (query: { type: 'Text'; text: RegExp }) => Promise<{ props: { color?: unknown } }[]> }, text: RegExp) =>
  (await ui.findAll({ type: 'Text', text })).filter(n => n.props.color === PRESETS['catppuccin-mocha'].path).length

for (const surface of ['terminal', 'desktop'] as const) {
  test(`slash commands like /config in a paragraph, a list and a table stay unlinked path-colored text on ${surface}`, async ($, on) => {
    filesAt(on, '2.1.289')
    const ui = await $.ui.mount({ ...mount(COMMANDS), surface })
    expect(await ui.findAll({ type: 'Link' })).toHaveLength(0)
    expect([await pathTexts(ui, /^\/config$/), await pathTexts(ui, /^\/compact$/)]).toEqual([3, 3])
    await ui.unmount()
  })

  test(`absolute paths with two parts link, and ./ and ~/ paths link as before, on ${surface}`, async ($, on) => {
    filesAt(on, '2.1.289')
    if (surface === 'terminal' && !(await linksHttp($.ui.mount(mount('[/x](file:///x)'))))) return
    const ui = await $.ui.mount({ ...mount('Open /tmp/app.ts, /a/b, ./x or ~/x'), surface })
    expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toEqual(surface === 'terminal' ? ['file:///tmp/app.ts', 'file:///a/b', 'file:///work/app/x', 'file:///home/me/x'] : [])
    await ui.unmount()
  })

  test(`an absolute path links only when a name follows its first slash-separated name, on ${surface}`, async ($, on) => {
    filesAt(on, '2.1.289')
    if (surface === 'terminal' && !(await linksHttp($.ui.mount(mount('[/x](file:///x)'))))) return
    const ui = await $.ui.mount({ ...mount('See /tmp/ and /config. Then /config:3, /a//b, /srv/log., /srv/app.ts:12, // and / alone, /tmp/., C:\\Users\\me\\x.ts and C:/Users/me/x.ts'), surface })
    expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toEqual(surface === 'terminal' ? ['file:///a/b', 'file:///srv/log', 'file:///srv/app.ts'] : [])
    expect([await pathTexts(ui, /^\/tmp\/$/), await pathTexts(ui, /^\/config\.$/), await pathTexts(ui, /^\/config$/), await pathTexts(ui, /^\/tmp\/\.$/)]).toEqual([1, 1, 1, 1])
    await ui.unmount()
  })

  test(`a tag line stays dim and a closing tag inside a sentence stays unlinked, on ${surface}`, async ($, on) => {
    filesAt(on, '2.1.289')
    if (surface === 'terminal' && !(await linksHttp($.ui.mount(mount('[/x](file:///x)'))))) return
    const ui = await $.ui.mount({ ...mount('<tldr>\n- First point, see /tmp/example.\n</tldr>\n\nClose it with </tldr> when done.'), surface })
    expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toEqual(surface === 'terminal' ? ['file:///tmp/example'] : [])
    expect(await pathTexts(ui, /^\/tldr$/)).toBe(1)
    await ui.unmount()
  })
}

const LOOSE = [
  'The guide is in docs/guide/ and the entry point is src/app.ts:42 (see `src/app.ts`).',
  'Release notes: notes.md. The plan is at C:\\work\\notes\\plan.md, also written C:/work/notes/plan.md, and C:\\work\\заметки\\план.md.',
  'Scripts: run.bat and app.py.',
].join('\n\n')

const NOT_PATHS = 'Not paths: and/or, 1/2/3, Ctrl+X/Tab, docs/missing/file.md, C:\\work\\missing\\file.md.'

const ON_DISK = ['/work/app/docs/guide', '/work/app/src/app.ts', '/work/app/notes.md', 'C:/work/notes/plan.md', 'C:/work/заметки/план.md', '/work/app/run.bat', '/work/app/app.py']

const LOOSE_HREFS = [
  'file:///work/app/docs/guide/',
  'file:///work/app/src/app.ts',
  'file:///work/app/src/app.ts',
  'file:///work/app/notes.md',
  'file:///C:/work/notes/plan.md',
  'file:///C:/work/notes/plan.md',
  'file:///C:/work/%D0%B7%D0%B0%D0%BC%D0%B5%D1%82%D0%BA%D0%B8/%D0%BF%D0%BB%D0%B0%D0%BD.md',
]

const onDisk = async ($: Engine, on: On) => {
  const stats: string[] = []
  let folder: string | undefined
  on('classic.SessionStart', (_, e) => {
    folder = e.cwd.replace(/\\/g, '/')
    return {}
  })
  on('fs.stat', (_, e, next) => {
    const seen = e.path.replace(/\\/g, '/')
    const relative = folder !== undefined && seen.startsWith(`${folder}/`) ? seen.slice(folder.length + 1) : undefined
    const path = relative !== undefined && /^[A-Za-z]:\//.test(relative) ? relative : seen.replace(/^[A-Za-z]:(?=\/work\/app\/)/, '')
    if (!path.startsWith('/work/') && !path.startsWith('C:/work/')) return next(e)
    stats.push(path)
    return ON_DISK.includes(path) ? { value: { kind: path.endsWith('guide') ? 'dir' as const : 'file' as const, size: 1, mtimeMs: 0, isLink: false } } : { deny: `no such file ${path}` }
  })
  await $.classic.SessionStart({ source: 'startup' })
  return stats
}

const shape = (node: unknown): string => JSON.stringify(withoutLinks(node))

for (const surface of ['terminal', 'desktop'] as const) {
  test(`paths without ./ and Windows paths link once a stat finds them, not before, on ${surface}`, async ($, on) => {
    filesAt(on, '2.1.289')
    const clock = mock.clock(on)
    const stats = await onDisk($, on)
    if (surface === 'terminal' && !(await linksHttp($.ui.mount(mount('[/x](file:///x)'))))) return
    const ui = await $.ui.mount({ ...mount(LOOSE, 400), surface })
    expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toEqual([])
    await clock.settle()
    expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toEqual(surface === 'terminal' ? LOOSE_HREFS : [])
    expect((await ui.findAll({ type: 'Link' })).map(l => l.props.label)).toEqual(surface === 'terminal' ? ['docs/guide/', 'src/app.ts', 'src/app.ts', 'notes.md', 'C:\\work\\notes\\plan.md', 'C:/work/notes/plan.md', 'C:\\work\\заметки\\план.md'] : [])
    if (surface === 'terminal') expect((await ui.find({ type: 'Text', text: /^docs\/guide\/$/ }))?.props.color).toBe(PRESETS['catppuccin-mocha'].path)
    expect(stats.filter(path => /\.(bat|py)$/.test(path))).toEqual([])
    await ui.unmount()
  })
}

test('prose with slashes and missing paths draws as before once their stats land', async ($, on) => {
  filesAt(on, '2.1.289')
  const clock = mock.clock(on)
  const stats = await onDisk($, on)
  if (!(await linksHttp($.ui.mount(mount('[/x](file:///x)'))))) return
  const ui = await $.ui.mount(mount(`${LOOSE}\n\n${NOT_PATHS}`, 400))
  const before = shape(await ui.find({ type: 'Text', text: /^Not paths/ }))
  await clock.settle()
  expect(stats).toContain('/work/app/and/or')
  expect(stats).toContain('/work/app/docs/missing/file.md')
  expect(stats).toContain('C:/work/missing/file.md')
  expect(await ui.findAll({ type: 'Link' })).toHaveLength(LOOSE_HREFS.length)
  expect(shape(await ui.find({ type: 'Text', text: /^Not paths/ }))).toBe(before)
  for (const text of ['and/or', '1/2/3', 'Ctrl+X/Tab', 'docs/missing/file.md', 'C:\\work\\missing\\file.md']) expect(await pathTexts(ui, exact(text))).toBe(0)
  await ui.unmount()
})

test('each path is stat-ed once a session however many times a streaming reply redraws', async ($, on) => {
  filesAt(on, '2.1.289')
  const clock = mock.clock(on)
  const stats = await onDisk($, on)
  if (!(await linksHttp($.ui.mount(mount('[/x](file:///x)'))))) return
  const text = `${LOOSE}\n\n${NOT_PATHS}`
  for (let end = 8; end <= text.length; end += 8) {
    const ui = await $.ui.mount(mount(text.slice(0, end), 400))
    if (end % 64 === 0) await clock.settle()
    await ui.unmount()
  }
  for (let i = 0; i < 20; i++) {
    const ui = await $.ui.mount(mount(text, 400))
    await clock.settle()
    await ui.unmount()
  }
  const counts = new Map<string, number>()
  for (const path of stats) counts.set(path, (counts.get(path) ?? 0) + 1)
  expect([...counts].filter(([, n]) => n > 1)).toEqual([])
  for (const path of ON_DISK.filter(path => !/\.(bat|py)$/.test(path))) expect(counts.get(path)).toBe(1)
})

test('with highlightPaths off, paths in inline code and loose paths still link once a stat finds them', { options: { highlightPaths: false } }, async ($, on) => {
  filesAt(on, '2.1.289')
  const clock = mock.clock(on)
  const stats = await onDisk($, on)
  if (!(await linksHttp($.ui.mount(mount('[/x](file:///x)'))))) return
  const ui = await $.ui.mount(mount(LOOSE, 400))
  await clock.settle()
  expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toEqual(LOOSE_HREFS)
  expect(stats.filter(path => path === '/work/app/src/app.ts')).toHaveLength(1)
  await ui.unmount()
})

test('a path named before a tool creates it links once the tool ran', async ($, on) => {
  filesAt(on, '2.1.289')
  const clock = mock.clock(on)
  let made = false
  on('fs.stat', (_, e, next) => (e.path.replace(/\\/g, '/').replace(/^[A-Za-z]:(?=\/work\/app\/)/, '') !== '/work/app/src/new.ts' ? next(e) : made ? { value: { kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false } } : { deny: 'no such file' }))
  on('tool.call', () => {
    made = true
    return { result: 'ok', text: 'ok' }
  })
  if (!(await linksHttp($.ui.mount(mount('[/x](file:///x)'))))) return
  const plan = await $.ui.mount(mount("I'll create src/new.ts."))
  await clock.settle()
  expect(await plan.findAll({ type: 'Link' })).toEqual([])
  await plan.unmount()
  await $.tool.call({ tool: 'Write', file_path: '/work/app/src/new.ts', content: 'x' })
  const done = await $.ui.mount(mount('Created src/new.ts.'))
  await clock.settle()
  expect((await done.findAll({ type: 'Link' })).map(l => l.props.href)).toEqual(['file:///work/app/src/new.ts'])
  await done.unmount()
})

test('a line number after a path stays out of its link with number colors off', { options: { highlightNumbers: false } }, async ($, on) => {
  filesAt(on, '2.1.289')
  const clock = mock.clock(on)
  await onDisk($, on)
  if (!(await linksHttp($.ui.mount(mount('[/x](file:///x)'))))) return
  const ui = await $.ui.mount(mount('See src/app.ts:42 and C:\\work\\notes\\plan.md:7.'))
  await clock.settle()
  expect((await ui.findAll({ type: 'Link' })).map(l => [l.props.label, l.props.href])).toEqual([['src/app.ts', 'file:///work/app/src/app.ts'], ['C:\\work\\notes\\plan.md', 'file:///C:/work/notes/plan.md']])
  await ui.unmount()
})

test('in Orca paths link without FORCE_HYPERLINK', async ($, on) => {
  filesAt(on, '2.1.289', { FORCE_HYPERLINK: '', TERM_PROGRAM: 'Orca', TERM_PROGRAM_VERSION: '1.4.230' })
  if (!(await linksHttp($.ui.mount(mount('[/x](file:///x)'))))) return
  const ui = await $.ui.mount(mount('Open ~/notes/todo.md'))
  expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toEqual(['file:///home/me/notes/todo.md'])
  await ui.unmount()
})

for (const [where, surface, base, env] of [
  ['on Claude Code 2.1.288, which refuses file hyperlinks', 'terminal', '2.1.288', {}],
  ['when the Claude Code version is unknown', 'terminal', undefined, {}],
  ['on desktop', 'desktop', '2.1.289', {}],
  ['in a terminal that draws no hyperlinks', 'terminal', '2.1.289', { FORCE_HYPERLINK: '0' }],
  ['in a session over SSH', 'terminal', '2.1.289', { SSH_CONNECTION: '10.0.0.2 52814 10.0.0.9 22' }],
] as const) {
  test(`paths stay plain colored text ${where}`, async ($, on) => {
    filesAt(on, base, env)
    const ui = await $.ui.mount({ ...mount(PATHS), surface })
    expect(await ui.findAll({ type: 'Link' })).toHaveLength(0)
    expect(await pathColored(ui)).toBe(true)
    await ui.unmount()
  })
}

test('a terminal that draws no hyperlinks still links file:// markdown links', async ($, on) => {
  filesAt(on, '2.1.289', { FORCE_HYPERLINK: '0', TERM_PROGRAM: 'Apple_Terminal' })
  if (!(await linksHttp($.ui.mount(mount('[/x](file:///x)'))))) return
  const ui = await $.ui.mount(mount('[~/notes.md](file:///home/me/notes.md) and ~/notes/todo.md'))
  expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toEqual(['file:///home/me/notes.md'])
  await ui.unmount()
})

for (const env of [{ SSH_CONNECTION: '10.0.0.2 52814 10.0.0.9 22' }, { SSH_TTY: '/dev/pts/3' }] as Record<string, string>[]) {
  test(`file:// links draw as plain text in a session over SSH (${Object.keys(env)[0]})`, async ($, on) => {
    filesAt(on, '2.1.289', env)
    const ui = await $.ui.mount(mount('[notes](file:///home/me/notes.md) and [docs](https://example.com)'))
    expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toEqual(['https://example.com'])
    expect(await paintOf(ui, 'notes (file:///home/me/notes.md)')).toBeDefined()
    await ui.unmount()
  })
}

test('file links on desktop draw as plain text, as before', async ($, on) => {
  filesAt(on, '2.1.289')
  const ui = await $.ui.mount({ ...mount('[notes](file:///home/me/notes.md)'), surface: 'desktop' })
  expect(await ui.findAll({ type: 'Link' })).toHaveLength(0)
  expect(await ui.find({ type: 'Text', text: /^notes \(file:\/\/\/home\/me\/notes\.md\)$/ })).toBeDefined()
  await ui.unmount()
})

for (const columns of [120, 34]) {
  test(`linked paths keep every width, wrap and table column at ${columns} columns`, async ($, on) => {
    const source = `${PATHS}\n\nקובץ ההגדרות ~/notes/todo.md נמצא כאן\n\n| a long path column | n |\n|---|---|\n| /srv/very/long/folder/name/that/wraps/file.txt | 1 |`
    const plain = { ...resolveStyle({ rtl: 'warp' }), httpLinks: true, home: '/home/me', cwd: '/work/app' }
    const blocks = parse(source, hl)
    let drawnPlain: unknown
    let drawnLinked: unknown
    on('ui.render', ($, e) => {
      const el = $.ui.resolve(e)
      drawnPlain = renderBlocks(el, plain, blocks, columns)
      drawnLinked = renderBlocks(el, { ...plain, fileLinks: 'file://', pathLinks: true }, blocks, columns)
      return <el.Text>engine</el.Text>
    })
    const ui = await $.ui.mount(mount(''))
    await ui.unmount()
    const count = (node: unknown): number => (node === null || typeof node !== 'object' ? 0 : ((node as { type?: string }).type === 'Link' ? 1 : 0) + ((node as { children?: unknown[] }).children ?? []).reduce<number>((n, c) => n + count(c), 0))
    expect(count({ children: drawnPlain })).toBe(0)
    expect(count({ children: drawnLinked }) > PATH_TEXTS.length).toBe(true)
    expect(JSON.stringify(withoutLinks({ children: drawnLinked }))).toBe(JSON.stringify(withoutLinks({ children: drawnPlain })))
  })
}

test('copy reply copies paths as written', async ($, on) => {
  filesAt(on, '2.1.289')
  const copied = recordCopies(on)
  if (!(await linksHttp($.ui.mount(mount('[/x](file:///x)'))))) return
  const ui = await $.ui.mount(mount(PATHS))
  const reply = (await ui.findAll({ type: 'Button' })).find(b => b.props.label === '⧉ copy reply')
  await ui.press({ key: reply!.key! })
  expect(copied).toEqual([PATHS])
  await ui.unmount()
})

test('a path or link longer than Claude Code draws stays text, and the reply still draws', async ($, on) => {
  filesAt(on, '2.1.289')
  if (!(await linksHttp($.ui.mount(mount('[/x](file:///x)'))))) return
  const long = `/${'a'.repeat(60)}`.repeat(35)
  const web = `https://example.com/${'b'.repeat(2050)}`
  const wide = `https://example.com/${'文'.repeat(700)}`
  const ui = await $.ui.mount(mount(`see ${long} here\n\n${web}\n\n[wide](${wide}) and ~/short.md`))
  expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toEqual(['file:///home/me/short.md'])
  expect(await paintOf(ui, `wide (${wide})`)).toBeDefined()
  await ui.unmount()
})

test('a line holding only a tag is never drawn as a path, so it never links', async ($, on) => {
  filesAt(on, '2.1.289')
  if (!(await linksHttp($.ui.mount(mount('[/x](file:///x)'))))) return
  const ui = await $.ui.mount(mount('<tldr>\n- First point, see /tmp/example.\n</tldr>'))
  expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toEqual(['file:///tmp/example'])
  expect(await ui.find({ type: 'Text', text: /^<\/tldr>$/ })).toBeDefined()
  await ui.unmount()
})

test('paths link in the terminals Claude Code draws hyperlinks in, and only those', () => {
  const cases: [TerminalEnv, boolean][] = [
    [{}, false],
    [{ FORCE_HYPERLINK: '1' }, true],
    [{ FORCE_HYPERLINK: '0', WT_SESSION: 'x' }, false],
    [{ WT_SESSION: '' }, true],
    [{ TERM_PROGRAM: 'tmux', TERM_PROGRAM_VERSION: '3.3a' }, false],
    [{ TERM_PROGRAM: 'tmux', TERM_PROGRAM_VERSION: '3.4' }, true],
    [{ TERM_PROGRAM: 'vscode', TERM_PROGRAM_VERSION: '1.71.2' }, false],
    [{ TERM_PROGRAM: 'vscode', TERM_PROGRAM_VERSION: '1.72.0' }, true],
    [{ TERM_PROGRAM: 'vscode', TERM_PROGRAM_VERSION: '1.5.0' }, false],
    [{ TERM_PROGRAM: 'vscode', TERM_PROGRAM_VERSION: '0.4.1' }, false],
    [{ TERM_PROGRAM: 'vscode' }, false],
    [{ TERM_PROGRAM: 'WezTerm', TERM_PROGRAM_VERSION: '20240203-110809-5046fc22' }, true],
    [{ TERM_PROGRAM: 'WezTerm', TERM_PROGRAM_VERSION: '20200101-000000-0' }, false],
    [{ TERM_PROGRAM: 'iTerm.app', TERM_PROGRAM_VERSION: '3.0.0' }, true],
    [{ TERM_PROGRAM: 'ghostty' }, true],
    [{ TERM_PROGRAM: 'Orca', TERM_PROGRAM_VERSION: '1.4.230' }, true],
    [{ TERM_PROGRAM: 'Apple_Terminal' }, false],
    [{ VTE_VERSION: '7600' }, true],
    [{ VTE_VERSION: '4600' }, false],
    [{ VTE_VERSION: '0.50.0' }, false],
    [{ LC_TERMINAL: 'iTerm2' }, true],
    [{ LC_TERMINAL: 'Konsole' }, false],
    [{ TERMINAL_EMULATOR: 'JetBrains-JediTerm' }, true],
    [{ TERM: 'xterm-kitty' }, true],
    [{ TERM: 'alacritty' }, true],
    [{ TERM: 'xterm-256color' }, false],
  ]
  for (const [env, linked] of cases) expect([env, drawsHyperlinks(env)]).toEqual([env, linked])
})

for (const [version, linked] of [['1.5.0', false], ['1.95.3', true]] as const) {
  test(`a VS Code terminal at ${version} ${linked ? 'links' : 'does not link'} paths, as Claude Code decides`, async ($, on) => {
    filesAt(on, '2.1.289', { FORCE_HYPERLINK: '', TERM_PROGRAM: 'vscode', TERM_PROGRAM_VERSION: version })
    if (linked && !(await linksHttp($.ui.mount(mount('[/x](file:///x)'))))) return
    const ui = await $.ui.mount(mount('Open ~/notes/todo.md'))
    expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toEqual(linked ? ['file:///home/me/notes/todo.md'] : [])
    await ui.unmount()
  })
}

test('the link check reads the environment once, however many replies draw', async ($, on) => {
  claudeAt(on, '2.1.289')
  const reads: string[] = []
  const env: Record<string, string> = { FORCE_HYPERLINK: '1', HOME: '/home/me', WSL_DISTRO_NAME: 'Ubuntu' }
  on('env.get', (_, e) => {
    reads.push(e.name)
    return { value: env[e.name] }
  })
  for (const text of ['one', 'two', 'three']) {
    const ui = await $.ui.mount(mount(text))
    await ui.unmount()
  }
  for (const name of ['FORCE_HYPERLINK', 'TERM_PROGRAM_VERSION', 'LC_TERMINAL', 'TERMINAL_EMULATOR', 'WSL_DISTRO_NAME', 'SSH_TTY']) expect([name, reads.filter(n => n === name).length]).toEqual([name, 1])
})

test('under WSL, file:// links with a query, a fragment or one slash go through wsl.localhost too', async ($, on) => {
  filesAt(on, '2.1.289', { WSL_DISTRO_NAME: 'Ubuntu' })
  if (!(await linksHttp($.ui.mount(mount('[/x](file:///x)'))))) return
  const ui = await $.ui.mount(mount('[/tmp/a.html](file:///tmp/a.html#s) [/tmp/b.txt](file:/tmp/b.txt) [/tmp/c](file:///tmp/c?x=1) [\\\\server\\share\\d](file:////server/share/d)'))
  expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toEqual([
    'file://wsl.localhost/Ubuntu/tmp/a.html#s', 'file://wsl.localhost/Ubuntu/tmp/b.txt', 'file://wsl.localhost/Ubuntu/tmp/c?x=1', 'file:////server/share/d',
  ])
  await ui.unmount()
})

for (const env of [{ VTE_VERSION: '7600' }, { KONSOLE_VERSION: '230804' }, { KITTY_WINDOW_ID: '1' }] as Record<string, string>[]) {
  test(`under WSL a Linux terminal (${Object.keys(env)[0]}) gets plain file:/// links it opens itself`, async ($, on) => {
    filesAt(on, '2.1.289', { WSL_DISTRO_NAME: 'Ubuntu', ...env })
    if (!(await linksHttp($.ui.mount(mount('[/x](file:///x)'))))) return
    const ui = await $.ui.mount(mount('Open ~/notes/todo.md and [/tmp/n.md](file:///tmp/n.md)'))
    expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toEqual(['file:///home/me/notes/todo.md', 'file:///tmp/n.md'])
    await ui.unmount()
  })
}

test('/merman setup samples draw their made-up paths without links', async ($, on) => {
  filesAt(on, '2.1.289')
  const text = setupText(setupParts(PRESET_NAMES, 0))
  expect(text).toContain('~/src/app.ts')
  const ui = await $.ui.mount({ plugin: 'merman', surface: 'terminal', component: 'CommandOutput', props: { command: 'merman', args: 'setup', text, isErrored: false }, viewport: { columns: 120, rows: 40 } })
  expect((await ui.findAll({ type: 'Link' })).map(l => String(l.props.href)).filter(href => href.startsWith('file:'))).toEqual([])
  await ui.unmount()
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`/merman demo links its sample paths and keeps its slash command sample as text on ${surface}`, async ($, on) => {
    filesAt(on, '2.1.289')
    if (surface === 'terminal' && !(await linksHttp($.ui.mount(mount('[/x](file:///x)'))))) return
    const text = showcaseText(PRESET_NAMES)
    const ui = await $.ui.mount({ plugin: 'merman', surface, component: 'CommandOutput', props: { command: 'merman', args: 'demo', text, isErrored: false }, viewport: { columns: 120, rows: 40 } })
    const hrefs = (await ui.findAll({ type: 'Link' })).map(l => String(l.props.href))
    expect([hrefs.includes('file:///tmp/app.ts'), hrefs.some(href => href.endsWith('/config'))]).toEqual([surface === 'terminal', false])
    expect(parse(text, hl).some(b => b.kind === 'paragraph' && b.inline.some(n => n.kind === 'path' && n.text === '/config'))).toBe(true)
    await ui.unmount()
  })
}

const toolCall = (tool: string, input: unknown, id: string) => ({ tool_use_id: id, tool, input, isRunning: false, isErrored: false, isInterrupted: false })

const linkPairs = async (ui: { findAll: (query: { type: 'Link' }) => Promise<{ props: { label?: unknown; href?: unknown } }[]> }) =>
  (await ui.findAll({ type: 'Link' })).map(l => [l.props.label, l.props.href])

const toolLinks = async ($: Engine, tool: string, input: unknown) => {
  const ui = await $.ui.mount({ plugin: 'merman', surface: 'terminal', component: 'ToolUse', props: toolCall(tool, input, `t-${tool}`) })
  const links = await linkPairs(ui)
  await ui.unmount()
  return links
}

for (const toolOutput of ['full', 'quiet'] as const) {
  test(`file paths in tool rows link to the whole file (toolOutput ${toolOutput})`, { options: { toolOutput } }, async ($, on) => {
    filesAt(on, '2.1.289', { WSL_DISTRO_NAME: 'Ubuntu' })
    if (!(await linksHttp($.ui.mount(mount('[/x](file:///x)'))))) return
    const root = 'file://wsl.localhost/Ubuntu'
    expect(await toolLinks($, 'Read', { file_path: '/work/app/src/main.ts' })).toEqual([['src/main.ts', `${root}/work/app/src/main.ts`]])
    expect(await toolLinks($, 'Edit', { file_path: '/home/me/notes/todo.md' })).toEqual([['~/notes/todo.md', `${root}/home/me/notes/todo.md`]])
    expect(await toolLinks($, 'Write', { file_path: '/srv/one/two/three/four/five/six.ts' })).toEqual([[toolOutput === 'quiet' ? '/srv/one/…/five/six.ts' : '/srv/one/two/three/four/five/six.ts', `${root}/srv/one/two/three/four/five/six.ts`]])
    expect(await toolLinks($, 'Grep', { pattern: 'TODO', path: 'src' })).toEqual([['src', `${root}/work/app/src`]])
    expect(await toolLinks($, 'Glob', { pattern: '*.ts' })).toEqual([])
    expect(await toolLinks($, 'Bash', { command: 'cat /srv/app/main.ts' })).toEqual([])
    expect(await toolLinks($, 'mcp__github__get_file_contents', { owner: 'o', repo: 'r', path: 'README.md' })).toEqual([])
  })

  test(`a tool group links its file paths (toolOutput ${toolOutput})`, { options: { toolOutput } }, async ($, on) => {
    filesAt(on, '2.1.289')
    if (!(await linksHttp($.ui.mount(mount('[/x](file:///x)'))))) return
    const calls = [toolCall('Read', { file_path: '/work/app/a.ts' }, 'g-1'), toolCall('Read', { file_path: '/work/app/b.ts' }, 'g-2')]
    const ui = await $.ui.mount({ plugin: 'merman', surface: 'terminal', component: 'ToolGroup', props: { calls, isActive: false, isExpanded: false } })
    const b = ['b.ts', 'file:///work/app/b.ts']
    expect(await linkPairs(ui)).toEqual(toolOutput === 'quiet' ? [['a.ts', 'file:///work/app/a.ts'], b] : [b])
    await ui.unmount()
  })
}

test('Windows paths in tool rows link with forward slashes, and UNC paths name their server', async ($, on) => {
  filesAt(on, '2.1.289')
  if (!(await linksHttp($.ui.mount(mount('[/x](file:///x)'))))) return
  expect(await toolLinks($, 'Grep', { pattern: 'x', path: 'src\\hooks' })).toEqual([['src\\hooks', 'file:///work/app/src/hooks']])
  expect(await toolLinks($, 'Read', { file_path: 'C:\\Users\\me\\x.ts' })).toEqual([['C:\\Users\\me\\x.ts', 'file:///C:/Users/me/x.ts']])
  expect(await toolLinks($, 'Read', { file_path: '\\\\server\\share\\x.txt' })).toEqual([['\\\\server\\share\\x.txt', 'file://server/share/x.txt']])
})

test('under WSL a drive path in a tool row is already a Windows path, so it links without wsl.localhost', async ($, on) => {
  filesAt(on, '2.1.289', { WSL_DISTRO_NAME: 'Ubuntu' })
  if (!(await linksHttp($.ui.mount(mount('[/x](file:///x)'))))) return
  expect(await toolLinks($, 'Read', { file_path: 'C:\\Users\\me\\x.ts' })).toEqual([['C:\\Users\\me\\x.ts', 'file:///C:/Users/me/x.ts']])
  expect(await toolLinks($, 'Edit', { file_path: 'C:/Users/me/y.ts' })).toEqual([['C:/Users/me/y.ts', 'file:///C:/Users/me/y.ts']])
  expect(await toolLinks($, 'Read', { file_path: '/work/app/z.ts' })).toEqual([['z.ts', 'file://wsl.localhost/Ubuntu/work/app/z.ts']])
})

test('a tool path whose link would pass 2048 characters stays text, and the row still draws', async ($, on) => {
  filesAt(on, '2.1.289')
  if (!(await linksHttp($.ui.mount(mount('[/x](file:///x)'))))) return
  expect(await toolLinks($, 'Read', { file_path: `/work/app/${'文档/'.repeat(110)}说明.md` })).toEqual([])
  expect(await toolLinks($, 'Read', { file_path: '/work/app/a b#c?d%e é.ts' })).toEqual([['a b#c?d%e é.ts', 'file:///work/app/a%20b%23c%3Fd%25e%20%C3%A9.ts']])
})

test('shell edit cards link their file headers', async ($, on) => {
  filesAt(on, '2.1.289')
  if (!(await linksHttp($.ui.mount(mount('[/x](file:///x)'))))) return
  const output = { stdout: '', stderr: '', interrupted: false, bashEditDiff: { files: [{ filePath: '/work/app/src/app.ts', hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: ['+one'] }] }], moreFiles: 0 } }
  const ui = await $.ui.mount({ plugin: 'merman', surface: 'terminal', component: 'ToolResult', props: { tool_use_id: 'be-1', tool: 'Bash', output, isErrored: false } })
  expect(await linkPairs(ui)).toEqual([['src/app.ts', 'file:///work/app/src/app.ts']])
  expect((await ui.find({ type: 'Text', text: /^src\/app\.ts $/ }))?.props.color).toBe(PRESETS['catppuccin-mocha'].path)
  await ui.unmount()
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`tool rows and file:// links still link a one-part absolute path on ${surface}`, async ($, on) => {
    filesAt(on, '2.1.289')
    if (surface === 'terminal' && !(await linksHttp($.ui.mount(mount('[/x](file:///x)'))))) return
    const row = await $.ui.mount({ plugin: 'merman', surface, component: 'ToolUse', props: toolCall('Read', { file_path: '/etc' }, 'one-part') })
    expect(await linkPairs(row)).toEqual(surface === 'terminal' ? [['/etc', 'file:///etc']] : [])
    await row.unmount()
    const reply = await $.ui.mount({ ...mount('[/config](file:///config)'), surface })
    expect((await reply.findAll({ type: 'Link' })).map(l => l.props.href)).toEqual(surface === 'terminal' ? ['file:///config'] : [])
    await reply.unmount()
  })
}

for (const [where, surface, base, env] of [
  ['on desktop', 'desktop', '2.1.289', {}],
  ['on Claude Code 2.1.288', 'terminal', '2.1.288', {}],
  ['in a terminal that draws no hyperlinks', 'terminal', '2.1.289', { FORCE_HYPERLINK: '0' }],
  ['in a session over SSH', 'terminal', '2.1.289', { SSH_TTY: '/dev/pts/3' }],
] as const) {
  test(`tool rows keep plain paths ${where}`, async ($, on) => {
    filesAt(on, base, env)
    const ui = await $.ui.mount({ plugin: 'merman', surface, component: 'ToolUse', props: toolCall('Read', { file_path: '/work/app/src/main.ts' }, 'p-1') })
    expect(await ui.findAll({ type: 'Link' })).toHaveLength(0)
    expect((await ui.find({ type: 'Text', text: /^src\/main\.ts$/ }))?.props.color).toBe(PRESETS['catppuccin-mocha'].path)
    await ui.unmount()
  })
}

test('links that cannot be clicked draw as plain text with their target, as Claude Code draws them', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...mount('[mail](mailto:someone@example.com) [someone@example.com](mailto:someone@example.com) [disk](file:///etc/passwd)'), surface })
    expect(await ui.findAll({ type: 'Link' })).toHaveLength(0)
    for (const text of ['mail (someone@example.com)', 'someone@example.com', 'disk (file:///etc/passwd)']) {
      const drawnText = await paintOf(ui, text)
      expect(drawnText).toBeDefined()
      expect(drawnText?.color).toBeUndefined()
      expect(drawnText?.underline).toBeFalsy()
    }
    await ui.unmount()
  }
})

test('copying a table keeps its links as written', async ($, on) => {
  const copied = stubClipboard(on)
  const source = '| who | site |\n|---|---|\n| [mail](mailto:someone@example.com) | [docs](https://example.com) |'
  const ui = await $.ui.mount(mount(source))
  const button = (await ui.findAll({ type: 'Button' })).find(b => b.props.label === '⧉ md')
  await ui.press({ key: button!.key! })
  expect(copied).toEqual([source])
  await ui.unmount()
})

for (const tableStyle of ['box', 'rules'] as const) {
  test(`a ${tableStyle} table cell link that cannot be clicked draws as plain text and its column fits it`, { options: { tableStyle } }, async $ => {
    const ui = await $.ui.mount(mount('| who | n |\n|---|---|\n| [mail](mailto:someone@example.com) | 1 |'))
    expect(await ui.findAll({ type: 'Link' })).toHaveLength(0)
    const paint = await paintOf(ui, 'mail (someone@example.com)')
    expect(paint).toBeDefined()
    expect(paint?.color).toBeUndefined()
    expect(paint?.underline).toBeFalsy()
    expect((await shownLines(ui)).some(l => l.includes('mail (someone@example.com)'))).toBe(true)
    await ui.unmount()
  })
}

test('double underscores inside a word stay literal, as in mcp__serena__activate_project', async () => {
  const [block] = parse('Call mcp__serena__activate_project, not __this__.', hl)

  expect(block?.kind === 'paragraph' ? inlineText(block.inline) : null).toBe('Call mcp__serena__activate_project, not this.')
})

test('a flowchart whose long edge label makes it too wide draws with the label shortened, not as source', async $ => {
  const source = [
    'flowchart TD',
    '  A["Tank sensor<br/>posts a reading every 10s"] --> B["POST to ingest :8080"]',
    '  B --> C["writeReading(tankId, tempC, ph)"]',
    '  C --> D{"pool.connect()<br/>free connection within 2000ms?"}',
    '  D -- yes --> E["INSERT INTO readings"]',
    '  D -- no --> X1["BLOCKED: acquire timeout<br/>pool 4/4 busy, reading fails"]',
    '  E --> F["client.release() back to pool"]',
    '  E -. "slow INSERT holds the connection<br/>(no query timeout in code)" .-> X2["BLOCKED: connection held,<br/>starves the pool"]',
    '  F --> G[("readings table<br/>tanks-db.internal")]',
    '  G --> H["Dashboard polls readings"]',
  ].join('\n')
  expect(mermaidText(source, false, 108)!.split('\n').some(l => width(l) > 106)).toBe(true)
  expect(shortenEdgeLabels(source, 24)).toContain('-. "slow INSERT holds the c…" .->')
  expect(shortenEdgeLabels('graph LR\n  A -->|a very long edge label here| B', 12)).toContain('|a very long…|')
  const ui = await $.ui.mount(mount('```mermaid\n' + source + '\n```', 112))
  expect(await ui.find({ type: 'Text', text: /Tank sensor/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /flowchart TD/ })).toBeUndefined()
  await ui.unmount()
})

test('inline HTML tags in mermaid labels draw as italic and bold, not as tags', async $ => {
  const art = mermaidText('flowchart TD\n  A["metrics-server<br/><i>one slow scrape</i>"] --> B["<b>kubelet</b>"]', false, 80)!
  expect(art).toContain('one slow scrape')
  expect(art).toContain('kubelet')
  expect(art).not.toMatch(/<\/?[ib]>/)
  expect(inlineMarks('A["x<br/><i>one slow</i>"] --> B["<b>kubelet</b>"]')).toEqual([[[...'one slow'], { italic: true }], [[...'kubelet'], { bold: true }]])
  const ui = await $.ui.mount(mount('```mermaid\nflowchart TD\n  A["metrics-server<br/><i>one slow scrape</i>"] --> B["<b>kubelet</b>"]\n```', 80))
  expect((await paintOf(ui, 'scrape'))?.italic).toBe(true)
  expect((await paintOf(ui, 'kubelet'))?.bold).toBe(true)
  await ui.unmount()
})

test('inline $…$ math draws without its dollar signs, prices and shell variables stay text', async () => {
  const shown = (s: string) => {
    const [block] = parse(s, hl)
    return block?.kind === 'paragraph' ? block.inline.map(n => (n.kind === 'math' ? `[${n.text}]` : 'children' in n ? inlineText(n.children) : n.text)).join('') : ''
  }
  expect(shown('runs at ($\\rho = 4.3 / 5$) with $L = \\lambda \\cdot W$')).toBe('runs at ([ρ = 4.3 / 5]) with [L = λ · W]')
  expect(shown('costs $5 and $10 today')).toBe('costs $5 and $10 today')
  expect(shown('echo $HOME and $PATH')).toBe('echo $HOME and $PATH')
})

test('chart y-axis ticks sit an even number of rows apart', async () => {
  const charts = [
    'xychart-beta\n  x-axis ["11:00", "12:00", "13:00", "14:00", "15:00", "16:00"]\n  y-axis "ms" 0 --> 2500\n  bar [45, 47, 46, 2029, 2032, 2007]',
    'xychart-beta\n  x-axis [text, head, num, code, diag]\n  y-axis "options" 0 --> 8\n  bar [7, 3, 2, 6, 2]',
  ]
  for (const chart of charts) for (const columns of [40, 80, 100, 160, 260]) {
    const rows = mermaidText(chart, false, columns)!.split('\n').flatMap((l, i) => (/^\s*[\d.]+\s*[┤┼]/.test(l) ? [i] : []))
    expect(new Set(rows.slice(1).map((r, i) => r - rows[i]!)).size).toBe(1)
  }
})

const barColumns = (axis: string) => [...axis.matchAll(/┬|▀+/g)].map(m => m.index + Math.floor(m[0].length / 2))
const block = (ch = '') => /[█▀▄]/.test(ch)

for (const [values, axisRange] of [[[400, 1200, 1900, 2500, 800], '0 --> 2500'], [[12, 10, 8], '0 --> 14']] as const) {
  test(`a bar stands on the axis line, reaches the gridlines at or below its value and stops on its own, with its value centered on top: ${values.join(', ')}`, () => {
    for (const title of ['\n  title "Sizes"', ''])
    for (const columns of [60, 120, 200]) {
      const chart = `xychart-beta${title}\n  x-axis [${values.map((_, i) => `b${i + 1}`).join(', ')}]\n  y-axis ${axisRange}\n  bar [${values.join(', ')}]`
      const lines = mermaidText(chart, false, columns)!.split('\n')
      const axis = lines.find(l => /^\s*0┼─/.test(l)) ?? ''
      const bars = barColumns(axis)
      expect(bars.length).toBe(values.length)
      bars.forEach(c => expect(axis[c]).toBe('▀'))
      for (const line of lines) {
        const tick = line.match(/^\s*(\d+)┤/)?.[1]
        if (tick === undefined) continue
        bars.forEach((c, i) => {
          expect(block(line[c])).toBe(Number(tick) <= values[i]!)
          if (Number(tick) === values[i]) expect(line[c]).toBe('▄')
        })
      }
      bars.forEach((c, i) => {
        const label = String(values[i])
        const top = lines.findIndex(l => block(l[c]))
        const bar = lines[top]!
        let [left, right] = [c, c]
        while (block(bar[left - 1])) left--
        while (block(bar[right + 1])) right++
        const from = lines[top - 1]!.indexOf(label, left - label.length)
        expect(from).toBeGreaterThan(-1)
        expect([0, 1]).toContain(from - left - (right - (from + label.length - 1)))
      })
    }
  })
}

for (const values of [[-5, 3, 8, -2, 0], [-6, 6, -2, 2], [-5, -3, -8]]) {
  test(`bars with negatives grow both ways from a solid 0 line, stop on their own gridline and keep their value at their end: ${values.join(', ')}`, () => {
    const chart = `xychart-beta\n  x-axis [${values.map((_, i) => `b${i + 1}`).join(', ')}]\n  bar [${values.join(', ')}]`
    for (const columns of [60, 120, 200]) {
      const lines = mermaidText(chart, false, columns)!.split('\n')
      const ticks = lines.flatMap((l, r) => {
        const tick = l.match(/^\s*(-?[\d.]+)[┤┼]/)?.[1]
        return tick === undefined ? [] : [{ r, tick: Number(tick) }]
      })
      const axis = ticks.at(-1)!.r
      const bars = barColumns(lines[axis]!)
      expect(bars.length).toBe(values.length)
      const [hi, lo] = [ticks[0]!.tick, ticks.at(-1)!.tick]
      const base = Math.min(Math.max(0, lo), hi)
      const baseRow = ticks.find(t => t.tick === base)!.r
      expect(lines[baseRow]).toMatch(/^\s*-?[\d.]+┼[─▀▄]+$/)
      bars.forEach((c, i) => expect(lines[baseRow]![c]).toBe(values[i] === base ? '─' : values[i]! > base ? '▀' : '▄'))
      for (const { r, tick } of ticks.filter(t => t.r !== axis && t.r !== baseRow)) {
        bars.forEach((c, i) => {
          expect(block(lines[r]![c])).toBe((base < tick && tick <= values[i]!) || (values[i]! <= tick && tick < base))
          if (tick === values[i]) expect(lines[r]![c]).toBe(tick > base ? '▄' : '▀')
        })
      }
      bars.forEach((c, i) => {
        const label = String(values[i])
        const filled = lines.flatMap((l, r) => (block(l[c]) ? [r] : []))
        const row = values[i]! < 0 ? (filled.at(-1) ?? baseRow) + 1 : (filled[0] ?? baseRow) - 1
        if (row < axis) expect(lines[row]!.slice(c - label.length, c + label.length)).toContain(label)
      })
    }
  })
}

test('a line at 0 runs along the axis line', () => {
  for (const columns of [60, 120, 200]) {
    const lines = mermaidText('xychart-beta\n  x-axis [a, b, c]\n  y-axis 0 --> 100\n  line [0, 60, 100]', false, columns)!.split('\n')
    const axis = lines.findIndex(l => /^\s*0┼/.test(l))
    expect(lines[axis]).toMatch(/^\s*0┼─+╯/)
    expect(lines[axis - 1]).not.toMatch(/─/)
  }
})

test('a line over a bar chart passes behind the bars and leaves their heights alone', () => {
  const bars = 'xychart-beta\n  x-axis [a, b, c, d]\n  y-axis 0 --> 100\n  bar [20, 50, 80, 40]'
  for (const ascii of [false, true])
  for (const columns of [60, 120, 200]) {
    const cells = (chart: string) => {
      const lines = mermaidText(chart, ascii, columns)!.split('\n')
      const top = lines.findIndex(l => /^\s*\d+[┤+]/.test(l))
      const axis = lines.findIndex(l => /^\s*0[┼+]/.test(l))
      return lines.slice(top, axis + 1).flatMap((l, r) => [...l].flatMap((ch, c) => (/[█▀▄#]/.test(ch) ? [`${axis - top - r}:${c}`] : [])))
    }
    for (const line of ['line [20, 50, 80, 40]', 'line [0, 50, 100, 25]']) expect(cells(`${bars}\n  ${line}`)).toEqual(cells(bars))
  }
})

test('footnotes number by first reference, collect at the end, and undefined ones stay literal', () => {
  const blocks = parse('Two[^b] and one[^a] and ghost[^x].\n\n[^a]: first\n    more\n[^b]: second\n\n```\n[^c]: not a note\n```', hl)
  const [para, code, notes] = blocks
  expect(blocks).toHaveLength(3)
  expect(code).toMatchObject({ kind: 'code' })
  expect(para?.kind === 'paragraph' ? inlineText(para.inline) : '').toBe('Two¹ and one² and ghost[^x].')
  expect(notes?.kind === 'notes' ? notes.notes.map(n => `${n.mark} ${inlineText(n.inline)}`) : []).toEqual(['¹ second', '² first more'])
  expect(parse('plain [^1] text', hl)[0]).toMatchObject({ kind: 'paragraph' })
})

const CLICKABLE = '2.1.295'
const NOTED = 'Fast[^a].\n\n[^a]: Measured twice.'
const DEMO = { plugin: 'merman', component: 'CommandOutput' as const, props: { command: 'merman', args: 'demo', text: showcaseText([]), isErrored: false }, viewport: { columns: 120, rows: 40 } }
type DrawnNode = { hover?: { scope?: string }; children?: unknown[] }
const hoverScopes = (node: DrawnNode): string[] => [
  ...(node.hover?.scope ? [node.hover.scope] : []),
  ...(node.children ?? []).flatMap(child => (child && typeof child === 'object' ? hoverScopes(child as DrawnNode) : [])),
]

for (const surface of ['terminal', 'desktop'] as const) {
  test(`footnote marks and the notes block draw on ${surface}`, async ($) => {
    const ui = await $.ui.mount({ ...mount('Fast[^a].\n\n[^a]: Measured twice.'), surface })
    expect(await ui.find({ type: 'Text', text: /^¹$/ })).toBeDefined()
    expect(await ui.find({ text: /^¹ Measured twice\.$/ })).toBeDefined()
    await ui.unmount()
  })

  test(`two identical replies light only their own footnote marks on ${surface}`, async ($) => {
    const scopes: string[][] = []
    for (const requestId of ['m1', 'm2']) {
      const ui = await $.ui.mount({ ...mount(NOTED), surface, requestId })
      scopes.push(hoverScopes((await ui.drawn()) as DrawnNode).filter(s => s.startsWith('fn:')))
      await ui.unmount()
    }
    expect(scopes.map(s => s.length)).toEqual([2, 2])
    expect(scopes.map(s => new Set(s).size)).toEqual([1, 1])
    expect(scopes[1]!.some(s => scopes[0]!.includes(s))).toBe(false)
  })

  test(`/merman demo run twice lights only its own footnote marks on ${surface}`, async ($) => {
    const scopes: string[][] = []
    for (const requestId of ['c1', 'c2']) {
      const ui = await $.ui.mount({ ...DEMO, surface, requestId })
      scopes.push(hoverScopes((await ui.drawn()) as DrawnNode).filter(s => s.startsWith('fn:')))
      await ui.unmount()
    }
    expect(scopes.map(s => s.length)).toEqual([6, 6])
    expect(scopes.map(s => new Set(s).size)).toEqual([3, 3])
    expect(scopes[1]!.some(s => scopes[0]!.includes(s))).toBe(false)
  })

  for (const tableStyle of ['box', 'rules'] as const) {
    for (const base of [undefined, CLICKABLE]) {
      test(`footnote marks in table cells draw in the paragraph mark color on ${surface}, ${tableStyle}${base ? `, Claude Code ${base}` : ''}`, { options: { tableStyle } }, async ($, on) => {
        if (base) claudeAt(on, base)
        if (base && !(await linksHttp($.ui.mount({ ...mount(NOTED), surface })))) return
        const accent = PRESETS['catppuccin-mocha'].accent
        const ui = await $.ui.mount({ ...mount('Fast[^a].\n\n| Metric[^b] | **Value**[^c] | A long header that has to wrap[^a] |\n|---|---|---|\n| p99[^a] | 40ms[^b] | x |\n\n[^a]: A.\n[^b]: B.\n[^c]: C.', 40), surface })
        const marks = await ui.findAll({ type: 'Text', text: /^[¹²³]$/ })
        expect(new Set(marks.map(m => m.text))).toEqual(new Set(['¹', '²', '³']))
        expect(marks.filter(m => m.props.color !== accent).map(m => m.text)).toEqual([])
        expect(marks.length).toBe(6)
        const header = await ui.findAll({ type: 'Text', text: /^Metric²?$/ })
        expect(header.some(h => h.props.bold === true && h.props.color === PRESETS['catppuccin-mocha'].tableHeader)).toBe(true)
        await ui.unmount()
      })
    }
  }

  test(`footnote marks stay plain text before Claude Code 2.1.295 on ${surface}`, async ($, on) => {
    claudeAt(on, '2.1.294')
    const ui = await $.ui.mount({ ...mount('Fast[^a].\n\n| M[^a] | V |\n|---|---|\n| x | 1 |\n\n[^a]: Measured twice.'), surface })
    expect(await ui.findAll({ type: 'Button', text: /^¹$/ })).toEqual([])
    expect((await ui.findAll({ type: 'Text', text: /^¹$/ })).map(m => m.props.color)).toEqual([PRESETS['catppuccin-mocha'].accent, PRESETS['catppuccin-mocha'].accent])
    await ui.unmount()
  })

  test(`a click on a footnote mark in a sentence, list, quote or table shows its note on ${surface}`, async ($, on) => {
    claudeAt(on, CLICKABLE)
    const toasts = recordToasts(on)
    if (!(await linksHttp($.ui.mount({ ...mount(NOTED), surface })))) return
    const ui = await $.ui.mount({ ...mount('Fast[^a] and steady.\n\n- Cold[^b] start\n\n> Quiet[^a] release.\n\n| M | V |\n|---|---|\n| p99 | 40ms[^b] |\n\n[^a]: Measured twice.\n[^b]: First request.'), surface })
    const marks = await ui.findAll({ type: 'Button', text: /^[¹²]$/ })
    expect(marks.map(m => m.text)).toEqual(['¹', '²', '¹', '²'])
    for (const mark of marks) await ui.press({ key: mark.key! })
    expect(toasts).toEqual(['¹ Measured twice.', '² First request.', '¹ Measured twice.', '² First request.'])
    expect((await ui.find({ type: 'Text', text: /^Quiet$/ }))?.props).toMatchObject({ italic: true, color: PRESETS['catppuccin-mocha'].quote })
    await ui.unmount()
  })

  test(`a mark after a word wider than the line stays at the word's end on ${surface}`, async ($, on) => {
    claudeAt(on, CLICKABLE)
    if (!(await linksHttp($.ui.mount({ ...mount(NOTED), surface })))) return
    const long = 'supercalifragilisticexpialidocious-extra-long-token'
    const ui = await $.ui.mount({ ...mount(`Token ${long}[^a] here.\n\n- item ${long}[^a] end\n\n[^a]: The long token.`, 40), surface })
    const words = (await ui.findAll({ type: 'Box' })).filter(b => b.props.flexShrink === 0 && b.text.includes('¹'))
    expect(words.map(w => w.text.trim().endsWith('token¹'))).toEqual([true, true])
    expect(words.filter(w => width(w.text.trimEnd()) > 38).map(w => w.text)).toEqual([])
    await ui.unmount()
  })

  test(`/merman demo footnote marks are clickable on ${surface}`, async ($, on) => {
    claudeAt(on, CLICKABLE)
    const toasts = recordToasts(on)
    if (!(await linksHttp($.ui.mount({ ...mount(NOTED), surface })))) return
    const ui = await $.ui.mount({ ...DEMO, surface })
    const marks = await ui.findAll({ type: 'Button', text: /^[¹²³]$/ })
    expect(marks.map(m => m.text)).toEqual(['¹', '²', '³'])
    await ui.press({ key: marks[0]!.key! })
    expect(toasts).toEqual(['¹ Counted at close.'])
    await ui.unmount()
  })
}

test('footnote clicks need Claude Code 2.1.295 or later', () => {
  const versions = ['2.1.287', '2.1.294', '2.1.295', '2.1.296-dev.20261013.t101500.sha1a2b3c4', '2.2.0', '3.0.0', '1.9.999', 'dev']
  expect(versions.map(takesClickableMarks)).toEqual([false, false, true, true, true, true, false, false])
})

const chartRows = async (ui: { findAll: (q: { type: 'Text' }) => Promise<{ text: string }[]> }) => {
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  const axis = texts.find(t => /^\s*0┼─/.test(t)) ?? ''
  const gutter = axis.indexOf('┼')
  const rows = texts.filter(t => t.length > gutter + 1 && /[┤│┼]/.test(t[gutter] ?? '') && /^[\s\d.]*$/.test(t.slice(0, gutter)))
  return { rows, columns: barColumns(axis) }
}

for (const surface of ['terminal', 'desktop'] as const) {
  for (const kind of ['bar', 'line'] as const) {
    for (const values of [[3, 7, 5], [2, 3, 4, 16], [400, 1200, 1900, 2500, 800]]) {
      test(`${kind} chart heights follow their values on ${surface}: ${values.join(', ')}`, async $ => {
        const labels = values.map((_, i) => `L${i + 1}`).join(', ')
        const ui = await $.ui.mount({ ...mount(`\`\`\`mermaid\nxychart-beta\n  x-axis [${labels}]\n  y-axis 0 --> ${Math.max(...values) + 2}\n  ${kind} [${values.join(', ')}]\n\`\`\``), surface })
        const { rows, columns } = await chartRows(ui)
        expect(columns.length).toBe(values.length)
        if (kind === 'bar') {
          for (const row of rows) {
            const tick = row.match(/^\s*(\d+)┤/)?.[1]
            if (tick !== undefined) columns.forEach((c, i) => expect(block(row[c])).toBe(Number(tick) <= values[i]!))
          }
        } else {
          const got = columns.map(c => rows.length - 1 - rows.findIndex(r => /[╭╮╯╰│─]/.test(r[c] ?? '')))
          const tallest = Math.max(...got)
          values.forEach((v, i) => expect(Math.abs(got[i]! - (tallest * v) / Math.max(...values)) <= 1).toBe(true))
        }
        await ui.unmount()
      })
    }
  }
}

test('a diagram too wide for the terminal draws full size in a viewer that scrolls, not as its source', async $ => {
  const workers = Array.from({ length: 16 }, (_, i) => `W${i + 1}[Worker ${i + 1}]`).join(' & ')
  const ui = await $.ui.mount(mount('```mermaid\nflowchart TD\n  Q[Queue] --> ' + workers + '\n```'))
  expect(await ui.find({ type: 'Text', text: /^diagram is \d+ cols/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^── mermaid$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^◀ .* ▶ {2}1–\d+ of \d+/, in: 'view0' })).toBeDefined()
  expect(await ui.find({ text: /Worker 1\b/, in: 'view0' })).toBeDefined()
  await ui.unmount()
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the fallback note is drawn in the comment color like the label on ${surface}`, async $ => {
    const ui = await $.ui.mount({ ...mount('```mermaid\nmindmap\n  root((plan))\n```'), surface })
    const note = await ui.find({ type: 'Text', text: /^mindmap diagrams draw as source/ })
    const label = await ui.find({ type: 'Text', text: /^── mermaid$/ })
    expect(note?.props.color).toBe(PRESETS['catppuccin-mocha'].codeComment)
    expect(note?.props).toEqual(label?.props)
    await ui.unmount()
  })
}

test('a diagram the renderer cannot draw shows its source under a failure note', async $ => {
  const ui = await $.ui.mount(mount('```mermaid\nflowchart TD\n' + '  A --> B\n'.repeat(900) + '```'))
  expect(await ui.find({ type: 'Text', text: /^diagram failed to render$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^── mermaid$/ })).toBeDefined()
  await ui.unmount()
})

test('a diagram type the renderer has no drawing for says so instead of failing', async $ => {
  for (const kind of ['mindmap', 'timeline', 'journey', 'gitGraph']) {
    const ui = await $.ui.mount(mount('```mermaid\n' + kind + '\n  title T\n```'))
    expect(await ui.find({ type: 'Text', text: `${kind} diagrams draw as source for now` })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^diagram failed to render$/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('a half-streamed diagram shows no note until its fence closes', async $ => {
  const open = await $.ui.mount(mount('```mermaid\nmindmap\n  root'))
  expect(await open.find({ type: 'Text', text: /diagram|draw as source/ })).toBeUndefined()
  await open.unmount()
  const closed = await $.ui.mount(mount('```mermaid\nmindmap\n  root\n```'))
  expect(await closed.find({ type: 'Text', text: /^mindmap diagrams draw as source for now$/ })).toBeDefined()
  await closed.unmount()
})

test('a pie chart draws one bar per slice, largest first, with its share', () => {
  const art = mermaidText('pie showData title Pets\n  "Cats" : 85\n  "Dogs" : 386\n  "Rats" : 0\n  "Mice" : 0.5', false, 80)!.split('\n')
  expect(art[0]).toBe('Pets')
  expect(art.slice(1).map(l => l.split(' ')[0])).toEqual(['Dogs', 'Cats', 'Mice', 'Rats'])
  expect(art[1]).toMatch(/█ 386  82%$/)
  expect(art[3]).toMatch(/<1%$/)
  expect(art[4]).not.toContain('█')
  expect(new Set(art.slice(1).map(l => width(l))).size).toBe(1)
})

test('a round pie draws a circle with a legend, largest slice first', () => {
  const art = mermaidText('pie showData title Pets\n  "Cats" : 85\n  "Dogs" : 386\n  "Rats" : 15', false, 80, 7)!.split('\n')
  expect(art[0]).toBe('Pets')
  expect(art).toHaveLength(13)
  expect(art[1]).toMatch(/^ +▄▄▟█+▙▄▄$/)
  expect(art[12]).toMatch(/^ +▀▀▜█+▛▀▀$/)
  expect(art.slice(5, 8).map(l => l.split('   ██ ')[1])).toEqual(['Dogs 386  79%', 'Cats  85  17%', 'Rats  15   3%'])
})

test('a round pie falls back to bars in ascii mode, past seven slices and when the terminal is too narrow', () => {
  const pie = 'pie\n  "Dogs" : 386\n  "Cats" : 85'
  const many = `pie\n${[1, 2, 3, 4, 5, 6, 7, 8].map(n => `  "s${n}" : ${n}`).join('\n')}`
  for (const [source, ascii, columns] of [[pie, true, 80], [many, false, 80], [pie, false, 30]] as const)
    expect(mermaidText(source, ascii, columns, 7)).toBe(mermaidText(source, ascii, columns, 0))
  expect(mermaidText(pie, false, 80, 7)).toContain('▟')
})

test('each round pie slice and its legend swatch share one color', async $ => {
  const source = '```mermaid\npie title Pets\n  "Dogs" : 386\n  "Cats" : 85\n  "Rats" : 15\n```'
  const ui = await $.ui.mount(mount(source))
  const shown = await runsOf(ui)
  const swatches = ['Dogs', 'Cats', 'Rats'].map(label => shown[shown.findIndex(n => n.text === label) - 1]?.paint.color)
  expect(new Set(swatches).size).toBe(3)
  expect((await runsOf(ui, /^▜█+▛$/))[0]?.paint.color).toBe(swatches[0])
  await ui.unmount()
})

const runs = async (ui: { findAll: (q: { type: string }) => Promise<{ text?: string; props: { color?: string } }[]> }) => (await ui.findAll({ type: 'Text' })).map(n => `${n.text}|${n.props.color}`)

const fiveSlices = '```mermaid\npie\n  "a" : 5\n  "b" : 4\n  "c" : 3\n  "d" : 2\n  "e" : 1\n```'
const fourSlices = '```mermaid\npie\n  "a" : 4\n  "b" : 3\n  "c" : 2\n  "d" : 1\n```'

for (const [theme, source, round] of [['dracula', fiveSlices, false], ['dracula', fourSlices, true], ['mono', fourSlices, false], ['catppuccin-mocha', fiveSlices, true]] as const)
  test(`a round pie of ${source === fiveSlices ? 5 : 4} slices in ${theme} draws ${round ? 'round' : 'bars'}, since each slice needs its own theme color`, { options: { theme } }, async $ => {
    const ui = await $.ui.mount(mount(source))
    expect(!!(await ui.find({ type: 'Text', text: /▟/ }))).toBe(round)
    await ui.unmount()
  })

test('two pies that draw the same art but split it differently each keep their own slice colors', async $ => {
  const pie = (a: number, b: number) => '```mermaid\npie\n  "A" : ' + a + '\n  "B" : ' + b + '\n```'
  const drawn: string[][] = []
  for (const [a, b] of [[5103, 4897], [5104, 4896], [5103, 4897]] as const) {
    const ui = await $.ui.mount(mount(pie(a, b)))
    drawn.push(await runs(ui))
    await ui.unmount()
  }
  expect(drawn[0]!.filter(r => !r.includes('|undefined')).join()).not.toBe(drawn[1]!.filter(r => !r.includes('|undefined')).join())
  expect(drawn[2]).toEqual(drawn[0])
})

test('pieStyle bars draws one bar per slice', { options: { pieStyle: 'bars' } }, async $ => {
  const ui = await $.ui.mount(mount('```mermaid\npie title Pets\n  "Dogs" : 386\n  "Cats" : 85\n```'))
  expect(await ui.find({ type: 'Text', text: /▟/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Dogs  / })).toBeDefined()
  await ui.unmount()
})

test('a gantt chart places each task on a shared time axis', () => {
  const art = mermaidText('gantt\n  dateFormat YYYY-MM-DD\n  section Build\n  Parse :p, 2026-10-01, 7d\n  Draw :after p, 7d\n  Ship :milestone, 2026-10-15, 0d', false, 80)!.split('\n')
  expect(art[0]!.trim().startsWith('10-01')).toBe(true)
  expect(art[1]!.trim()).toMatch(/^▏(─+▏)+$/)
  const span = (line: string) => [line.indexOf('█'), line.lastIndexOf('█')]
  const [parse, draw] = [span(art[3]!), span(art[4]!)]
  expect(draw[0]).toBe(parse[1]! + 1)
  expect(draw[1]! - draw[0]!).toBe(parse[1]! - parse[0]!)
  expect(art[5]!.indexOf('◆')).toBe(draw[1])
  expect(art[2]).toBe('Build')
})

const FINE_GANTT = 'gantt\n  dateFormat YYYY-MM-DD\n  section Build\n  Two days :a, 2026-10-01, 2d\n  Two and a bit :b, 2026-10-01, 2.4d\n  Two and a half :c, 2026-10-01, 2.5d\n  Rest :d, after a, 5d'

test('gantt bars end on an eighth of a cell and start on a half, so close durations draw apart', () => {
  const art = mermaidText(FINE_GANTT, false, 80)!.split('\n')
  const bar = (name: string) => art.find(l => l.trimStart().startsWith(name))!.slice(18)
  expect(new Set(['Two days', 'Two and a bit', 'Two and a half'].map(bar)).size).toBe(3)
  expect(bar('Two days')).toMatch(/^█+[▎▍▌▋▊▉]$/)
  expect(bar('Rest').trimStart()).toMatch(/^▐█+$/)
  expect(mermaidText('gantt\n  dateFormat YYYY-MM-DD\n  A :a, 2026-10-01, 2d', true, 80)).not.toMatch(/[▐▏▎▍▌▋▊▉]/)
})

test('a gantt bar end drawn in part of a cell takes its bar color, while axis ticks keep theirs', async $ => {
  const ui = await $.ui.mount(mount('```mermaid\n' + FINE_GANTT + '\n```', 80))
  expect((await runsOf(ui, /^█+[▎▍▌▋▊▉]$/)).length).toBeGreaterThan(0)
  expect((await runsOf(ui, /^▐█+$/)).length).toBeGreaterThan(0)
  expect((await runsOf(ui, /^▏(─+▏)+─*$/))[0]?.paint.color).toBe(PRESETS['catppuccin-mocha'].diagram)
  await ui.unmount()
})

test('pie and gantt sources the chart cannot read show a failure note, not a broken chart', async $ => {
  for (const source of ['pie\n  "a" : -1', 'pie\n  "a" : 0', 'gantt\n  Task : 3d', 'gantt\n  dateFormat X\n  Task : 1, 2', 'gantt\n  Task : after nope, 1d']) {
    expect(mermaidText(source, false, 80)).toBeNull()
    const ui = await $.ui.mount(mount('```mermaid\n' + source + '\n```'))
    expect(await ui.find({ type: 'Text', text: /^diagram failed to render$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('pie and gantt charts shrink to a narrow terminal and use plain glyphs in ascii mode', () => {
  const pie = 'pie\n  "A very long slice label that goes on" : 3\n  "b" : 1'
  const gantt = 'gantt\n  dateFormat HH:mm\n  Deploy : 10:00, 45m\n  Verify : 30m'
  for (const source of [pie, gantt]) {
    expect(Math.max(...mermaidText(source, false, 50)!.split('\n').map(width)) <= 48).toBe(true)
    expect(mermaidText(source, true, 80)).not.toMatch(/[█▏─◆]/)
  }
  expect(mermaidText(gantt, false, 80)).toContain('10:00')
})

test('a diagram that fits draws without a note', async $ => {
  const ui = await $.ui.mount(mount('```mermaid\nflowchart LR\n  A --> B\n```'))
  expect(await ui.find({ type: 'Text', text: /^diagram (is|failed)/ })).toBeUndefined()
  await ui.unmount()
})

const STEPS = '1. Setup:\n   ```bash\n   npm i\n   ```\n   Then build.\n2. Next'

const listOf = (source: string) => {
  const [list] = parse(source, hl)
  if (list?.kind !== 'list') throw new Error('not a list')
  return list
}

test('a fence under a list item is a code block inside that item, and text after it stays in the item', async () => {
  const list = listOf(STEPS)
  expect(list.items.map(i => [i.marker, inlineText(i.inline)])).toEqual([['1.', 'Setup:'], ['2.', 'Next']])
  const [code, after] = list.items[0]?.blocks ?? []
  expect(code?.kind === 'code' && [code.lang, code.lines, code.isOpen]).toEqual(['bash', ['npm i'], undefined])
  expect(after?.kind === 'paragraph' && inlineText(after.inline)).toBe('Then build.')
  expect(list.raw).toBe(STEPS)
})

test('a blank line inside a fence under a list item keeps the list and the rest of the reply intact', async () => {
  const blocks = parse('1. Setup:\n   ```bash\n   a\n\n   b\n   ```\n2. Next\n\n## Phase 3\ntext', hl)
  expect(blocks.map(b => b.kind)).toEqual(['list', 'heading', 'paragraph'])
  const list = blocks[0]
  if (list?.kind !== 'list') throw new Error('not a list')
  expect(list.items.map(i => i.marker)).toEqual(['1.', '2.'])
  const code = list.items[0]?.blocks?.[0]
  expect(code?.kind === 'code' && code.lines).toEqual(['a', '', 'b'])
})

test('an unindented fence after a list ends the list', async () => {
  expect(parse('1. a\n```bash\nx\n```', hl).map(b => b.kind)).toEqual(['list', 'code'])
})

test('a fence under an item ends where the item does when it never closes', async () => {
  const blocks = parse('1. Setup:\n   ```bash\n   npm i\n\n## Next\ntext', hl)
  expect(blocks.map(b => b.kind)).toEqual(['list', 'heading', 'paragraph'])
  const code = blocks[0]?.kind === 'list' ? blocks[0].items[0]?.blocks?.[0] : undefined
  expect(code?.kind === 'code' && [code.lines, code.isOpen]).toEqual([['npm i'], undefined])
})

test('a half-streamed fence under a list item is an open code block in the item', async () => {
  const code = listOf('1. Setup:\n   ```bash\n   npm i').items[0]?.blocks?.[0]
  expect(code?.kind === 'code' && [code.lines, code.isOpen]).toEqual([['npm i'], true])
})

test('footnotes after a fence inside a list item are numbered', async () => {
  const [list] = parse('1. a\n   ```\n   x\n   ```\n   see[^n]\n\n[^n]: note', hl)
  const after = list?.kind === 'list' ? list.items[0]?.blocks?.[1] : undefined
  expect(after?.kind === 'paragraph' && after.inline.some(n => n.kind === 'footnote' && n.text === '¹')).toBe(true)
})

test('a code block under a list item draws indented inside the list with its own copy button', async ($, on) => {
  const copied = recordCopies(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    copied.length = 0
    const ui = await $.ui.mount({ ...mount(STEPS), surface })
    const header = await ui.find({ type: 'Text', text: /^── bash$/ })
    expect(header).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^2\. $/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Then build\.$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /```/ })).toBeUndefined()
    const indented = (await ui.findAll({ type: 'Box' })).find(b => b.props.paddingLeft === 3 && b.text?.includes('npm i'))
    expect(indented?.text).toContain('Then build.')
    await ui.press({ key: 'b0.0.copy0' })
    expect(copied).toEqual(['npm i'])
    await ui.unmount()
  }
})

test('terminal control sequences in a reply never reach the drawn text', async $ => {
  const text = [
    'copy this \x1b]52;c;cm0gLXJmIH4=\x07 now',
    'a [link](https://example.com) and \x1b]8;;https://evil.test\x1b\\hidden\x1b]8;;\x1b\\',
    '| col \x1b[31mred\x1b[0m |\n|---|\n| \x1b[2J cell |',
    '```sh\necho \x1b]52;c;eA==\x07 done\n```',
  ].join('\n\n')
  const ui = await $.ui.mount(mount(text))
  const all = (await ui.findAll({ type: 'Text' })).map(drawn).join('\n')
  await ui.unmount()
  expect(all).toContain('copy this')
  expect(all).toContain('hidden')
  expect(all).not.toMatch(/evil\.test|\]52;|\]8;;|\[2J|\[31m/)
  expect(/[\x00-\x08\x0b-\x1f\x7f]/.test(all)).toBe(false)
})

test('a localhost lookalike host stays link text on desktop, which links plain http only for localhost', async $ => {
  const ui = await $.ui.mount({ ...mount('[a](http://localhost@evil.example/) [b](http://localhost.evil.example/) [c](http://localhost:3000/x) [d](http://localhost)'), surface: 'desktop' })
  expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toEqual(['http://localhost:3000/x', 'http://localhost'])
  await ui.unmount()
})

test('awk that edits a file in place is not read-only', async () => {
  expect(isReadOnlyCall('Bash', { command: "awk -i inplace '{sub(/a/,\"b\")}1' f.txt" })).toBe(false)
  expect(isReadOnlyCall('Bash', { command: "awk --include=inplace '{print}' f.txt" })).toBe(false)
  expect(isReadOnlyCall('Bash', { command: "awk '{print $1}' f.txt" })).toBe(true)
})

test('table art fits wide characters into columns too narrow for them', async () => {
  const cols = 26
  const art = tableArt(tableOf(`|${' h |'.repeat(cols)}\n|${'---|'.repeat(cols)}\n|${' 中文中文 |'.repeat(cols)}`))
  expect(art.split('\n').length > 3).toBe(true)
})

for (const [text, cols] of [['©', 1], ['™', 1], ['↔', 1], ['▶', 1], ['⚠', 1], ['⚠️', 2], ['✅', 2], ['🙂', 2], ['🇮🇱', 2], ['1️⃣', 2], ['𠀀', 2], ['中', 2], ['é', 1]] as const) test(`${text} takes ${cols} terminal column${cols > 1 ? 's' : ''}`, async () => {
  expect(width(text)).toBe(cols)
})

test('a mermaid box around a text-style symbol closes', async () => {
  const art = mermaidText('flowchart TD\n  A[sync ↔ async] --> B[done]', false, 80)!
  const box = art.split("\n").slice(0, 3).map(l => [...l.trimEnd()].length)
  expect(new Set(box).size).toBe(1)
})

test('a long unbroken table cell wraps in linear time', async () => {
  const cost = (n: number) => best(() => tableArt(tableOf(`| h |\n|---|\n| ${'a'.repeat(n)} |`)), 3)
  cost(1000)
  const ratios = Array.from({ length: 5 }, () => cost(40000) / Math.max(cost(10000), 0.05))
  expect(Math.min(...ratios)).toBeLessThan(8)
})

for (const command of ['toString', 'constructor', '__proto__', 'hasOwnProperty x']) test(`a command named ${command} is not read-only and does not throw`, async () => {
  expect(isReadOnlyCall('Bash', { command })).toBe(false)
})

for (const command of [`awk '@include "inplace"; {sub(/a/,"b")} 1' f.txt`, `awk '@load "inplace"; 1' f.txt`, 'awk -E prog.awk f.txt', 'awk --exec=prog.awk f.txt', "awk -l inplace -e '1' f.txt"]) test(`${command} is not read-only`, async () => {
  expect(isReadOnlyCall('Bash', { command })).toBe(false)
})

test('localhost links with a query or a hash stay clickable on desktop', async $ => {
  const ui = await $.ui.mount({ ...mount('[a](http://localhost:5173?debug=1) [b](http://localhost#/home) [c](http://localhost.evil.example/)'), surface: 'desktop' })
  expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toEqual(['http://localhost:5173?debug=1', 'http://localhost#/home'])
  await ui.unmount()
})

test('a footnote definition inside a four-backtick fence stays code', async () => {
  const blocks = parse('````text\n```\n[^x]: inside code\n````\n\nSee[^x]', hl)
  expect(blocks.some(b => b.kind === 'notes')).toBe(false)
})

const exact = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)

const barLines = async (ui: { findAll: (query: { type: string; text: RegExp }) => Promise<{ text: string }[]> }) =>
  (await ui.findAll({ type: 'Text', text: /^(│ \n)*│ $/ })).map(bar => bar.text.split('\n').length)

const DRAFT = [
  '> Yeah agreed, definitely a POC. It does check the dispatcher which nothing else does right now.',
  '>',
  '> It also does a few things worth carrying into whatever replaces it:',
  "> - **RoutableServiceNames** reproduces 0.2.0's grammar from reading `dispatcher.py`.",
  "> - That routing check doesn't need a server.",
  '>',
  '> The rest is fine to drop.',
  '>',
  '> *-- Drafted with Claude (Opus 5.5)*',
].join('\n')

for (const surface of ['terminal', 'desktop'] as const) test(`a quote keeps its paragraphs, list rows and styling on ${surface}`, async ($, on) => {
  const copied = stubClipboard(on)
  const t = PRESETS['catppuccin-mocha']
  const ui = await $.ui.mount({ ...mount(DRAFT), surface })
  for (const text of ['Yeah agreed, definitely a POC. It does check the dispatcher which nothing else does right now.', 'It also does a few things worth carrying into whatever replaces it:', 'The rest is fine to drop.', '-- Drafted with Claude (Opus 5.5)']) {
    expect((await ui.find({ type: 'Text', text: exact(text) }))?.props).toMatchObject({ italic: true, color: t.quote })
  }
  expect(await ui.findAll({ type: 'Text', text: /^• $/ })).toHaveLength(2)
  expect(await ui.find({ type: 'Text', text: exact("RoutableServiceNames reproduces 0.2.0's grammar from reading dispatcher.py.") })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: exact("That routing check doesn't need a server.") })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^RoutableServiceNames$/ }))?.props).toMatchObject({ bold: true, color: t.strong })
  expect((await ui.find({ type: 'Text', text: /^dispatcher\.py$/ }))?.props.color).toBe(t.inlineCode)
  expect(Math.max(...(await barLines(ui))) >= 10).toBe(true)
  const buttons = await ui.findAll({ type: 'Button' })
  expect(buttons.map(b => b.props.label)).toEqual(['⧉ copy'])
  await ui.press({ key: buttons[0]!.key! })
  expect(copied).toEqual([DRAFT.split('\n').map(line => line.replace(/^>\s?/, '')).join('\n')])
  await ui.unmount()
})

for (const surface of ['terminal', 'desktop'] as const) test(`a nested quote draws with its own bar inside the outer one on ${surface}`, async $ => {
  const ui = await $.ui.mount({ ...mount('> outer\n>\n> > inner one\n> > inner two\n>\n> after'), surface })
  for (const text of [/^outer$/, /^inner one inner two$/, /^after$/]) expect(await ui.find({ type: 'Text', text })).toBeDefined()
  expect(await ui.find({ type: 'Box', text: /^│ inner one inner two$/ })).toBeDefined()
  expect(Math.max(...(await barLines(ui))) >= 5).toBe(true)
  await ui.unmount()
})

for (const surface of ['terminal', 'desktop'] as const) test(`an alert keeps a list in its body on ${surface}`, async ($, on) => {
  const copied = stubClipboard(on)
  const source = '> [!NOTE]\n> Before you merge:\n> - run the tests\n> - update the CHANGELOG'
  const ui = await $.ui.mount({ ...mount(source), surface })
  expect(await ui.find({ type: 'Text', text: /^Note$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Before you merge:$/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: /^• $/ })).toHaveLength(2)
  for (const text of [/^run the tests$/, /^update the CHANGELOG$/]) expect(await ui.find({ type: 'Text', text })).toBeDefined()
  expect((await ui.findAll({ type: 'Box' })).find(b => b.props.borderStyle === 'round')?.text).toContain('update the CHANGELOG')
  const buttons = await ui.findAll({ type: 'Button' })
  expect(buttons.map(b => b.props.label)).toEqual(['⧉ copy'])
  await ui.press({ key: buttons[0]!.key! })
  expect(copied).toEqual(['[!NOTE]\nBefore you merge:\n- run the tests\n- update the CHANGELOG'])
  await ui.unmount()
})

for (const surface of ['terminal', 'desktop'] as const) test(`a code block and a table inside a quote fit beside the bar and copy their own source on ${surface}`, async ($, on) => {
  const copied = stubClipboard(on)
  const t = PRESETS['catppuccin-mocha']
  const table = `| Check | Result |\n|---|---|\n| lint | ${'passes on every package '.repeat(4).trim()} |`
  const source = `Before.\n\n> Run it:\n>\n> \`\`\`bash\n> npm test\n> \`\`\`\n>\n${table.split('\n').map(line => `> ${line}`).join('\n')}`
  const ui = await $.ui.mount({ ...mount(source, 60), surface })
  expect(await ui.find({ type: 'Text', text: /^── bash$/ })).toBeDefined()
  if (surface === 'desktop') expect((await ui.find({ type: 'Code' }))?.props.source).toBe('npm test')
  else expect((await ui.find({ type: 'Text', text: /^npm$/ }))?.props.color).toBe(t.codeCommand)
  expect((await ui.find({ type: 'Text', text: /^Check$/ }))?.props.color).toBe(t.tableHeader)
  const edge = (await shownLines(ui)).find(l => /^┌[─┬]+┐$/.test(l))
  expect(width('│ ') + width(edge!) + 2 + width('[ ⧉ copy ]') <= 60 - 4).toBe(true)
  const labels = (await ui.findAll({ type: 'Button' })).map(b => b.props.label)
  expect(labels.filter(l => l === '⧉ copy')).toHaveLength(2)
  expect(labels.filter(l => l === '⧉ md')).toHaveLength(1)
  await ui.press({ key: 'b1.copy1' })
  await ui.press({ key: 'b1.copy2' })
  await ui.press({ key: 'reply' })
  expect(copied).toEqual(['npm test', table, source])
  await ui.unmount()
})

for (const surface of ['terminal', 'desktop'] as const) test(`footnotes number and links stay readable inside a quote on ${surface}`, async $ => {
  const t = PRESETS['catppuccin-mocha']
  const source = '> Intro.\n>\n> - Latency fell[^lat], see [run](javascript:alert(1)) and [docs](https://example.com).\n>\n> [^q]: Quoted note.\n\nAlso[^q].\n\n[^lat]: Median of 50 runs.'
  const ui = await $.ui.mount({ ...mount(source), surface })
  expect(await ui.find({ type: 'Text', text: /^Latency fell¹, see run \(javascript:alert\(1\)\) and / })).toBeDefined()
  expect(await paintOf(ui, 'run (javascript:alert(1))')).toBeDefined()
  expect((await paintOf(ui, '¹'))?.color).toBe(t.accent)
  expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toEqual(['https://example.com'])
  expect(await ui.find({ type: 'Text', text: /^Also²\.$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^¹ Median of 50 runs\.$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^² Quoted note\.$/ })).toBeDefined()
  expect((await ui.find({ type: 'Box', key: 'b0' }))?.text).not.toContain('Quoted note')
  await ui.unmount()
})

for (const copyButtons of [true, false]) test(`a quote ${copyButtons ? 'beside its copy button' : 'without a copy button'} sizes its bar for the width left`, { options: { copyButtons } }, async $ => {
  const ui = await $.ui.mount(mount(`> ${'word '.repeat(10)}end`, 60))
  expect(Math.max(...(await barLines(ui))) > 1).toBe(copyButtons)
  await ui.unmount()
})

test('a quote bar covers a wrapped banner heading and its rule', { options: { headingStyle: 'banner', copyButtons: false } }, async $ => {
  const ui = await $.ui.mount(mount(`> ## ${'A'.repeat(300)}`, 60))
  expect(Math.max(...(await barLines(ui))) >= 2 * Math.ceil(300 / (60 - 4 - 2))).toBe(true)
  await ui.unmount()
})

test('a quote bar covers a task list progress line that wraps', { options: { taskStyle: 'progress', copyButtons: false } }, async $ => {
  const ui = await $.ui.mount(mount('> - [ ] x', 24))
  expect(Math.max(...(await barLines(ui))) >= 3).toBe(true)
  await ui.unmount()
})

for (const surface of ['terminal', 'desktop'] as const) test(`a quote bar stays in the flow, clipped to the quote's rows, on ${surface}`, async $ => {
  const ui = await $.ui.mount({ ...mount(DRAFT), surface })
  const boxes = await ui.findAll({ type: 'Box' })
  const clips = boxes.filter(b => b.props.overflow === 'hidden' && b.props.height === 0 && b.props.flexGrow === 1)
  expect(clips.some(b => /^(│ \n){9,}│ $/.test(drawn(b)))).toBe(true)
  expect(boxes.some(b => b.props.position === 'absolute' && drawn(b).includes('│'))).toBe(false)
  await ui.unmount()
})

test('footnotes follow quotes and fences: a quoted fence marker inside code makes no note, and an unclosed quoted fence hides none', async () => {
  const marks = (source: string) => parse(source, hl).flatMap(b => (b.kind === 'notes' ? b.notes.map(n => `${n.mark} ${inlineText(n.inline)}`) : []))
  expect(marks('```md\n> ```\n[^fake]: Not a real note\n```\n\nReal[^real].\n\n[^real]: Real note')).toEqual(['¹ Real note'])
  expect(marks('> ```\n> [^x]: in code\n\nTop[^top].\n\n[^top]: Top note')).toEqual(['¹ Top note'])
  expect(marks('> a[^q]\n>\n> > [^q]: Nested note\n> >   continued')).toEqual(['¹ Nested note continued'])
})

for (const copyButtonStyle of ['inline', 'hover'] as const) test(`a quote that opens with code puts its own ${copyButtonStyle} copy button on its last row`, { options: { copyButtonStyle } }, async $ => {
  const ui = await $.ui.mount(mount('> ```bash\n> npm test\n> ```\n>\n> Run that first.\n\n> One line.'))
  const boxes = await ui.findAll({ type: 'Box' })
  const low = boxes.filter(b => (copyButtonStyle === 'hover' ? b.props.display === 'none' && b.props.bottom === 0 && b.props.right === 0 && b.text !== '⧉ copy reply' : b.props.alignSelf === 'flex-end' && b.key !== 'reply'))
  expect(low.map(b => b.text)).toEqual(['⧉ copy'])
  expect(boxes.filter(b => b.props.position === 'absolute' && b.props.top === 0 && b.props.display === 'none' && b.text !== '⧉ copy reply').map(b => b.text)).toEqual(copyButtonStyle === 'hover' ? ['⧉ copy', '⧉ copy'] : [])
  await ui.unmount()
})

type FloatNode = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const floatKids = (node: FloatNode) => (node.children ?? []).filter((child): child is FloatNode => !!child && typeof child === 'object')
const floatLabels = (node: FloatNode): string[] => (node.type === 'Button' ? [String(node.props?.label)] : floatKids(node).flatMap(floatLabels))
const floatRoom = (node: FloatNode, room = 0): { labels: string[]; needs: number; room: number }[] => {
  if (node.props?.position === 'absolute' && node.props.display === 'none') {
    const labels = floatLabels(node)
    return [{ labels, needs: labels.reduce((w, label) => w + (w ? 1 : 0) + width(`[ ${label} ]`), 0), room }]
  }
  const here = typeof node.props?.minWidth === 'number' ? node.props.minWidth : room
  return floatKids(node).flatMap(child => floatRoom(child, here))
}
const hoverFloats = async (ui: { findAll: (query: { type: string }) => Promise<{ props: Record<string, unknown>; text?: string }[]> }) =>
  (await ui.findAll({ type: 'Box' })).filter(b => b.props.position === 'absolute' && b.props.display === 'none' && b.text !== '⧉ copy reply')

test('copyButtonStyle hover reserves every floating button\'s width on the block it floats over', { options: { copyButtonStyle: 'hover' } }, async $ => {
  const ui = await $.ui.mount(mount('| a |\n|---|\n| 1 |\n\n```\nx\n```\n\n- y\n\n> z\n\n> [!NOTE]\n> w\n\n> ```\n> q\n> ```\n\n- item\n  ```\n  v\n  ```\n\n```mermaid\nflowchart LR\n  A --> B\n```'))
  const floats = floatRoom((await ui.drawn()) as FloatNode).filter(f => !f.labels.includes('⧉ copy reply'))
  expect(floats.length).toBeGreaterThanOrEqual(9)
  for (const float of floats) expect({ ...float, fits: float.room >= float.needs }).toMatchObject({ fits: true })
  await ui.unmount()
})

test('copyButtonStyle hover puts the button of a quote whose nested quote opens with code on its last row, clear of the code\'s own', { options: { copyButtonStyle: 'hover' } }, async $ => {
  const ui = await $.ui.mount(mount('> > ```bash\n> > ls\n> > ```\n>\n> text'))
  const floats = await hoverFloats(ui)
  expect(floats.filter(b => b.props.top === 0).map(b => b.text)).toEqual(['⧉ copy'])
  expect(floats.filter(b => b.props.bottom === 0).map(b => b.text)).toEqual(['⧉ copy'])
  await ui.unmount()
})

test('copyButtonStyle hover gives a quote holding only an empty code block one button, so two never share its single row', { options: { copyButtonStyle: 'hover' } }, async $ => {
  for (const text of ['> ```\n> ```', '> > ```\n> > ```']) {
    const ui = await $.ui.mount(mount(text))
    expect((await hoverFloats(ui)).map(b => b.text)).toEqual(['⧉ copy'])
    await ui.unmount()
  }
})

test('copyButtonStyle hover keeps Hebrew quotes and alerts on the right, as inline does', { options: { copyButtonStyle: 'hover', rtl: 'warp' } }, async $ => {
  for (const text of ['> שלום עולם', '> [!NOTE]\n> שלום עולם']) {
    const ui = await $.ui.mount(mount(text))
    expect((await ui.find({ key: 'c0' }))?.props.alignSelf).toBeUndefined()
    await ui.unmount()
  }
})

test('copyButtonStyle hover anchors the buttons of a right-to-left block at its left, where its lines end', { options: { copyButtonStyle: 'hover', rtl: 'warp' } }, async $ => {
  const anchors = async (text: string) => {
    const ui = await $.ui.mount(mount(text))
    const sides = (await hoverFloats(ui)).map(b => (b.props.left === 0 && b.props.right === undefined ? 'left' : b.props.right === 0 && b.props.left === undefined ? 'right' : 'both'))
    await ui.unmount()
    return sides
  }
  expect(await anchors('- שלום עולם\n- עוד פריט')).toEqual(['left'])
  expect(await anchors('> שלום עולם')).toEqual(['left'])
  expect(await anchors('> [!NOTE]\n> שלום עולם')).toEqual(['left'])
  expect(await anchors('| שם | ערך |\n|---|---|\n| אחד | שתיים |')).toEqual(['left'])
  expect(await anchors('- hello שלום\n- world')).toEqual(['right'])
  expect(await anchors('- hello\n- world')).toEqual(['right'])
})

test('copyButtonStyle hover puts the ⧉ of a right-to-left block at its left, where its lines end', { options: { copyButtonStyle: 'hover', rtl: 'warp' } }, async $ => {
  const side = async (text: string) => {
    const ui = await $.ui.mount(mount(text))
    const row = (await ui.find({ key: 'c0' }))!.children[0] as FloatNode
    const flow = floatKids(row).filter(child => child.props?.position !== 'absolute')
    const marked = (child?: FloatNode) => !!(child as { hover?: { scope?: string } } | undefined)?.hover?.scope
    await ui.unmount()
    return marked(flow[0]) ? 'left' : marked(flow.at(-1)) ? 'right' : 'none'
  }
  expect(await side('- שלום עולם\n- עוד פריט')).toBe('left')
  expect(await side('> שלום עולם')).toBe('left')
  expect(await side('> [!NOTE]\n> שלום עולם')).toBe('left')
  expect(await side('| שם | ערך |\n|---|---|\n| אחד | שתיים |')).toBe('left')
  expect(await side('- hello שלום\n- world')).toBe('right')
  expect(await side('- hello\n- world')).toBe('right')
})

for (const surface of ['terminal', 'desktop'] as const) test(`display math inside a quote or a list item draws as text on ${surface}`, async $ => {
  const ui = await $.ui.mount({ ...mount('> $$\n> E = mc^2 \\cdot \\alpha\n> $$\n\n- energy:\n  ```math\n  \\pi r^2\n  ```'), surface })
  expect((await ui.find({ type: 'Text', text: /^E = mc² · α$/ }))?.props).toMatchObject({ italic: true, color: PRESETS['catppuccin-mocha'].emphasis })
  expect(await ui.find({ type: 'Text', text: /^πr²$|^π r²$/ })).toBeDefined()
  await ui.unmount()
})

test('a quote with nothing to draw is left out', async () => {
  expect(parse('> [^q]: A note.\n\nSee[^q].', hl).map(b => b.kind)).toEqual(['paragraph', 'notes'])
  expect(parse('>\n> \n\ntext', hl).map(b => b.kind)).toEqual(['paragraph'])
  expect(parse('> [!NOTE]', hl).map(b => b.kind)).toEqual(['alert'])
})

test('quotes nested past eight levels keep their text and parse in linear time', async () => {
  const started = Date.now()
  const [block] = parse(`${'>'.repeat(20000)} deep`, hl)
  expect(Date.now() - started < 100).toBe(true)
  let depth = 0
  let at = block
  while (at?.kind === 'quote') {
    depth++
    at = at.blocks[0]
  }
  expect(depth).toBe(8)
  expect(at?.kind === 'paragraph' && inlineText(at.inline).endsWith('> deep')).toBe(true)
})

const PROGRAMS = [
  '/Applications/Calculator.app', '/tmp/run/x.command', '/tmp/run/x.exe', '/tmp/run/x.bat', '/tmp/run/x.cmd', '/tmp/run/x.ps1', '/tmp/run/x.vbs', '/tmp/run/x.js',
  '/tmp/run/x.hta', '/tmp/run/x.lnk', '/tmp/run/x.desktop', '/tmp/run/x.sh', '/tmp/run/x.msi', '/tmp/run/x.scr', '/tmp/run/x.jar', '/tmp/run/x.py', '/tmp/run/x.url',
  '/tmp/run/x.AppImage', '/tmp/run/X.EXE', '/tmp/run/Setup.Command', '/tmp/run/x.Sh', '/tmp/run/x.pdf.exe', '/Applications/Calculator.app/', '/Applications/Calculator.app/Contents/MacOS/Calculator',
]

const DOCUMENTS = ['/tmp/doc/a.ts', '/tmp/doc/a.md', '/tmp/doc/a.json', '/tmp/doc/a.png', '/tmp/doc/a.txt', '/tmp/doc/a.html', '/tmp/doc/a.exe.txt', '/tmp/doc/scripts/', '/tmp/chart.js/README.md']

for (const surface of ['terminal', 'desktop'] as const) {
  test(`paths to programs and launchers stay plain colored text on ${surface}, while documents link`, async ($, on) => {
    filesAt(on, '2.1.289')
    if (!(await linksHttp($.ui.mount(mount('[/x](file:///x)'))))) return
    const ui = await $.ui.mount({ ...mount([...PROGRAMS, ...DOCUMENTS].join(' and '), 1000), surface })
    expect((await ui.findAll({ type: 'Link' })).map(l => l.props.label)).toEqual(surface === 'terminal' ? DOCUMENTS : [])
    for (const path of PROGRAMS) expect([path, (await ui.find({ type: 'Text', text: exact(path) }))?.props.color]).toEqual([path, PRESETS['catppuccin-mocha'].path])
    await ui.unmount()
  })

  test(`file:// links to programs and launchers draw as text on ${surface}, whatever their case, slash, query, fragment or encoding`, async ($, on) => {
    filesAt(on, '2.1.289')
    if (!(await linksHttp($.ui.mount(mount('[/x](file:///x)'))))) return
    const programs = ['file:///tmp/x.exe?y=1', 'file:///tmp/x.EXE#top', 'file:///Applications/Calculator.app/', 'file:///tmp/x%2Ecommand', 'file:///C:/x.exe.', 'file:///C:/x.exe::$DATA', 'file:///tmp/x.exe%00.txt', 'file://server/share/setup.msi']
    const documents = ['file:///tmp/a.html#x.exe', 'file:///tmp/report.md?open=x.exe', 'file:///tmp/x.exe.txt']
    const ui = await $.ui.mount({ ...mount([...programs, ...documents].map(href => `[${href}](${href})`).join(' and '), 1000), surface })
    expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toEqual(surface === 'terminal' ? documents : [])
    for (const href of programs) expect([href, (await paintOf(ui, href)) !== undefined]).toEqual([href, true])
    await ui.unmount()
  })

  for (const toolOutput of ['full', 'quiet'] as const) {
    test(`tool rows and shell edit cards keep programs and launchers as plain colored text on ${surface} (toolOutput ${toolOutput})`, { options: { toolOutput } }, async ($, on) => {
      filesAt(on, '2.1.289')
      if (!(await linksHttp($.ui.mount(mount('[/x](file:///x)'))))) return
      let calls = 0
      const row = async (tool: string, input: unknown) => {
        const ui = await $.ui.mount({ plugin: 'merman', surface, component: 'ToolUse', props: toolCall(tool, input, `launcher-${calls++}`) })
        const links = await linkPairs(ui)
        await ui.unmount()
        return links
      }
      expect(await row('Read', { file_path: '/work/app/install.sh' })).toEqual([])
      expect(await row('Edit', { file_path: 'C:\\Users\\me\\run.PS1' })).toEqual([])
      expect(await row('Read', { file_path: '\\\\server\\share\\setup.exe' })).toEqual([])
      expect(await row('Grep', { pattern: 'x', path: '/Applications/Calculator.app/' })).toEqual([])
      expect(await row('Read', { file_path: '/work/app/src/app.ts' })).toEqual(surface === 'terminal' ? [['src/app.ts', 'file:///work/app/src/app.ts']] : [])
      const grouped = [toolCall('Read', { file_path: '/work/app/src/app.ts' }, 'launcher-g1'), toolCall('Read', { file_path: '/work/app/install.sh' }, 'launcher-g2')]
      const group = await $.ui.mount({ plugin: 'merman', surface, component: 'ToolGroup', props: { calls: grouped, isActive: false, isExpanded: false } })
      expect(await linkPairs(group)).toEqual(surface === 'terminal' && toolOutput === 'quiet' ? [['src/app.ts', 'file:///work/app/src/app.ts']] : [])
      await group.unmount()
      const output = { stdout: '', stderr: '', interrupted: false, bashEditDiff: { files: [{ filePath: '/work/app/build.sh', hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: ['+one'] }] }], moreFiles: 0 } }
      const ui = await $.ui.mount({ plugin: 'merman', surface, component: 'ToolResult', props: { tool_use_id: 'launcher-card', tool: 'Bash', output, isErrored: false } })
      expect(await ui.findAll({ type: 'Link' })).toHaveLength(0)
      expect((await ui.find({ type: 'Text', text: /^build\.sh $/ }))?.props.color).toBe(PRESETS['catppuccin-mocha'].path)
      await ui.unmount()
    })
  }
}

test('a clickable Bash-edits diff keeps its linked file title as text, since a Button holds no Link', async ($, on) => {
  const style = { ...resolveStyle({}), pressPreview: true, httpLinks: true, fileLinks: 'file://', pathLinks: true, home: '/home/me', cwd: '/work/app' }
  const rows = Array.from({ length: 30 }, (_, i) => ({ mark: '+' as const, num: i + 1, text: `line ${i}`, hunk: 0 }))
  let drawn: unknown
  on('ui.render', ($, e) => {
    const el = $.ui.resolve(e)
    const fold = (_id: string, _hidden: number, key: string) => ({ folded: true, faced: false, element: <el.Button key={key} label="more" onPress={() => {}} />, around: (r: never) => <el.Button key={`${key}.rows`} plain label="more" onPress={() => {}}>{r}</el.Button> })
    drawn = renderBashEdits(el, style, { files: [{ kind: 'modified', path: '/work/app/src/a.ts', rows }], more: 0, shared: false }, fold as never, 'x')
    return <el.Text>engine</el.Text>
  })
  const ui = await $.ui.mount(mount('')).catch(() => undefined)
  if (!ui) return
  await ui.unmount()
  const linkUnderButton = (node: unknown, inButton = false): boolean => {
    if (node === null || typeof node !== 'object') return false
    const n = node as { type?: string; props?: { children?: unknown } ; children?: unknown }
    if (inButton && n.type === 'Link') return true
    const kids = [n.children, n.props?.children].flat(Infinity)
    return kids.some(c => linkUnderButton(c, inButton || n.type === 'Button'))
  }
  expect(drawn).toBeDefined()
  expect(linkUnderButton(drawn)).toBe(false)
})

test('a <br> in a table cell parses as a line break, but not inside a code span', async () => {
  const table = tableOf('| a |\n|---|\n| Then:<br/>• one<BR>• two `x<br>y` |')
  expect(inlineText(table.rows[0]![0]!)).toBe('Then:\n• one\n• two x<br>y')
})

for (const surface of ['terminal', 'desktop'] as const) test(`a <br> in a table cell starts a new row of the cell on ${surface}`, async $ => {
  const ui = await $.ui.mount({ ...mount('| Step | Detail |\n|---|---|\n| Prevent | Then:<br/>• Run `brew install gnu-sed` |'), surface })
  const cells = (await shownLines(ui)).flatMap(l => l.split('│').map(c => c.trim()))
  expect(cells.filter(t => /Detail|Then:|brew/.test(t))).toEqual(['Detail', 'Then:', '• Run brew install gnu-sed'])
  expect(await ui.find({ type: 'Text', text: /<br/ })).toBeUndefined()
  await ui.unmount()
})

test('table art breaks a cell at <br> and sizes the column by its widest line', async () => {
  const lines = tableArt(tableOf('| a |\n|---|\n| short<br>a longer line |')).split('\n')
  expect(lines.filter(l => l.startsWith('│ ')).map(l => l.slice(2, -2).trim())).toEqual(['a', 'short', 'a longer line'])
  expect(lines[1]).toBe('┌───────────────┐')
})

test('a long unbroken word after a <br> wraps on its own line', async () => {
  const lines = tableArt(tableOf(`| h |\n|-|\n| short<br>${'x'.repeat(250)} |`)).split('\n').filter(l => l.startsWith('│ ')).map(l => l.slice(2, -2).trim())
  expect(lines[1]).toBe('short')
  expect(lines.slice(2).join('')).toBe('x'.repeat(250))
})

test('control characters inside a <br> cell are dropped and the break still applies', async () => {
  expect(inlineText(tableOf('| a |\n|-|\n| one\x1b[31m<br>two\x07 |').rows[0]![0]!)).toBe('one\ntwo')
})

test('a quote bar counts every line of a short <br> cell in a wide column', { options: { copyButtons: false } }, async $ => {
  const rows = Array.from({ length: 6 }, (_, i) => `> | ${i} | a<br>b<br>c<br>d |`).join('\n')
  const ui = await $.ui.mount(mount(`> | n | a rather wide header |\n> |-|-|\n${rows}`, 80))
  const bars = (await ui.findAll({ type: 'Text', text: /^(│ \n)*│ $/ })).map(bar => bar.text.split('\n').length)
  expect(Math.max(...bars) >= 6 * 4 + 5 + 4).toBe(true)
  await ui.unmount()
})

test('a footnote mark and a clickable path inside a <br> cell keep working on their own line', async ($, on) => {
  claudeAt(on, '2.1.295')
  mock.env(on, { FORCE_HYPERLINK: '1', HOME: '/home/me' })
  on('session.root', () => ({ value: '/work/app' }))
  if (!(await linksHttp($.ui.mount(mount('[/x](file:///x)'))))) return
  const ui = await $.ui.mount(mount('| Step | Detail |\n|---|---|\n| Fix | Edit ~/notes/todo.md<br>then rerun[^r] |\n\n[^r]: Twice.'))
  expect((await ui.findAll({ type: 'Link' })).map(l => String(l.props.href))).toEqual(['file:///home/me/notes/todo.md'])
  expect(await ui.find({ type: 'Text', text: /^¹ Twice\.$/ })).toBeDefined()
  const cells = (await ui.findAll({ type: 'Box' })).filter(b => typeof b.props.width === 'number' && b.props.flexShrink === 0).map(b => b.text)
  expect(cells).toContain('then rerun¹')
  await ui.unmount()
})

test('copying a table keeps a <br> cell as one cell: a <br> in HTML, a quoted multi-line cell in TSV', async () => {
  const table = tableOf('| a | b |\n|-|-|\n| one<br>**two** | x |')
  expect(tableHtml(table)).toContain('<td style="text-align: left">one<br><strong>two</strong></td>')
  expect(tableText(table)).toBe('a\tb\n"one\ntwo"\tx')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`a tool group counts each call once and leaves out the calls Claude Code folds away (${surface})`, { options: { toolRows: true } }, async $ => {
    const seq = toolCall('Bash', { command: 'seq 1 40' }, 'count-seq')
    const calls = [toolCall('ToolSearch', { query: 'select:Read' }, 'count-search'), seq, seq, toolCall('TodoWrite', { todos: [] }, 'count-todo')]
    const ui = await $.ui.mount({ plugin: 'merman', surface, component: 'ToolGroup', props: { calls, isActive: false, isExpanded: false } })
    expect(await ui.find({ type: 'Text', text: /^Ran 1 command$/ })).toBeDefined()
    expect(await ui.find({ text: /Ran 2|ToolSearch|TodoWrite/ })).toBeUndefined()
    await ui.unmount()
  })
}

test('a tool group of only silently folded calls is left to Claude Code', { options: { toolRows: true } }, async ($, on) => {
  on('ui.render', ($, e) => {
    const el = $.ui.resolve(e)
    return <el.Text>engine</el.Text>
  })
  const ui = await $.ui.mount({ plugin: 'merman', surface: 'terminal', component: 'ToolGroup', props: { calls: [toolCall('ToolSearch', { query: 'select:Read' }, 'only-search')], isActive: false, isExpanded: false } })
  expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
  await ui.unmount()
})
