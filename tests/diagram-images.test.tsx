import type { On } from 'claude-code'
import { expect, mock, test as base } from 'claude-code/testing'

import { browserConfig, diagramConfig, fitDiagram, layoutWidth, sizedConfig } from '../hooks/diagramimage'
import { resolveStyle } from '../hooks/theme'

const PNG_720x360 = 'iVBORw0KGgoAAAANSUhEUgAAAtAAAAFoAQAAAABWXfG0AAAANklEQVR42u3BAQEAAACCIP+vbkhAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMCvAX/4AAHeScKfAAAAAElFTkSuQmCC'
const PNG_360x2880 = 'iVBORw0KGgoAAAANSUhEUgAAAWgAAAtAAQAAAAAdEYRtAAAAl0lEQVR42u3BMQEAAADCoPVPbQwfoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAeBoFngABCi0coAAAAABJRU5ErkJggg=='

const test = ((name: string, ...rest: unknown[]) => {
  const [opts, body] = rest.length === 1 ? [{}, rest[0]] : [rest[0] as { options?: object }, rest[1]]
  return (base as (...args: unknown[]) => void)(name, { ...opts, options: { mermaidImages: true, ...opts.options } }, body)
}) as unknown as typeof base

const KITTY = { TERM: 'xterm-kitty', TMPDIR: '/tmp/' }
const FLOW = 'flowchart LR\n  A[Start] --> B[Done]'
const REPLY = `A flow:\n\n\`\`\`mermaid\n${FLOW}\n\`\`\`\n\nDone.`

type Run = { argv: readonly string[]; source: string; out: string }

const mmdc = (on: On, png: (run: Run) => string | null = () => PNG_720x360) => {
  const runs: Run[] = []
  const written = new Map<string, string>()
  const made = new Map<string, string>()
  on('session.surfaces', () => ({ value: ['terminal'] as const }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('fs.write', (_, e) => {
    written.set(e.path, e.text)
    if (e.text === '') made.delete(e.path)
    return { value: undefined }
  })
  on('process.run', (_, e) => {
    const run = { argv: e.argv, source: (e.init?.stdin ?? '').trimEnd(), out: e.argv[e.argv.indexOf('-o') + 1] ?? '' }
    runs.push(run)
    const picture = png(run)
    if (picture) made.set(run.out, picture)
    return { value: { exitCode: picture ? 0 : 1, stdout: '', stderr: picture ? '' : 'Parse error', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.read', (_, e) => {
    const picture = made.get(e.path)
    return picture ? { value: { base64: picture } } : { deny: `no such file ${e.path}` }
  })
  return { runs, written }
}

const reply = (text: string, columns = 120) => ({
  plugin: 'merman',
  component: 'AssistantMessage' as const,
  props: { text, isFirstOfReply: true },
  viewport: { columns, rows: 40 },
  surface: 'terminal' as const,
})

const sizeOf = (image: { props: Record<string, unknown> } | undefined) => ({ columns: Number(image?.props.columns), rows: Number(image?.props.rows) })

test('a mermaid diagram draws as an image rendered by mmdc', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  const { runs } = mmdc(on)

  const ui = await $.ui.mount(reply(REPLY))
  await clock.settle()

  const image = await ui.find({ type: 'Image' })
  expect(image?.props.alt).toBe(FLOW)
  expect(sizeOf(image)).toEqual({ columns: 40, rows: 10 })
  const run = runs.at(-1)
  expect(run?.argv[0]).toBe('mmdc')
  expect(run?.source).toBe(FLOW)
  expect(run?.argv).toEqual(expect.arrayContaining(['-i', '-', '-b', 'transparent', '-s', '2', '-q', '-p']))
  await ui.unmount()
})

test('the mmdc config carries the theme colors', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  const { runs, written } = mmdc(on)

  const ui = await $.ui.mount(reply(REPLY))
  await clock.settle()

  const config = written.get(runs.at(-1)!.argv[runs.at(-1)!.argv.indexOf('-c') + 1]!)
  const parsed = JSON.parse(config ?? '{}')
  expect(parsed.theme).toBe('base')
  expect(parsed.themeVariables).toMatchObject({ darkMode: true, background: '#1e1e2e', primaryTextColor: '#cdd6f4', primaryBorderColor: '#89b4fa', lineColor: '#89b4fa' })
  await ui.unmount()
})

test('until the image is ready the diagram draws as text', async ($, on) => {
  mock.env(on, KITTY)
  mmdc(on)

  const ui = await $.ui.mount(reply(REPLY))

  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Start/ })).toBeDefined()
  await ui.unmount()
})

