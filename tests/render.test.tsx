import { expect, test as plainTest } from 'claude-code/testing'
import { test } from './tool-rows'

import { parse } from '../hooks/markdown'
import { PRESETS } from '../hooks/presets'
import { MARK, width } from '../hooks/render'
import { resolveStyle } from '../hooks/theme'
import { clipboardEnv, startSession } from './clipboard-env'
import { paintOf, paintsOf, runsOf, shownLines } from './paint'

const TABLE = [
  '| Service | Regions | Version |',
  '|---|---|---:|',
  '| api-gateway | us, eu | server 2.14.0 |',
  '| billing | us, eu, ap | 1.8.3 |',
].join('\n')

const draw = (text: string) => ({
  plugin: 'merman',
  component: 'AssistantMessage' as const,
  props: { text, isFirstOfReply: true },
  viewport: { columns: 120, rows: 40 },
})

test('parses tables, code, lists and inline decorations', async () => {
  const blocks = parse(`# Title\n\n${TABLE}\n\n- see \`x\` at ~/git/app.ts\n\n\`\`\`bash\ngh pr view 12 --json\n\`\`\``, { numbers: true, paths: true })
  expect(blocks.map(b => b.kind)).toEqual(['heading', 'table', 'list', 'code'])
  const table = blocks[1]
  if (table?.kind !== 'table') throw new Error('not a table')
  expect(table.rows.length).toBe(2)
  expect(table.align[2]).toBe('right')
  expect(table.rows[0]?.[2]?.some(n => n.kind === 'number' && n.text === '2.14.0')).toBe(true)
  const list = blocks[2]
  if (list?.kind !== 'list') throw new Error('not a list')
  expect(list.items[0]?.inline.some(n => n.kind === 'path' && n.text === '~/git/app.ts')).toBe(true)
})

test('escaped pipes stay inside a cell', async () => {
  const [t] = parse('| a | b |\n|---|---|\n| x \\| y | z |', { numbers: false, paths: false })
  if (t?.kind !== 'table') throw new Error('not a table')
  expect(t.rows[0]?.length).toBe(2)
})

test('user colors override the theme, bad colors are ignored', async () => {
  const s = resolveStyle({ theme: 'catppuccin-mocha', tableHeaderColor: '#ff0000', numberColor: 'not a color', pathColor: 'cyan', linkColor: 'javascript:x' })
  expect(s.theme.tableHeader).toBe('#ff0000')
  expect(s.theme.number).toBe(PRESETS['catppuccin-mocha'].number)
  expect(s.theme.path).toBe('cyan')
  expect(s.theme.link).toBe(PRESETS['catppuccin-mocha'].link)
})

test('draws a colored table on terminal and desktop', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...draw(TABLE), surface })
    const header = await ui.find({ type: 'Text', text: /^Service$/ })
    expect(header?.props.color).toBe(PRESETS['catppuccin-mocha'].tableHeader)
    expect(header?.props.bold).toBe(true)
    const version = await ui.find({ type: 'Text', text: /^2\.14\.0$/ })
    expect(version?.props.color).toBe(PRESETS['catppuccin-mocha'].number)
    await ui.unmount()
  }
})

test('options reach the drawing', { options: { tableHeaderColor: '#123456', highlightNumbers: false } }, async $ => {
  const ui = await $.ui.mount({ ...draw(TABLE), surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^Service$/ }))?.props.color).toBe('#123456')
  expect((await ui.find({ type: 'Text', text: /^2\.14\.0$/ }))).toBeUndefined()
  await ui.unmount()
})

test('shell blocks color command and flags', async $ => {
  const ui = await $.ui.mount({ ...draw('```bash\ngh pr review 45 --approve\n```'), surface: 'terminal' })
  expect((await paintOf(ui, 'gh'))?.color).toBe(PRESETS['catppuccin-mocha'].codeCommand)
  expect((await paintOf(ui, '--approve'))?.color).toBe(PRESETS['catppuccin-mocha'].codeFlag)
  await ui.unmount()
})

test('disabled leaves the engine renderer alone', { options: { enabled: false } }, async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await $.ui.mount({ ...draw(TABLE), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^Service$/ })).toBeUndefined()
  expect((await ui.find({ type: "Text", text: /^engine$/ }))?.text).toBe("engine")
  await ui.unmount()
})

test('box art from a mermaid mod above is not shell-colored', async $ => {
  const ui = await $.ui.mount({ ...draw('```\n┌───┐\n│ A │\n└───┘\n```'), surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^│ A │$/ }))?.props.color).toBe(PRESETS['catppuccin-mocha'].codeText)
  await ui.unmount()
})

