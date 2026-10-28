import type { On, RenderElement } from 'claude-code'
import { expect, mock } from 'claude-code/testing'
import { test } from './tool-rows'

import { drawnOnce, drawnPlain, keptDrawing, memoized, reusedDrawing, textOf, unfoldedDrawing } from '../hooks/drawings'
import { keepFormulas } from '../hooks/latex'
import { PRESETS } from '../hooks/presets'
import { NODE_BUDGET, chars, diffCard, nodeCount, remember } from '../hooks/render'
import { recordCopies } from './clipboard-env'
import { paintOf, tokensOf } from './paint'

const mount = (text: string, isFullscreen = false) => ({
  plugin: 'merman',
  component: 'AssistantMessage' as const,
  props: { text, isFirstOfReply: true },
  viewport: { columns: 120, rows: 40, isFullscreen },
  surface: 'terminal' as const,
})

const drawn = (node: unknown): string =>
  typeof node === 'string' ? node : ((node as { children?: unknown[] }).children ?? []).map(drawn).join('')

test('a cached entry read again outlives newer ones', async () => {
  const cache = new Map<string, string>()
  remember(cache, 'old', () => 'old', 3)
  for (let i = 0; i < 112; i++) {
    remember(cache, `stream ${i}`, () => 'part', 3)
    remember(cache, 'old', () => 'parsed again', 3)
  }
  expect(cache.get('old')).toBe('old')
  expect(cache.size).toBe(3)
})

test('a cache weighed by key length drops its oldest entries past its budget, never the newest', async () => {
  const cache = new Map<string, number>()
  for (const [i, key] of ['aaaa', 'bbbb', 'cccc'].entries()) remember(cache, key, () => i, 10, chars)
  expect([...cache.keys()]).toEqual(['bbbb', 'cccc'])
  remember(cache, 'bbbb', () => -1, 10, chars)
  remember(cache, 'x'.repeat(12), () => 3, 10, chars)
  expect([...cache.keys()]).toEqual(['x'.repeat(12)])
})

test('highlighted code keeps each right-to-left shape apart under one theme', { options: { rtl: 'apple-terminal' } }, async ($, on) => {
  mock.env(on, {})
  on('session.start', () => ({ cwd: '/tmp' }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const text = '```js\nconst port = 8080 // שלום kubectl עולם\n```'
  const line = async (isFullscreen: boolean) => {
    const ui = await $.ui.mount(mount(text, isFullscreen))
    const row = (await ui.findAll({ type: 'Text' })).map(drawn).find(t => t.startsWith('const port'))
    await ui.unmount()
    return row
  }
  const windowed = await line(false)
  const fullscreen = await line(true)
  expect(fullscreen).not.toBe(windowed)
  expect(await line(false)).toBe(windowed)
})

test('the terminal is looked up once, not on every prompt', async ($, on) => {
  const reads: string[] = []
  on('env.get', (_, e) => {
    reads.push(e.name)
    return { value: e.name === 'TERM_PROGRAM' ? 'WarpTerminal' : undefined }
  })
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  for (const text of ['one', 'two', 'three']) await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
  expect(reads.filter(name => name === 'TERM_PROGRAM').length).toBe(1)
})

const call = (id: string) => ({ tool_use_id: id, tool: 'Read', input: { file_path: '/tmp/x' }, isRunning: false, isErrored: false, isInterrupted: false })

test('only the 500 most recently expanded tool calls stay expanded', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ids = Array.from({ length: 501 }, (_, i) => `bounded-${i}`)
  const group = await $.ui.mount({ plugin: 'merman', surface: 'terminal', component: 'ToolGroup', props: { calls: ids.map(call), isActive: false, isExpanded: true } })
  await group.unmount()
  const isEngine = async (id: string) => {
    const ui = await $.ui.mount({ plugin: 'merman', surface: 'terminal', component: 'ToolUse', props: { ...call(id), output: { stdout: 'file' } } })
    const found = (await ui.find({ type: 'Text', text: /^engine$/ })) !== undefined
    await ui.unmount()
    return found
  }
  expect(await isEngine('bounded-500')).toBe(true)
  expect(await isEngine('bounded-0')).toBe(false)
})

const SURFACES = ['terminal', 'desktop'] as const

const message = (text: string, requestId: string, surface: (typeof SURFACES)[number] = 'terminal') => ({
  plugin: 'merman',
  component: 'AssistantMessage' as const,
  props: { text, isFirstOfReply: true },
  viewport: { columns: 120, rows: 40 },
  surface,
  requestId,
})

for (const surface of SURFACES) test(`a reply that ended inside an unclosed diagram draws all of it on ${surface}`, async $ => {
  const ui = await $.ui.mount(message('Flow:\n\n```mermaid\nflowchart TD\n  A[Start] --> B[Build]\n  B --> C[Ship]', 'ended', surface))
  expect(await ui.find({ type: 'Text', text: /Build/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Ship/ })).toBeDefined()
  await ui.unmount()
})

const HUGE = Array.from({ length: 1500 }, (_, i) => `const v${i} = await fetch("/api/${i}", { retries: ${i % 5} })`)

for (const surface of SURFACES) test(`a reply past the node ceiling draws its largest code block one node a line and keeps the rest of its drawing on ${surface}`, async $ => {
  const t = PRESETS['catppuccin-mocha']
  const text = `Intro with **bold** and \`code\`.\n\n\`\`\`ts\n${HUGE.join('\n')}\n\`\`\`\n\n\`\`\`ts\nconst small = "kept"\n\`\`\``
  const ui = await $.ui.mount(message(text, 'ceiling', surface))
  await ui.press({ key: 'fold1' })
  expect(nodeCount(await ui.drawn()) < NODE_BUDGET).toBe(true)
  expect((await paintOf(ui, 'bold'))?.bold).toBe(true)
  if (surface === 'terminal') {
    for (const line of [HUGE[0]!, HUGE[1499]!]) expect((await paintOf(ui, line))?.color).toBe(t.codeText)
    expect((await paintOf(ui, '"kept"'))?.color).toBe(t.codeString)
  } else expect((await ui.find({ type: 'Code', text: /retries: 4 }\)$/ }))?.text.split('\n')).toEqual(HUGE)
  await ui.unmount()
})