test('a diagram mmdc rejects stays text while the others draw', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  mmdc(on, run => (run.source.includes('Broken') ? null : PNG_720x360))

  const ui = await $.ui.mount(reply(`${REPLY}\n\n\`\`\`mermaid\nflowchart LR\n  Broken --> Here\n\`\`\``))
  await clock.settle()

  const images = await ui.findAll({ type: 'Image' })
  expect(images.map(i => i.props.alt)).toEqual([FLOW])
  expect(await ui.find({ type: 'Text', text: /Broken/ })).toBeDefined()
  await ui.unmount()
})

test('without mmdc installed diagrams stay text', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  on('session.surfaces', () => ({ value: ['terminal'] as const }))
  on('process.run', () => ({ deny: 'spawn mmdc ENOENT' }))

  const ui = await $.ui.mount(reply(REPLY))
  await clock.settle()

  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Start/ })).toBeDefined()
  await ui.unmount()
})

test('C4 diagrams keep merman\'s own themed drawing', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  const { runs } = mmdc(on)

  const ui = await $.ui.mount(reply('```mermaid\nC4Context\n  Person(u, "User")\n  System(s, "Shop")\n  Rel(u, s, "Buys")\n```'))
  await clock.settle()

  expect(runs.every(r => r.source === 'flowchart LR\n  a --> b')).toBe(true)
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  await ui.unmount()
})

test('a tall diagram fits in 40 rows and keeps its shape', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  mmdc(on, () => PNG_360x2880)

  const ui = await $.ui.mount(reply(REPLY))
  await clock.settle()

  expect(sizeOf(await ui.find({ type: 'Image' }))).toEqual({ columns: 10, rows: 40 })
  await ui.unmount()
})

test('mermaidImages off runs nothing', { options: { mermaidImages: false } }, async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  const { runs } = mmdc(on)

  const ui = await $.ui.mount(reply(REPLY))
  await clock.settle()

  expect(runs.length).toBe(0)
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  await ui.unmount()
})

test('mermaid off runs nothing', { options: { mermaid: false } }, async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  const { runs } = mmdc(on)

  const ui = await $.ui.mount(reply(REPLY))
  await clock.settle()

  expect(runs.length).toBe(0)
  await ui.unmount()
})

for (const [name, env] of [['a terminal without kitty graphics', { TERM_PROGRAM: 'Apple_Terminal' }], ['tmux', { ...KITTY, TMUX: '/tmp/tmux-501/default,1,0' }]] as const) {
  test(`diagram images skip mmdc in ${name}`, async ($, on) => {
    mock.env(on, env)
    const clock = mock.clock(on)
    const { runs } = mmdc(on)

    const ui = await $.ui.mount(reply(REPLY))
    await clock.settle()

    expect(runs.length).toBe(0)
    await ui.unmount()
  })
}

test('diagram images draw in tmux when CLAUDE_CODE_FORCE_TERMINAL_IMAGES is set', async ($, on) => {
  mock.env(on, { ...KITTY, TMUX: '/tmp/tmux-501/default,1,0', CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '1' })
  const clock = mock.clock(on)
  mmdc(on)

  const ui = await $.ui.mount(reply(REPLY))
  await clock.settle()

  expect((await ui.find({ type: 'Image' }))?.props.alt).toBe(FLOW)
  await ui.unmount()
})

test('desktop draws diagrams as text', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  const { runs } = mmdc(on)

  const ui = await $.ui.mount({ ...reply(REPLY), surface: 'desktop' as const })
  await clock.settle()

  expect(runs.length).toBe(0)
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  await ui.unmount()
})

test('a light theme renders in light mode', async () => {
  const parsed = JSON.parse(diagramConfig(resolveStyle({ theme: 'catppuccin-latte' })))
  expect(parsed.themeVariables).toMatchObject({ darkMode: false, background: '#eff1f5', primaryTextColor: '#4c4f69' })
})

test('a diagram wider than the terminal shrinks to fit', async () => {
  expect(fitDiagram({ width: 4000, height: 1000 }, 60)).toEqual({ columns: 58, rows: 7 })
})

test('the browser mmdc starts has no network', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  const { runs, written } = mmdc(on)

  const ui = await $.ui.mount(reply(REPLY))
  await clock.settle()

  const browser = JSON.parse(written.get(runs.at(-1)!.argv[runs.at(-1)!.argv.indexOf('-p') + 1]!) ?? '{}')
  expect(browser.args).toEqual(expect.arrayContaining(['--host-resolver-rules=MAP * ~NOTFOUND']))
  await ui.unmount()
})