const FLOW = 'Flow:\n\n```mermaid\ngraph LR\nA[User] --> B[Gateway]\n```'

test('mermaid draws as colored box art', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...draw(FLOW), surface })
    const label = await ui.find({ type: 'Text', text: /Gateway/ })
    expect(label).toBeDefined()
    const user = await paintOf(ui, 'User')
    const gateway = await paintOf(ui, 'Gateway')
    expect(user?.color).toBeDefined()
    expect(user?.color).not.toBe(gateway?.color)
    await ui.unmount()
  }
})

test('mermaid off keeps the source', { options: { mermaid: false } }, async $ => {
  const ui = await $.ui.mount({ ...draw(FLOW), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^graph LR$/ })).toBeDefined()
  await ui.unmount()
})

test('every preset defines every token with a valid color', async () => {
  const tokens = Object.keys(PRESETS['catppuccin-mocha'])
  for (const [name, theme] of Object.entries(PRESETS)) {
    if (name === 'mono') continue
    expect(Object.keys(theme).sort()).toEqual([...tokens].sort())
    for (const value of Object.values(theme)) expect(/^#[0-9a-f]{6}$/.test(value as string)).toBe(true)
  }
})

test('picks a named theme and falls back on unknown names', async () => {
  expect(resolveStyle({ theme: 'dracula' }).theme.tableHeader).toBe('#f1fa8c')
  expect(resolveStyle({ theme: 'neon' }).theme.tableHeader).toBe('#00e5ff')
  expect(resolveStyle({ theme: 'nope' }).theme.tableHeader).toBe(PRESETS['catppuccin-mocha'].tableHeader)
})

const toolRow = (tool: string, input: unknown, extra: Partial<{ isRunning: boolean; isErrored: boolean; isInterrupted: boolean }> = {}) => ({
  plugin: 'merman',
  component: 'ToolUse' as const,
  props: { tool_use_id: 't1', tool, input, isRunning: false, isErrored: false, isInterrupted: false, ...extra },
  viewport: { columns: 120, rows: 40 },
})

test('tool rows read like Ran <command> with shell colors', { options: { toolStyle: 'classic' } }, async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...toolRow('Bash', { command: 'gh pr view 12 --json state' }), surface })
    expect((await ui.find({ type: 'Text', text: /^Ran$/ }))?.props.bold).toBe(true)
    expect((await paintOf(ui, 'gh'))?.color).toBe(PRESETS['catppuccin-mocha'].codeCommand)
    await ui.unmount()
  }
})

test('file tools show the path in the path color and failures say so', async $ => {
  const ui = await $.ui.mount({ ...toolRow('Edit', { file_path: '/tmp/app.ts' }, { isErrored: true }), surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^Edited$/ }))).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^\/tmp\/app\.ts$/ }))?.props.color).toBe(PRESETS['catppuccin-mocha'].path)
  expect((await ui.find({ type: 'Text', text: /failed/ }))).toBeDefined()
  await ui.unmount()
})

test('toolRows off leaves tool rows to the engine', { options: { toolRows: false } }, async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await $.ui.mount({ ...toolRow('Bash', { command: 'ls' }), surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^engine$/ }))).toBeDefined()
  await ui.unmount()
})

for (const surface of ['terminal', 'desktop'] as const) {
  plainTest(`with default options tool rows, groups and results are Claude Code's own (${surface})`, async ($, on) => {
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine</Text>
    })
    const calls = [{ tool_use_id: 'default-seq', tool: 'Bash', input: { command: 'seq 1 40' }, isRunning: false, isErrored: false, isInterrupted: false }]
    const group = await $.ui.mount({ plugin: 'merman', surface, component: 'ToolGroup', props: { calls, isActive: false, isExpanded: false } })
    expect(await group.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
    expect(await group.find({ text: /Ran 1 command/ })).toBeUndefined()
    await group.unmount()
    const row = await $.ui.mount({ ...toolRow('Bash', { command: 'ls' }), surface })
    expect(await row.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
    await row.unmount()
    const write = await $.ui.mount({ plugin: 'merman', surface, component: 'ToolResult', props: { tool_use_id: 'default-write', tool: 'Write', isErrored: false, output: { type: 'create', filePath: '/tmp/a.txt', content: 'one\ntwo\n', structuredPatch: [], originalFile: null } } })
    expect(await write.find({ type: 'Text', text: /^engine$/ })).toBeDefined()
    await write.unmount()
  })
}