test('a reply under the node ceiling keeps every code block highlighted', async $ => {
  const t = PRESETS['catppuccin-mocha']
  const lines = HUGE.slice(0, 400)
  const ui = await $.ui.mount(message(`\`\`\`ts\n${lines.join('\n')}\n\`\`\``, 'under'))
  await ui.press({ key: 'fold0' })
  expect((await tokensOf(ui, /^const v399 = /)).map(run => run.paint.color)).toContain(t.codeFlag)
  expect((await paintOf(ui, '"/api/399"'))?.color).toBe(t.codeString)
  await ui.unmount()
})

test('the formula store keeps at most 8 MB of pictures, dropping the oldest first but never one a draw still wants', () => {
  const MB = 1024 * 1024
  const store = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`k${i}`, 2 * MB]))
  const kept = keepFormulas(store, [['k6', 2 * MB]], new Set(['k0']), bytes => bytes)
  expect(Object.keys(kept)).toEqual(['k0', 'k4', 'k5', 'k6'])
})

const PNG_160x80 = 'iVBORw0KGgoAAAANSUhEUgAAAKAAAABQAQAAAAC2JkOZAAAAFklEQVR42mNgGAWjYBSMglEwCgYeAAAGkAAB8Q2GVgAAAABJRU5ErkJggg=='

const unix = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

const pictureFiles = (on: On, found: Record<string, string>) => {
  const reads: string[] = []
  on('fs.stat', (_, e) => {
    const path = unix(e.path)
    return path in found ? { value: { kind: 'file' as const, size: (found[path]!.length * 3) / 4, mtimeMs: 0, isLink: false } } : { deny: `no such file ${path}` }
  })
  on('fs.read', (_, e) => {
    const path = unix(e.path)
    reads.push(path)
    return path in found ? { value: { base64: found[path]! } } : { deny: `no such file ${path}` }
  })
  return reads
}

test('loaded pictures stay under 8 MB: a picture pushed out by newer ones is read again when its reply draws again', async ($, on) => {
  mock.env(on, { TERM: 'xterm-kitty', HOME: '/home/me' })
  const big = btoa(atob(PNG_160x80) + '\0'.repeat(1425000))
  const names = ['p1', 'p2', 'p3', 'p4', 'p5']
  const reads = pictureFiles(on, Object.fromEntries(names.map(name => [`/pics/${name}.png`, big])))
  const draw = async (name: string) => {
    const ui = await $.ui.mount(message(`![${name}](/pics/${name}.png)`, `picture ${name}`))
    expect(await ui.findAll({ type: 'Image' })).toHaveLength(1)
    await ui.unmount()
  }
  for (const name of [...names, 'p5', 'p1']) await draw(name)
  expect(reads.map(path => path.slice(6, 8))).toEqual([...names, 'p1'])
})