test('every run writes one reused file in the temp folder', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  const { runs } = mmdc(on)

  const ui = await $.ui.mount(reply(`${REPLY}\n\n\`\`\`mermaid\nflowchart LR\n  X --> Y\n\`\`\``))
  await clock.settle()

  expect(runs.length).toBe(3)
  expect(new Set(runs.map(r => r.out)).size).toBe(1)
  expect(runs[0]!.out.startsWith('/tmp/merman-mermaid-sess-1-')).toBe(true)
  await ui.unmount()
})

test('/merman theme random redraws diagrams in the new theme', { options: { theme: 'random' } }, async ($, on) => {
  mock.env(on, KITTY)
  on('config.set', (_, e) => ({ value: e.value }))
  const clock = mock.clock(on)
  const { runs, written } = mmdc(on)

  const ui = await $.ui.mount(reply(REPLY))
  await clock.settle()
  const before = runs.length
  const first = written.get(runs.at(-1)!.argv[runs.at(-1)!.argv.indexOf('-c') + 1]!)
  await $.command.run({ command: 'merman', args: 'theme random', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  await clock.settle()

  expect(runs.length).toBeGreaterThan(before)
  expect(runs.at(-1)?.source).toBe(FLOW)
  expect(written.get(runs.at(-1)!.argv[runs.at(-1)!.argv.indexOf('-c') + 1]!)).not.toBe(first)
  expect((await ui.find({ type: 'Image' }))?.props.alt).toBe(FLOW)
  await ui.unmount()
})

test('named colors become hex in the mmdc config', async () => {
  const parsed = JSON.parse(diagramConfig(resolveStyle({ theme: 'catppuccin-mocha', diagramColor: 'red', diagramTextColor: 'whiteBright' })))
  expect(parsed.themeVariables).toMatchObject({ primaryBorderColor: '#cd0000', primaryTextColor: '#ffffff' })
})

test('mono, with no known background, leaves label backgrounds transparent', async () => {
  const vars = JSON.parse(diagramConfig(resolveStyle({ theme: 'mono' }))).themeVariables
  expect(vars).toMatchObject({ edgeLabelBackground: 'transparent', labelBackground: 'transparent' })
  expect(JSON.stringify(vars)).not.toContain('null')
})

test('diagrams lay out at the terminal width, in steps of 20 columns', async () => {
  expect(layoutWidth(116)).toBe(900)
  expect(layoutWidth(114)).toBe(900)
  expect(layoutWidth(96)).toBe(720)
  expect(layoutWidth(10)).toBe(180)
  expect(layoutWidth(1000)).toBe(2160)
  expect(JSON.parse(sizedConfig(diagramConfig(resolveStyle({})), 900))).toMatchObject({ theme: 'base', gantt: { useWidth: 900, axisFormat: '%b %e' }, xyChart: { width: 900 } })
  expect(JSON.parse(browserConfig(900)).defaultViewport).toEqual({ width: 916, height: 600 })
})

test('mmdc gets the layout width in its config and browser page', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  const { runs, written } = mmdc(on)

  const ui = await $.ui.mount(reply(REPLY, 120))
  await clock.settle()

  const run = runs.at(-1)!
  const config = JSON.parse(written.get(run.argv[run.argv.indexOf('-c') + 1]!) ?? '{}')
  const browser = JSON.parse(written.get(run.argv[run.argv.indexOf('-p') + 1]!) ?? '{}')
  expect(config).toMatchObject({ gantt: { useWidth: 900, axisFormat: '%b %e' }, xyChart: { width: 900 } })
  expect(browser.defaultViewport).toEqual({ width: 916, height: 600 })
  await ui.unmount()
})

test('a resize within the same 20 columns keeps the image, a bigger one renders it again', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  const { runs } = mmdc(on)

  const wide = await $.ui.mount(reply(REPLY, 120))
  await clock.settle()
  await wide.unmount()
  const before = runs.filter(r => r.source === FLOW).length
  const near = await $.ui.mount(reply(REPLY, 118))
  await clock.settle()
  expect(runs.filter(r => r.source === FLOW).length).toBe(before)
  expect((await near.find({ type: 'Image' }))?.props.alt).toBe(FLOW)
  await near.unmount()
  const narrow = await $.ui.mount(reply(REPLY, 100))
  await clock.settle()
  expect(runs.filter(r => r.source === FLOW).length).toBe(before + 1)
  expect((await narrow.find({ type: 'Image' }))?.props.alt).toBe(FLOW)
  await narrow.unmount()
})