test('rgb() and ansi256() colors reach the drawing', { options: { tableHeaderColor: 'rgb(255,204,0)', numberColor: 'ansi256(114)' } }, async $ => {
  const ui = await $.ui.mount({ ...draw(TABLE), surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^Service$/ }))?.props.color).toBe('rgb(255,204,0)')
  expect((await ui.find({ type: 'Text', text: /^2\.14\.0$/ }))?.props.color).toBe('ansi256(114)')
  await ui.unmount()
})

test('bullets nested under a numbered list draw as bullets', async $ => {
  const ui = await $.ui.mount({ ...draw('1. Roll out\n   - canary first'), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^◦ $/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^- $/ })).toBeUndefined()
  await ui.unmount()
})

test('a single-series bar chart highlights the tallest bar and mutes the rest', async $ => {
  const chart = '```mermaid\nxychart-beta\n  x-axis [Mon, Tue, Wed]\n  y-axis 0 --> 9\n  bar [3, 7, 5]\n```'
  const ui = await $.ui.mount({ ...draw(chart), surface: 'terminal' })
  const t = PRESETS['catppuccin-mocha']
  const hues = new Set((await ui.findAll({ type: 'Text', text: /^█+$/ })).map(b => b.props.color))
  expect([...hues].sort()).toEqual([t.emphasis, t.quote].sort())
  await ui.unmount()
})

test('each line of a multi-line chart and its legend swatch share one color, distinct from the other lines', async $ => {
  const chart = '```mermaid\nxychart-beta\n  x-axis [a, b, c, d]\n  y-axis 0 --> 10\n  line [9, 9, 9, 9]\n  line [5, 5, 5, 5]\n  line [1, 1, 1, 1]\n```'
  const ui = await $.ui.mount({ ...draw(chart), surface: 'terminal' })
  const lines = (await runsOf(ui, /^─{4,}$/)).map(l => l.paint.color)
  expect(new Set(lines).size).toBe(3)
  const swatches = (await runsOf(ui, /^─$/)).map(s => s.paint.color)
  expect(new Set(swatches)).toEqual(new Set(lines))
  await ui.unmount()
})

test('a named series shows its name in the legend and a nameless one keeps Line N', async $ => {
  const chart = '```mermaid\nxychart-beta\n  x-axis [a, b, c]\n  y-axis 0 --> 10\n  line "east" [8, 8, 8]\n  line [2, 2, 2]\n```'
  const ui = await $.ui.mount({ ...draw(chart), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /east/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Line 2/ })).toBeDefined()
  expect(new Set((await ui.findAll({ type: 'Text', text: /^─{3,}$/ })).map(l => l.props.color)).size).toBe(2)
  await ui.unmount()
})

test('grouped bars take one color per series, not one per bar', async $ => {
  const chart = '```mermaid\nxychart-beta\n  x-axis [a, b, c]\n  y-axis 0 --> 10\n  bar [8, 8, 8]\n  bar [4, 4, 4]\n```'
  const ui = await $.ui.mount({ ...draw(chart), surface: 'terminal' })
  const hues = new Set((await ui.findAll({ type: 'Text', text: /^[█▄▀]+$/ })).map(b => b.props.color))
  expect(hues.size).toBe(2)
  await ui.unmount()
})

test('a participant keeps one color at both ends of a sequence diagram', async $ => {
  const seq = '```mermaid\nsequenceDiagram\n  Browser->>App: GET /cart\n  App-->>Browser: 200\n```'
  const ui = await $.ui.mount({ ...draw(seq), surface: 'terminal' })
  const ends = await paintsOf(ui, 'Browser')
  expect(ends.length).toBe(2)
  expect(ends[0]?.color).toBe(ends[1]?.color)
  await ui.unmount()
})

test('back-to-back tables and diagrams share a wrapping row', async $ => {
  const text = `${TABLE}\n\n${FLOW.replace('Flow:\n\n', '')}\n\nAfter.`
  const ui = await $.ui.mount({ ...draw(text), surface: 'terminal' })
  const rows = (await ui.findAll({ type: 'Box' })).filter(b => b.props.flexWrap === 'wrap')
  expect(rows.length).toBe(1)
  expect(rows[0]?.text).toContain('Service')
  expect(rows[0]?.text).toContain('Gateway')
  expect(rows[0]?.text).not.toContain('After.')
  await ui.unmount()
})