test('a drawing is reused while its key, text and own folds are unchanged', () => {
  let draws = 0
  const draw = (folds: Map<string, boolean>) => {
    draws++
    folds.set('fold-a', false)
    return { type: 'Text', props: {}, children: [`drawn ${draws}`] } as unknown as RenderElement
  }
  const first = memoized('memo-1', 'k1', 'text', [], true, draw)
  expect(memoized('memo-1', 'k1', 'text', ['another-message-fold'], true, draw)).toBe(first)
  expect(draws).toBe(1)
  memoized('memo-1', 'k1', 'text', ['fold-a'], true, draw)
  expect(draws).toBe(2)
  memoized('memo-1', 'k2', 'text', ['fold-a'], true, draw)
  expect(draws).toBe(3)
  memoized('memo-1', 'k2', 'text, longer', ['fold-a'], true, draw)
  expect(draws).toBe(4)
  memoized('memo-1', 'k2', 'text, longer', ['fold-a'], false, draw)
  memoized('memo-1', 'k2', 'text, longer', ['fold-a'], false, draw)
  expect(draws).toBe(6)
})

test('kept drawings stay under their budget, the newest kept', () => {
  const element = { type: 'Text', props: {}, children: [] } as unknown as RenderElement
  keptDrawing('budget-a', { key: '', text: 'a'.repeat(60), folds: new Map(), element }, 100)
  keptDrawing('budget-b', { key: '', text: 'b'.repeat(60), folds: new Map(), element }, 100)
  expect(reusedDrawing('budget-a', '', 'a'.repeat(60), [])).toBeUndefined()
  expect(reusedDrawing('budget-b', '', 'b'.repeat(60), [])).toBe(element)
})

test('a reply redrawn only because it scrolled draws the same, and its fold still opens', async $ => {
  const text = '```ts\n' + Array.from({ length: 40 }, (_, i) => `const v${i} = ${i}`).join('\n') + '\n```'
  const ui = await $.ui.mount(mount(text))
  const before = await ui.drawn()
  await ui.redraw({ text, isFirstOfReply: true, onScreen: { first: 2, last: 30, of: 45 } })
  expect(await ui.drawn()).toEqual(before)
  const fold = (await ui.findAll({ type: 'Button' })).find(b => /more lines$/.test(String(b.props.label)))
  expect(fold).toBeDefined()
  await ui.press({ key: String(fold!.props.key) })
  expect((await ui.findAll({ type: 'Button' })).some(b => b.props.label === 'show less')).toBe(true)
  await ui.unmount()
})

test('a drawing with no folds is reused without the fold state, one with folds is not', () => {
  const element = { type: 'Text', props: {}, children: [] } as unknown as RenderElement
  memoized('plain-1', 'k', 'prose', [], true, () => element)
  expect(unfoldedDrawing('plain-1', 'k', 'prose')).toBe(element)
  expect(unfoldedDrawing('plain-1', 'k2', 'prose')).toBeUndefined()
  memoized('folded-1', 'k', 'code', [], true, folds => {
    folds.set('f', false)
    return element
  })
  expect(unfoldedDrawing('folded-1', 'k', 'code')).toBeUndefined()
})

const ROW = { type: 'Text', props: {}, children: [] } as unknown as RenderElement

test('a plain drawing is reused until its key or text changes, and prepares only when it draws', async () => {
  let draws = 0
  let prepared = 0
  const draw = () => {
    draws++
    return ROW
  }
  const prepare = async () => {
    prepared++
  }
  expect(await drawnPlain('plain-a', () => 'k', 'row', draw, prepare)).toBe(ROW)
  await drawnPlain('plain-a', () => 'k', 'row', draw, prepare)
  expect([draws, prepared]).toEqual([1, 1])
  await drawnPlain('plain-a', () => 'k2', 'row', draw, prepare)
  await drawnPlain('plain-a', () => 'k2', 'row, finished', draw, prepare)
  expect([draws, prepared]).toEqual([3, 3])
})

test('a drawing is kept under the key read after it prepared, and one that draws nothing is not kept', async () => {
  let root = 'old'
  let draws = 0
  const draw = () => {
    draws++
    return ROW
  }
  const key = () => `root ${root}`
  await drawnPlain('moved', key, 'row', draw, async () => {
    root = 'new'
  })
  await drawnPlain('moved', key, 'row', draw)
  expect(draws).toBe(1)
  let empty = 0
  const nothing = () => {
    empty++
    return undefined
  }
  expect(await drawnPlain('empty', () => 'k', 'row', nothing)).toBeUndefined()
  await drawnPlain('empty', () => 'k', 'row', nothing)
  expect(empty).toBe(2)
})

test('a drawing with folds reads them before it prepares, and prepares only when a fold changed', async () => {
  let reads = 0
  let prepared = 0
  let open: string[] = []
  const readOpen = async () => {
    reads++
    return open
  }
  const draw = (_: string[], folds: Map<string, boolean>) => {
    folds.set('card-1', open.includes('card-1'))
    return ROW
  }
  const prepare = async () => {
    prepared++
  }
  await drawnOnce('folded-card', () => 'k', 'card', true, readOpen, draw, prepare)
  await drawnOnce('folded-card', () => 'k', 'card', true, readOpen, draw, prepare)
  expect([reads, prepared]).toEqual([2, 1])
  open = ['card-1']
  await drawnOnce('folded-card', () => 'k', 'card', true, readOpen, draw, prepare)
  expect([reads, prepared]).toEqual([3, 2])
})

test('a value is keyed by its JSON, and nothing by an empty string', () => {
  expect(textOf({ tool: 'Bash', input: { command: 'ls' } })).toBe('{"tool":"Bash","input":{"command":"ls"}}')
  expect(textOf(undefined)).toBe('')
})

test('a diff card is read from what it draws, not the whole file the edit came from', () => {
  const patch = { filePath: '/repo/app.ts', structuredPatch: [{ oldStart: 4, newStart: 4, lines: [' const a = 1', '-const b = 2', '+const b = 3'] }] }
  const edit = { ...patch, oldString: 'const b = 2', newString: 'const b = 3', originalFile: 'x'.repeat(100000), userModified: false, replaceAll: false, gitDiff: { patch: 'y'.repeat(5000) } }
  expect(textOf(diffCard(edit))).toBe(textOf(diffCard(patch)))
  expect(textOf(diffCard(edit)).length).toBeLessThan(400)
  expect(textOf(diffCard({ ...patch, structuredPatch: [{ ...patch.structuredPatch[0]!, lines: [' const a = 1', '+const c = 4'] }] }))).not.toBe(textOf(diffCard(patch)))
  const fresh = { filePath: '/repo/new.ts', oldString: '', originalFile: '', structuredPatch: [{ oldStart: 0, newStart: 1, lines: ['+one', '+two'] }] }
  expect(diffCard(fresh)).toMatchObject({ made: { kind: 'created', path: '/repo/new.ts', lines: ['one', 'two'] } })
  expect(diffCard({ ...fresh, originalFile: 'was here' })).toMatchObject({ made: undefined })
  expect(diffCard({ type: 'create', filePath: '/repo/w.ts', content: 'a\nb\n', structuredPatch: [], originalFile: null })).toEqual({ write: { kind: 'created', path: '/repo/w.ts', lines: ['a', 'b'] } })
  expect(diffCard('File updated')).toBeUndefined()
})

const scrolled = { first: 2, last: 6, of: 12 }
const PASTED = 'look\n<pasted_content id="7">\n{\n  "on": true\n}\n</pasted_content id="7">\nseems obvious!'
const prompt = (text: string, surface: (typeof SURFACES)[number], requestId: string, columns = 80) =>
  ({ plugin: 'merman', component: 'UserMessage' as const, props: { text, origin: { kind: 'composer' } as never, isExpanded: true }, viewport: { columns, rows: 10 }, surface, requestId })

test('a prompt redrawn only because it scrolled draws the same, and its paste still opens and copies', async ($, on) => {
  const copies = recordCopies(on)
  for (const surface of SURFACES) {
    const mounted = prompt(PASTED, surface, `pasted-${surface}`)
    const ui = await $.ui.mount(mounted)
    const before = await ui.drawn()
    await ui.redraw({ ...mounted.props, onScreen: scrolled })
    expect(await ui.drawn()).toEqual(before)
    const paste = (await ui.findAll({ type: 'Button' })).find(b => b.props.label === 'pasted text · 3 lines')
    await ui.press({ key: paste!.key! })
    await ui.redraw({ ...mounted.props, onScreen: { first: 0, last: 9, of: 14 } })
    expect((await ui.findAll({ type: 'Button' })).some(b => b.props.label === 'show less')).toBe(true)
    const copy = (await ui.findAll({ type: 'Button' })).find(b => b.props.label === '⧉ copy')
    await ui.press({ key: copy!.key! })
    expect(copies.at(-1)).toBe('{\n  "on": true\n}')
    await ui.unmount()
  }
})