test('code blocks, tables and quotes get a copy button, tables an art button, the reply a copy reply button', async ($, on) => {
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true as const } }
  })
  const text = `${TABLE}\n\n\`\`\`bash\nls -la\n\`\`\`\n\n> reply text\n\nplain paragraph`
  const ui = await $.ui.mount({ ...draw(text), surface: 'terminal' })
  const buttons = await ui.findAll({ type: 'Button' })
  expect(buttons.length).toBe(5)
  expect(buttons.every(b => b.props.variant === "primary")).toBe(true)
  await ui.press({ key: 'copy1' })
  expect(copied).toEqual(['ls -la'])
  await ui.unmount()
})

const COPY_SAMPLE = `${TABLE}\n\n\`\`\`bash\nls -la\n\`\`\`\n\n> reply text\n\nplain paragraph`

const floatingCopies = async (ui: { findAll: (query: { type: string }) => Promise<{ props: Record<string, unknown>; text?: string }[]> }) =>
  (await ui.findAll({ type: 'Box' })).filter(b => b.props.position === 'absolute' && b.props.display === 'none').map(b => b.text)

type DrawnNode = { type?: string; props?: Record<string, unknown>; hover?: { scope?: string; display?: string }; children?: unknown[] }
const drawnKids = (node: DrawnNode) => (node.children ?? []).filter((child): child is DrawnNode => !!child && typeof child === 'object')
const withParents = (node: DrawnNode, parent?: DrawnNode): { node: DrawnNode; parent?: DrawnNode }[] => [{ node, parent }, ...drawnKids(node).flatMap(child => withParents(child, node))]
const shownText = (node: DrawnNode): string => (node.children ?? []).map(child => (typeof child === 'string' ? child : child && typeof child === 'object' ? shownText(child as DrawnNode) : '')).join('')
const holdsButton = (node: DrawnNode): boolean => node.type === 'Button' || drawnKids(node).some(holdsButton)
const inFlow = (node: DrawnNode) => node.props?.position !== 'absolute'
const reveals = (tree: DrawnNode) => withParents(tree).filter(({ node }) => holdsButton(node) && node.props?.position === 'absolute' && node.props.display === 'none')
const markersOf = (tree: DrawnNode, scope: string) => withParents(tree).filter(({ node }) => node.hover?.scope === scope && node.props?.display !== 'none')

const labelsOf = (node: DrawnNode) => withParents(node).filter(({ node: n }) => n.type === 'Button').map(({ node: n }) => n.props?.label).join(' ')
const SURFACES = ['terminal', 'desktop'] as const

for (const surface of SURFACES) test(`copyButtonStyle hover hides every copy button until the pointer is on its ⧉ marker on ${surface}`, { options: { copyButtonStyle: 'hover' } }, async ($, on) => {
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true as const } }
  })
  const ui = await $.ui.mount({ ...draw(COPY_SAMPLE), surface })
  const tree = (await ui.drawn()) as DrawnNode
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(5)
  expect(await floatingCopies(ui)).toEqual(['⧉ md ⧉ art', '⧉ copy', '⧉ copy', '⧉ copy reply'])
  expect(reveals(tree).flatMap(({ node }) => withParents(node).filter(({ node: n }) => n.type === 'Button'))).toHaveLength(5)
  for (const { node } of reveals(tree)) {
    const scope = node.hover?.scope ?? ''
    expect(node.hover).toEqual({ scope, display: 'flex' })
    expect(markersOf(tree, scope).map(({ node: marker }) => ({ text: shownText(marker), flows: inFlow(marker) }))).toEqual([{ text: '⧉', flows: !scope.endsWith(':reply') }])
  }
  await ui.press({ key: 'copy1' })
  expect(copied).toEqual(['ls -la'])
  await ui.unmount()
})

for (const surface of SURFACES) test(`copyButtonStyle hover draws a block's buttons over its marker, from the marker's row and side, on ${surface}`, { options: { copyButtonStyle: 'hover' } }, async $ => {
  const ui = await $.ui.mount({ ...draw('| Region | p99 |\n|---|---:|\n| eu | 12 |\n\n```bash\nls\n```\n\n> ```bash\n> npm test\n> ```\n>\n> Run that first.'), surface })
  const tree = (await ui.drawn()) as DrawnNode
  const floats = reveals(tree).filter(({ node }) => labelsOf(node) !== '⧉ copy reply')
  expect(floats.map(({ node }) => labelsOf(node))).toEqual(['⧉ md ⧉ art', '⧉ copy', '⧉ copy', '⧉ copy'])
  for (const { node, parent } of floats) {
    const flow = drawnKids(parent!).filter(inFlow)
    const marker = flow.at(-1)!
    expect(marker.hover?.scope).toBe(node.hover?.scope)
    expect(['flex-start', 'flex-end']).toContain(marker.props?.alignSelf)
    expect({ right: node.props?.right, left: node.props?.left, width: node.props?.width, minWidth: node.props?.minWidth }).toEqual({ right: 0, left: undefined, width: undefined, minWidth: undefined })
    expect(marker.props?.alignSelf === 'flex-end' ? { bottom: node.props?.bottom } : { top: node.props?.top }).toEqual(marker.props?.alignSelf === 'flex-end' ? { bottom: 0 } : { top: 0 })
  }
  await ui.unmount()
})