test('a prompt draws again for new text and for a new width', { options: { rtl: 'warp' } }, async $ => {
  for (const surface of SURFACES) {
    const mounted = prompt('first words', surface, `again-${surface}`)
    const ui = await $.ui.mount(mounted)
    await ui.redraw({ ...mounted.props, text: 'other words', onScreen: scrolled })
    expect(await ui.find({ type: 'Text', text: /^other words$/ })).toBeDefined()
    await ui.unmount()
    const long = Array.from({ length: 30 }, (_, i) => `מילה${i}`).join(' ')
    const wide = await $.ui.mount(prompt(long, surface, `width-${surface}`, 200))
    const drawn = await wide.drawn()
    await wide.unmount()
    const narrow = await $.ui.mount(prompt(long, surface, `width-${surface}`, 40))
    expect(await narrow.drawn()).not.toEqual(drawn)
    await narrow.unmount()
  }
})

const askedRoot = (on: On) => {
  const asked = { count: 0 }
  on('session.root', () => {
    asked.count++
    return { value: '/work/app' }
  })
  return asked
}

const shellRow = (id: string, isRunning: boolean) => ({ tool_use_id: id, tool: 'Bash', input: { command: 'npm test' }, isRunning, isErrored: false, isInterrupted: false, ...(isRunning ? {} : { output: { stdout: 'ok', stderr: '' } }) })

test('a tool row redrawn only because it scrolled draws the same without asking for the project root, and draws again once it finished', async ($, on) => {
  const asked = askedRoot(on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'merman', surface, component: 'ToolUse', props: shellRow(`row-${surface}`, true), viewport: { columns: 100, rows: 10 } })
    const before = await ui.drawn()
    const seen = asked.count
    await ui.redraw({ ...shellRow(`row-${surface}`, true), onScreen: scrolled })
    expect(await ui.drawn()).toEqual(before)
    expect(asked.count).toBe(seen)
    expect(await ui.find({ type: 'Text', text: /^ ◌$/ })).toBeDefined()
    await ui.redraw({ ...shellRow(`row-${surface}`, false), onScreen: scrolled })
    expect(await ui.find({ type: 'Text', text: /^ ●$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ ◌$/ })).toBeUndefined()
    await ui.unmount()
    const long = { ...shellRow(`wide-${surface}`, false), input: { command: `echo ${'x'.repeat(120)}` } }
    const widths: unknown[] = []
    for (const columns of [200, 60]) {
      const row = await $.ui.mount({ plugin: 'merman', surface, component: 'ToolUse', requestId: `wide-${surface}`, props: long, viewport: { columns, rows: 10 } })
      widths.push((await row.findAll({ type: 'Box' })).map(b => b.props.width).find(w => typeof w === 'number'))
      await row.unmount()
    }
    expect(widths).toEqual([120, 36])
  }
})