for (const surface of SURFACES) test(`copyButtonStyle hover makes a block at least as wide as its buttons, so buttons drawn from its marker never run off its left edge, on ${surface}`, { options: { copyButtonStyle: 'hover' } }, async $ => {
  const ui = await $.ui.mount({ ...draw('| a |\n|---|\n| 1 |\n\n```\nx\n```'), surface })
  expect(((await ui.find({ key: 'c0' }))?.children[0] as DrawnNode).props?.minWidth).toBe('[ ⧉ md ] [ ⧉ art ]'.length)
  expect((await ui.find({ key: 'b1' }))?.props.minWidth).toBe('── code [ ⧉ copy ]'.length)
  await ui.unmount()
})

for (const surface of SURFACES) test(`copyButtonStyle hover reserves its buttons' width beside a narrow block, so a table drawn next to it never covers them, on ${surface}`, { options: { copyButtonStyle: 'hover' } }, async $ => {
  const ui = await $.ui.mount({ ...draw('| a | b |\n|---|---|\n| 1 | 2 |\n\n| c | d |\n|---|---|\n| 3 | 4 |'), surface })
  for (const key of ['c0', 'c1']) expect(((await ui.find({ key }))?.children[0] as DrawnNode).props?.minWidth).toBe('[ ⧉ md ] [ ⧉ art ]'.length)
  await ui.unmount()
})

for (const surface of SURFACES) test(`copyButtonStyle hover gives every block with copy buttons one dim ⧉ in the flow, a column clear of it, on ${surface}`, { options: { copyButtonStyle: 'hover' } }, async $ => {
  const text = '| a |\n|---|\n| 1 |\n\n```\nx\n```\n\n- y\n\n> z\n\n> [!NOTE]\n> w\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\nplain'
  const ui = await $.ui.mount({ ...draw(text), surface })
  const tree = (await ui.drawn()) as DrawnNode
  const marks = withParents(tree).filter(({ node }) => node.type === 'Text' && shownText(node) === '⧉')
  expect(marks).toHaveLength(7)
  for (const { node } of marks) expect(node.props?.dimColor).toBe(true)
  const blocks = marks.map(({ parent }) => parent!).filter(box => !box.hover?.scope?.endsWith(':reply'))
  expect(blocks).toHaveLength(6)
  for (const box of blocks) expect({ scoped: box.hover?.scope !== undefined, flows: inFlow(box) }).toEqual({ scoped: true, flows: true })
  for (const key of ['c0', 'c2', 'c3', 'c4', 'c5']) expect(((await ui.find({ key }))?.children[0] as DrawnNode).props?.columnGap).toBe(1)
  await ui.unmount()
})

test('copyButtonStyle hover keeps a long code label and its ⧉ on one row at the narrowest width', { options: { copyButtonStyle: 'hover' } }, async $ => {
  const ui = await $.ui.mount({ ...draw('```typescriptreact\nx\n```'), viewport: { columns: 24, rows: 40 }, surface: 'terminal' })
  const code = (await ui.find({ key: 'b0' }))!
  const header = code.children.find((child): child is DrawnNode => !!child && typeof child === 'object' && (child as DrawnNode).props?.justifyContent === 'space-between')!
  const label = shownText(drawnKids(header)[0]!)
  expect(width(label) + (header.props?.columnGap as number) + 1).toBeLessThanOrEqual(code.props.minWidth as number)
  await ui.unmount()
})

for (const surface of SURFACES) test(`copyButtonStyle hover puts the reply's ⧉ in its bottom-right corner, in a gutter of its own, with copy reply drawn over it, on ${surface}`, { options: { copyButtonStyle: 'hover' } }, async $ => {
  for (const text of [COPY_SAMPLE, 'שלום עולם']) {
    const ui = await $.ui.mount({ ...draw(text), surface })
    const anchor = await ui.find({ key: 'reply' })
    expect({ position: anchor?.props.position, bottom: anchor?.props.bottom, right: anchor?.props.right, text: anchor?.text }).toEqual({ position: 'absolute', bottom: 0, right: -2, text: '⧉⧉ copy reply' })
    const reveal = (anchor?.children ?? []).find((child): child is DrawnNode => !!child && typeof child === 'object' && (child as DrawnNode).props?.display === 'none')
    expect({ top: reveal?.props?.top, right: reveal?.props?.right }).toEqual({ top: 0, right: 0 })
    const row = drawnKids((await ui.drawn()) as DrawnNode)
    expect({ width: row.at(-1)?.props?.width, children: row.at(-1)?.children ?? [] }).toEqual({ width: 2, children: [] })
    await ui.unmount()
  }
})

for (const surface of SURFACES) test(`copyButtonStyle hover shows nothing while the pointer is on a block, only on its marker, on ${surface}`, { options: { copyButtonStyle: 'hover' } }, async $ => {
  const ui = await $.ui.mount({ ...draw(`${COPY_SAMPLE}\n\n- item\n  \`\`\`\n  v\n  \`\`\``), surface })
  const tree = (await ui.drawn()) as DrawnNode
  const shown = withParents(tree).filter(({ node }) => node.hover?.display === 'flex')
  expect(shown.length).toBeGreaterThan(0)
  for (const { node } of shown) expect(markersOf(tree, node.hover?.scope ?? '').length).toBe(1)
  await ui.unmount()
})

const WIDE = `| A | B |\n|---|---|\n| ${'alpha '.repeat(12)}| ${'bravo '.repeat(12)}|\n\nx\n\n\`\`\`mermaid\nflowchart LR\n  A[${'a'.repeat(12)}] --> B[${'b'.repeat(12)}] --> C[${'c'.repeat(12)}]\n\`\`\`\n\ny\n\n\`\`\`mermaid\nflowchart LR\n  A[${'a'.repeat(7)}] --> B[${'b'.repeat(7)}] --> C[${'c'.repeat(7)}] --> D[${'d'.repeat(7)}]\n\`\`\``
const widest = (node: DrawnNode): number => (node.type === 'Text' ? Math.max(...shownText(node).split('\n').map(width)) : Math.max(0, ...drawnKids(node).map(widest)))
for (const copyButtonStyle of ['inline', 'hover'] as const) test(`copyButtonStyle ${copyButtonStyle} lays a full-width table and diagram out ${copyButtonStyle === 'hover' ? 'two columns narrower, so the ⧉ fits beside them' : 'to the whole width'}`, { options: { copyButtonStyle } }, async $ => {
  const ui = await $.ui.mount({ ...draw(WIDE), viewport: { columns: 60, rows: 40 }, surface: 'terminal' })
  const [table, wide, wider] = await Promise.all(['c0', 'c2', 'c4'].map(async key => widest((await ui.find({ key })) as DrawnNode)))
  if (copyButtonStyle === 'inline') expect({ table, wide: wide! > 56 - MARK - 2 }).toEqual({ table: 56, wide: true })
  else expect({ table, fits: [wide!, wider!].every(w => w + MARK <= 56) }).toEqual({ table: 56 - MARK, fits: true })
  await ui.unmount()
})

test('copyButtonStyle hover drops trailing buttons a narrow terminal has no room for, keeping the first', { options: { copyButtonStyle: 'hover' } }, async ($, on) => {
  clipboardEnv(on, 'macos')
  await startSession($, on)
  for (const [columns, labels] of [[120, '⧉ md ⧉ art ⧉ html ▣ png'], [24, '⧉ md ⧉ art']] as const) {
    const ui = await $.ui.mount({ ...draw('| a |\n|---|\n| 1 |'), viewport: { columns, rows: 40 }, surface: 'terminal' })
    expect(reveals((await ui.drawn()) as DrawnNode).map(({ node }) => withParents(node).filter(({ node: n }) => n.type === 'Button').map(({ node: n }) => n.props?.label).join(' '))).toEqual([labels])
    await ui.unmount()
  }
})

test('copyButtonStyle inline, the default, keeps every copy button in the flow', async $ => {
  const ui = await $.ui.mount({ ...draw(COPY_SAMPLE), surface: 'terminal' })
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(5)
  expect(await floatingCopies(ui)).toHaveLength(0)
  await ui.unmount()
})