test('a tool group redrawn only because it scrolled draws the same without asking for the project root, and draws again once its call finished', async ($, on) => {
  const asked = askedRoot(on)
  for (const surface of SURFACES) {
    const group = (isRunning: boolean) => ({ calls: [{ ...call(`g-${surface}`), isRunning }, call(`h-${surface}`)], isActive: isRunning, isExpanded: false })
    const ui = await $.ui.mount({ plugin: 'merman', surface, component: 'ToolGroup', props: group(true), viewport: { columns: 100, rows: 10 } })
    const before = await ui.drawn()
    const seen = asked.count
    await ui.redraw({ ...group(true), onScreen: scrolled })
    expect(await ui.drawn()).toEqual(before)
    expect(asked.count).toBe(seen)
    await ui.redraw({ ...group(false), onScreen: scrolled })
    expect(await ui.drawn()).not.toEqual(before)
    expect(await ui.find({ type: 'Text', text: /^ ●$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('an expanded shell row redrawn only because it scrolled draws the same, and draws new output', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  for (const surface of SURFACES) {
    const id = `shell-${surface}`
    const ran = (stdout: string) => ({ ...shellRow(id, false), output: { stdout, stderr: '' } })
    const group = await $.ui.mount({ plugin: 'merman', surface, component: 'ToolGroup', props: { calls: [ran('')], isActive: false, isExpanded: true } })
    await group.unmount()
    const ui = await $.ui.mount({ plugin: 'merman', surface, component: 'ToolUse', props: ran('first line'), viewport: { columns: 100, rows: 10 } })
    const before = await ui.drawn()
    await ui.redraw({ ...ran('first line'), onScreen: scrolled })
    expect(await ui.drawn()).toEqual(before)
    await ui.redraw({ ...ran('first line\nsecond line'), onScreen: scrolled })
    expect(await ui.find({ type: 'Text', text: /^second line$/ })).toBeDefined()
    await ui.unmount()
  }
})

const added = (n: number, word = 'line') => Array.from({ length: n }, (_, i) => `+${word} ${i + 1}`)

test('a diff card redrawn only because it scrolled draws the same, its fold still opens, and new output draws again', async ($, on) => {
  const asked = askedRoot(on)
  for (const surface of SURFACES) {
    const edit = (lines: string[]) => ({ tool_use_id: `card-${surface}`, tool: 'Edit', output: { filePath: '/work/app/src/app.ts', structuredPatch: [{ oldStart: 1, newStart: 1, lines }] }, isErrored: false })
    const ui = await $.ui.mount({ plugin: 'merman', surface, component: 'ToolResult', props: edit(added(25)) })
    const before = await ui.drawn()
    const seen = asked.count
    await ui.redraw({ ...edit(added(25)), onScreen: scrolled })
    expect(await ui.drawn()).toEqual(before)
    expect(asked.count).toBe(seen)
    await ui.press({ key: 'fold' })
    await ui.redraw({ ...edit(added(25)), onScreen: { first: 0, last: 9, of: 30 } })
    expect(await ui.find({ type: 'Text', text: /^line 25$/ })).toBeDefined()
    expect((await ui.find({ key: 'fold' }))?.props.label).toBe('show less')
    await ui.redraw({ ...edit(added(25, 'row')), onScreen: scrolled })
    expect(await ui.find({ type: 'Text', text: /^row 25$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a shell edit card redrawn only because it scrolled draws the same, its fold still opens, and new output draws again', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  for (const surface of SURFACES) {
    const shell = (lines: string[], stdout = '') => ({ tool_use_id: `edits-${surface}`, tool: 'Bash', output: { stdout, stderr: '', interrupted: false, bashEditDiff: { files: [{ filePath: '/tmp/a.txt', hunks: [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: lines.length, lines }] }], moreFiles: 0 } }, isErrored: false })
    const ui = await $.ui.mount({ plugin: 'merman', surface, component: 'ToolResult', props: shell(added(25), 'patched') })
    const before = await ui.drawn()
    await ui.redraw({ ...shell(added(25), 'patched'), onScreen: scrolled })
    expect(await ui.drawn()).toEqual(before)
    await ui.press({ key: 'fold0' })
    await ui.redraw({ ...shell(added(25), 'patched'), onScreen: { first: 0, last: 9, of: 30 } })
    expect(await ui.find({ type: 'Text', text: /^line 25$/ })).toBeDefined()
    expect((await ui.find({ key: 'fold0' }))?.props.label).toBe('show less')
    await ui.redraw({ ...shell(added(25, 'row')), onScreen: scrolled })
    expect(await ui.find({ type: 'Text', text: /^row 25$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^engine$/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('a quiet shell result or failure redrawn only because it scrolled draws the same without asking for the project root, and new output draws again', { options: { toolOutput: 'quiet' } }, async ($, on) => {
  const asked = askedRoot(on)
  for (const surface of SURFACES) {
    for (const [isErrored, first, then] of [[false, 'first line', 'other line'], [true, 'Error: Exit code 1\nfirst line', 'Error: Exit code 1\nother line']] as const) {
      const result = (stdout: string) => ({ tool_use_id: `quiet-${surface}-${isErrored}`, tool: 'Bash', output: isErrored ? stdout : { stdout, stderr: '', interrupted: false }, isErrored })
      const ui = await $.ui.mount({ plugin: 'merman', surface, component: 'ToolResult', props: result(first) })
      const before = await ui.drawn()
      const seen = asked.count
      await ui.redraw({ ...result(first), onScreen: scrolled })
      expect(await ui.drawn()).toEqual(before)
      expect(asked.count).toBe(seen)
      await ui.redraw({ ...result(then), onScreen: scrolled })
      expect(await ui.find({ type: 'Text', text: /other line$/ })).toBeDefined()
      await ui.unmount()
    }
  }
})