test('copyButtonStyle hover draws inline on mobile, which has no pointer', { options: { copyButtonStyle: 'hover' } }, async $ => {
  const ui = await $.ui.mount({ ...draw(COPY_SAMPLE), surface: 'mobile' })
  expect(await floatingCopies(ui)).toHaveLength(0)
  await ui.unmount()
})

test('copyButtons off draws no buttons', { options: { copyButtons: false } }, async $ => {
  const ui = await $.ui.mount({ ...draw(`${TABLE}\n\n\`\`\`bash\nls\n\`\`\``), surface: 'terminal' })
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  await ui.unmount()
})

test('lists copy as markdown', async ($, on) => {
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true as const } }
  })
  const ui = await $.ui.mount({ ...draw('1. Build\n2. Ship\n   - canary'), surface: 'terminal' })
  const [button] = await ui.findAll({ type: 'Button' })
  await ui.press({ key: button!.key! })
  expect(copied).toEqual(['1. Build\n2. Ship\n   - canary'])
  await ui.unmount()
})

test('diagrams offer two copies: mermaid source and drawn art', async ($, on) => {
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true as const } }
  })
  const ui = await $.ui.mount({ ...draw(FLOW), surface: 'terminal' })
  const buttons = await ui.findAll({ type: 'Button' })
  expect(buttons.map(b => b.props.label)).toEqual(['⧉ source', '⧉ art', '⧉ copy reply'])
  for (const b of buttons) await ui.press({ key: b.key! })
  expect(copied[0]).toBe('graph LR\nA[User] --> B[Gateway]')
  expect(copied[1]).toContain('┌')
  await ui.unmount()
})

test('JSON and YAML get keys, strings, numbers and comments colored', async $ => {
  const t = PRESETS['catppuccin-mocha']
  const ui = await $.ui.mount({ ...draw('```yaml\nname: "shop" # app\nreplicas: 3\n```'), surface: 'terminal' })
  expect((await paintOf(ui, 'name'))?.color).toBe(t.codeCommand)
  expect((await paintOf(ui, '"shop"'))?.color).toBe(t.codeString)
  expect((await paintOf(ui, '3'))?.color).toBe(t.number)
  expect((await paintOf(ui, '# app'))?.color).toBe(t.codeComment)
  await ui.unmount()
})

test('Prism colors TypeScript keywords, strings and comments', async $ => {
  const t = PRESETS['catppuccin-mocha']
  const ui = await $.ui.mount({ ...draw('```ts\nconst name = "shop" // app\n```'), surface: 'terminal' })
  expect((await paintOf(ui, 'const'))?.color).toBe(t.codeFlag)
  expect((await paintOf(ui, '"shop"'))?.color).toBe(t.codeString)
  expect((await paintOf(ui, '// app'))?.italic).toBe(true)
  await ui.unmount()
})

test('Prism colors Lua keywords and comments', async $ => {
  const t = PRESETS['catppuccin-mocha']
  const ui = await $.ui.mount({ ...draw('```lua\nlocal name = "shop" -- app\n```'), surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^local$/ }))?.props.color).toBe(t.codeFlag)
  expect((await ui.find({ type: 'Text', text: /^-- app$/ }))?.props.italic).toBe(true)
  await ui.unmount()
})

test('fence languages that name Prism internals fall back to plain code', async $ => {
  for (const lang of ['extend', 'toString', 'constructor', '__proto__']) {
    const ui = await $.ui.mount({ ...draw(`\`\`\`${lang}\nhello\n\`\`\``), surface: 'terminal' })
    expect((await ui.find({ type: 'Text', text: /^hello$/ }))?.props.color).toBe(PRESETS['catppuccin-mocha'].codeText)
    await ui.unmount()
  }
})

test('code blocks draw through the native Code element off the terminal', async $ => {
  const ui = await $.ui.mount({ ...draw('```ts\nconst name = "shop"\n  return name\n```'), surface: 'desktop' })
  const code = await ui.find({ type: 'Code' })
  expect(code?.props.source).toBe('const name = "shop"\n  return name')
  expect(code?.props.language).toBe('ts')
  expect(code?.props.startLine).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^const$/ })).toBeUndefined()
  await ui.unmount()
  const long = await $.ui.mount({ ...draw(longCode(12)), surface: 'desktop' })
  expect((await long.find({ type: 'Code' }))?.props.startLine).toBe(1)
  expect(await long.find({ type: 'Text', text: /^ 1  $/ })).toBeUndefined()
  await long.unmount()
  const term = await $.ui.mount({ ...draw('```ts\nconst name = "shop"\n```'), surface: 'terminal' })
  expect(await term.find({ type: 'Code' })).toBeUndefined()
  await term.unmount()
})

test('tables draw boxed by default, with a double line under the header', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...draw(TABLE), surface })
    const shown = await shownLines(ui)
    const top = shown.find(l => /^┌[─┬]+┐$/.test(l)) ?? ''
    expect(top.split('┬').length).toBe(3)
    const lines = [top, ...[/^╞[═╪]+╡$/, /^├[─┼]+┤$/, /^└[─┴]+┘$/].map(re => shown.find(l => re.test(l)) ?? '')]
    expect(lines.every(l => l.length === top.length && l.length > 0)).toBe(true)
    expect((await ui.find({ type: 'Text', text: /^Service$/ }))?.props.color).toBe(PRESETS['catppuccin-mocha'].tableHeader)
    await ui.unmount()
  }
})

test('tableStyle rules keeps the open look', { options: { tableStyle: 'rules' } }, async $ => {
  const ui = await $.ui.mount({ ...draw(TABLE), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /┌|│/ })).toBeUndefined()
  await ui.unmount()
})

const longCode = (n: number) => `\`\`\`text\n${Array.from({ length: n }, (_, i) => `step ${i + 1}`).join('\n')}\n\`\`\``

test('code blocks of 10+ lines get one numbered Text per line, shorter ones none', async $ => {
  const ui = await $.ui.mount({ ...draw(longCode(12)), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^ 1  $/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^12  $/ })).toBeDefined()
  await ui.unmount()
  const short = await $.ui.mount({ ...draw(longCode(9)), surface: 'terminal' })
  expect(await short.find({ type: 'Text', text: /^step 9$/ })).toBeDefined()
  expect(await short.find({ type: 'Text', text: /^9  step 9$/ })).toBeUndefined()
  await short.unmount()
})

test('a wrapped numbered line keeps its continuation after the gutter', async $ => {
  const long = `${'word '.repeat(40).trim()}`
  const text = `\`\`\`text\n${[long, ...Array.from({ length: 11 }, (_, i) => `step ${i + 2}`)].join('\n')}\n\`\`\``
  const ui = await $.ui.mount({ ...draw(text), surface: 'terminal' })
  const rows = (await ui.findAll({ type: 'Box' })).filter(b => b.props.flexDirection === 'row' && /^ 1  /.test(b.text ?? ''))
  expect(rows.length).toBe(1)
  expect((await ui.find({ type: 'Text', text: /^ 1  $/ }))).toBeDefined()
  expect((await ui.find({ type: 'Text', text: long }))).toBeDefined()
  await ui.unmount()
})

test('long code blocks fold to 20 lines, open and fold back on press, and copy every line', async ($, on) => {
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true as const } }
  })
  for (const [surface, n] of [['terminal', 40], ['desktop', 45]] as const) {
    const ui = await $.ui.mount({ ...draw(longCode(n)), surface })
    const shown = async () => surface === 'desktop' ? String((await ui.find({ type: 'Code' }))!.props.source).split('\n').length : (await ui.findAll({ type: 'Text', text: /^ *\d+  $/ })).length
    expect(await shown()).toBe(20)
    expect((await ui.find({ key: 'fold0' }))?.props.label).toBe(`+${n - 20} more lines`)
    await ui.press({ key: 'copy0' })
    expect(copied.at(-1)).toBe(Array.from({ length: n }, (_, i) => `step ${i + 1}`).join('\n'))
    await ui.press({ key: 'fold0' })
    expect(await shown()).toBe(n)
    expect((await ui.find({ key: 'fold0' }))?.props.label).toBe('show less')
    await ui.press({ key: 'fold0' })
    expect(await shown()).toBe(20)
    expect((await ui.find({ key: 'fold0' }))?.props.label).toBe(`+${n - 20} more lines`)
    await ui.unmount()
  }
})

test('two code blocks that differ only in where lines break fold on their own', async $ => {
  const body = Array.from({ length: 29 }, () => 'x').join('\n')
  const ui = await $.ui.mount({ ...draw(`\`\`\`text\nab\nc\n${body}\n\`\`\`\n\nand\n\n\`\`\`text\na\nbc\n${body}\n\`\`\``), surface: 'terminal' as const })
  await ui.press({ key: 'fold0' })
  expect((await ui.find({ key: 'fold0' }))?.props.label).toBe('show less')
  expect((await ui.find({ key: 'fold2' }))?.props.label).toBe('+11 more lines')
  await ui.unmount()
})
