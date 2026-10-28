import type { On } from 'claude-code'
import { expect, mock, test as base } from 'claude-code/testing'

import { keepFormulas, padFor, ratexColor } from '../hooks/latex'
import { parse, texText } from '../hooks/markdown'
import { PRESETS } from '../hooks/presets'

const PNG_160x80 = 'iVBORw0KGgoAAAANSUhEUgAAAKAAAABQAQAAAAC2JkOZAAAAFklEQVR42mNgGAWjYBSMglEwCgYeAAAGkAAB8Q2GVgAAAABJRU5ErkJggg=='
const PNG_800x400 = 'iVBORw0KGgoAAAANSUhEUgAAAyAAAAGQAQAAAAB+XjmZAAAAPklEQVR42u3BMQEAAADCoPVPbQ0PoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD4NndAAAYtfwy0AAAAASUVORK5CYII='
const PNG_1200x212 = 'iVBORw0KGgoAAAANSUhEUgAABLAAAADUAQAAAACkcOc9AAAANklEQVR42u3BgQAAAADDoPlTH+AKVQEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC8AX0MAAHD9IoJAAAAAElFTkSuQmCC'
const PNG_1228x240 = 'iVBORw0KGgoAAAANSUhEUgAABMwAAADwAQAAAADUOMULAAAAO0lEQVR42u3BMQEAAADCoPVPbQZ/oAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD4DkVAAATiOUPAAAAAASUVORK5CYII='
const PNG_1120x280 = 'iVBORw0KGgoAAAANSUhEUgAABGAAAAEYAQAAAAA7PL0PAAAAPElEQVR42u3BAQ0AAADCoPdP7ewBFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAN5o4AAH0PBZhAAAAAElFTkSuQmCC'
const PNG_900x90 = 'iVBORw0KGgoAAAANSUhEUgAAA4QAAABaAQAAAADI6aVUAAAAIElEQVR42u3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAAPBgKBQAAb8dNmgAAAAASUVORK5CYII='
const test = ((name: string, ...rest: unknown[]) => {
  const [opts, body] = rest.length === 1 ? [{}, rest[0]] : [rest[0] as { options?: object }, rest[1]]
  return (base as (...args: unknown[]) => void)(name, { ...opts, options: { latex: true, ...opts.options } }, body)
}) as unknown as typeof base

const KITTY = { TERM: 'xterm-kitty', TMPDIR: '/tmp/' }
const REPLY = 'The integral:\n\n$$\n\\int_0^1 x^2\\,dx\n$$\n\nDone.'

type Run = { argv: readonly string[]; formulas: string[] }

const ok = (formulas: string[]) => formulas.map((f, i) => `OK     ${i + 1} ${f}`).join('\n')

const ratex = (on: On, answer: (formulas: string[]) => string = ok, png: string | ((run: Run) => string) = PNG_160x80, hold?: Promise<void>) => {
  const runs: Run[] = []
  on('session.surfaces', () => ({ value: ['terminal'] as const }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('process.run', async (_, e) => {
    await hold
    const formulas = (e.init?.stdin ?? '').split('\n').filter(line => line !== '')
    runs.push({ argv: e.argv, formulas })
    return { value: { exitCode: 0, stdout: answer(formulas), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.read', (_, e) => {
    const run = runs.at(-1)
    const dir = run?.argv[run.argv.indexOf('--output-dir') + 1]
    const file = e.path.replace(/\\/g, '/')
    const index = Number(/\/(\d{4})\.png$/.exec(file)?.[1])
    if (!run || index < 1 || index > run.formulas.length || !file.endsWith(`${dir}/${String(index).padStart(4, '0')}.png`)) return { deny: `no such file ${e.path}` }
    return { value: { base64: typeof png === 'string' ? png : png(run) } }
  })
  return runs
}

const reply = (text: string, columns = 120) => ({
  plugin: 'merman',
  component: 'AssistantMessage' as const,
  props: { text, isFirstOfReply: true },
  viewport: { columns, rows: 40 },
  surface: 'terminal' as const,
})

const hints = (on: On) => {
  const seen: (readonly string[] | undefined)[] = []
  on('prompt.submit', (_, e) => {
    seen.push(e.context)
    return { text: e.text, context: e.context }
  })
  return seen
}

const parsed = (text: string) => parse(text, { numbers: false, paths: false })

const argOf = (run: Run | undefined, flag: string) => Number(run?.argv[run.argv.indexOf(flag) + 1])

const unpaddedFirst = (run: Run) => (argOf(run, '--dpr') === 1 ? PNG_1200x212 : PNG_1228x240)

const sizeOf = (image: { props: Record<string, unknown> } | undefined) => ({ columns: Number(image?.props.columns), rows: Number(image?.props.rows) })

test('$$ display math on its own lines parses as a math block', async () => {
  const blocks = parsed('Before\n\n$$\n\\frac{a}{b}\n$$\n\nAfter')

  expect(blocks.map(b => b.kind)).toEqual(['paragraph', 'code', 'paragraph'])
  expect(blocks[1]).toMatchObject({ kind: 'code', lang: 'math', lines: ['\\frac{a}{b}'] })
})

test('$$ math on one line parses as a math block', async () => {
  const [block] = parsed('$$E = mc^2$$')

  expect(block).toMatchObject({ kind: 'code', lang: 'math', lines: ['E = mc^2'] })
})

test('an unclosed $$ stays paragraph text', async () => {
  const blocks = parsed('$$\n\\frac{a}{b}')

  expect(blocks.map(b => b.kind)).toEqual(['paragraph'])
})

test('display math draws as an image that keeps the formula aspect', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  const runs = ratex(on)

  const ui = await $.ui.mount(reply(REPLY))
  await clock.settle()

  const image = await ui.find({ type: 'Image' })
  expect(image?.props.alt).toBe('\\int_0^1 x^2\\,dx')
  const { columns, rows } = sizeOf(image)
  expect(columns / rows).toBe(4)
  expect(runs.at(-1)?.formulas).toEqual(['\\int_0^1 x^2\\,dx'])
  await ui.unmount()
})

test('display math still draws as an image when file links are on', async ($, on) => {
  mock.env(on, { ...KITTY, HOME: '/home/me', WSL_DISTRO_NAME: 'Ubuntu' })
  on('session.version', () => ({ value: { version: '2.1.289', base: '2.1.289' } }))
  const clock = mock.clock(on)
  ratex(on)

  const ui = await $.ui.mount(reply(REPLY))
  await clock.settle()

  expect((await ui.find({ type: 'Image' }))?.props.alt).toBe('\\int_0^1 x^2\\,dx')
  await ui.unmount()
})

test('a math fence draws as an image too', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  ratex(on)

  const ui = await $.ui.mount(reply('```math\na^2 + b^2 = c^2\n```'))
  await clock.settle()

  expect((await ui.find({ type: 'Image' }))?.props.alt).toBe('a^2 + b^2 = c^2')
  await ui.unmount()
})

test('a formula the renderer rejects falls back to its text', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  ratex(on, formulas => formulas.map((f, i) => (f === 'x^2' ? `OK     ${i + 1} ${f}` : `ERR    ${i + 1} ${f} — Parse error: Undefined control sequence`)).join('\n'))

  const ui = await $.ui.mount(reply('$$\n\\badcommand{x}\n$$'))
  await clock.settle()

  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^\\badcommand\{x\}$/ })).toBeDefined()
  await ui.unmount()
})

test('without the renderer installed, math stays text and no LaTeX hint is sent', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  on('session.surfaces', () => ({ value: ['terminal'] as const }))
  on('process.run', () => ({ deny: 'spawn ratex-render ENOENT' }))
  const seen = hints(on)

  const ui = await $.ui.mount(reply(REPLY))
  await clock.settle()
  await $.prompt.submit({ text: 'integrate x squared', wait: false, origin: { kind: 'composer' } })

  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^∫₀¹ x² dx$/ })).toBeDefined()
  expect(seen[0]?.some(c => c.includes('merman'))).toBe(true)
  expect(seen[0]?.some(c => c.includes('$$'))).toBe(false)
  await ui.unmount()
})

test('the prompt hint says display math renders when the renderer works', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  ratex(on)
  on('session.start', () => ({ cwd: '/tmp' }))
  const seen = hints(on)

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await clock.settle()
  await $.prompt.submit({ text: 'integrate x squared', wait: false, origin: { kind: 'composer' } })

  expect(seen[0]?.some(c => c.includes('$$') && c.includes('LaTeX'))).toBe(true)
})

test('a prompt sent while the renderer check is still running is not held up and carries no LaTeX hint', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  let release = () => {}
  const held = new Promise<void>(resolve => (release = resolve))
  ratex(on, ok, PNG_160x80, held)
  on('session.start', () => ({ cwd: '/tmp' }))
  const seen = hints(on)

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'integrate x squared', wait: false, origin: { kind: 'composer' } })

  expect(seen).toHaveLength(1)
  expect(seen[0]?.some(c => c.includes('$$'))).toBe(false)
  release()
  await clock.settle()
  await $.prompt.submit({ text: 'and x cubed', wait: false, origin: { kind: 'composer' } })
  await $.prompt.submit({ text: 'thanks', wait: false, origin: { kind: 'composer' } })
  const latexOnly = (context: readonly string[] | undefined) => [context?.some(c => c.includes('$$') && c.includes('LaTeX')) ?? false, context?.some(c => c.includes('merman')) ?? false]
  expect(seen.map(latexOnly)).toEqual([[false, true], [true, false], [false, false]])
})

test('after the renderer fails once, later formulas stay text and it is not run again', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  let runs = 0
  on('session.surfaces', () => ({ value: ['terminal'] as const }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('process.run', (_, e) => {
    runs++
    const formulas = (e.init?.stdin ?? '').split('\n').filter(line => line !== '')
    return runs === 1
      ? { value: { exitCode: 0, stdout: ok(formulas), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      : { deny: 'renderer crashed' }
  })
  on('fs.read', () => ({ value: { base64: PNG_160x80 } }))

  const first = await $.ui.mount(reply(REPLY))
  await clock.settle()
  const afterFailure = runs
  const second = await $.ui.mount(reply('$$a^2 + b^2 = c^2$$'))
  await clock.settle()

  expect(afterFailure).toBe(2)
  expect(await first.find({ type: 'Image' })).toBeUndefined()
  expect(await first.find({ type: 'Text', text: /^∫₀¹ x² dx$/ })).toBeDefined()
  expect(runs).toBe(afterFailure)
  expect(await second.find({ type: 'Image' })).toBeUndefined()
  await first.unmount()
  await second.unmount()
})

test('after a later run fails, formulas already drawn stay drawn and new ones stay text', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  let runs = 0
  on('session.surfaces', () => ({ value: ['terminal'] as const }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('process.run', (_, e) => {
    runs++
    const formulas = (e.init?.stdin ?? '').split('\n').filter(line => line !== '')
    return runs <= 2
      ? { value: { exitCode: 0, stdout: ok(formulas), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      : { deny: 'renderer crashed' }
  })
  on('fs.read', () => ({ value: { base64: PNG_160x80 } }))

  const drawn = await $.ui.mount(reply(REPLY))
  await clock.settle()
  const later = await $.ui.mount(reply('$$a^2 + b^2 = c^2$$'))
  await clock.settle()
  const again = await $.ui.mount(reply(REPLY))
  await clock.settle()

  expect(runs).toBe(3)
  expect(await drawn.find({ type: 'Image' })).toBeDefined()
  expect(await later.find({ type: 'Image' })).toBeUndefined()
  expect(await again.find({ type: 'Image' })).toBeDefined()
  await drawn.unmount()
  await later.unmount()
  await again.unmount()
})

test('a reply draws its formula as text at once and as an image when the renderer check lands', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  let release = () => {}
  const held = new Promise<void>(resolve => (release = resolve))
  ratex(on, ok, PNG_160x80, held)

  const ui = await $.ui.mount(reply(REPLY))

  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^∫₀¹ x² dx$/ })).toBeDefined()
  release()
  await clock.settle()
  expect(await ui.find({ type: 'Image' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^∫₀¹ x² dx$/ })).toBeUndefined()
  await ui.unmount()
})

base('latex is off by default and never runs the renderer', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  const runs = ratex(on)

  const ui = await $.ui.mount(reply(REPLY))
  await clock.settle()

  expect(runs.length).toBe(0)
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  await ui.unmount()
})

for (const [name, env] of [['a terminal without kitty graphics', { TERM_PROGRAM: 'Apple_Terminal' }], ['tmux', { ...KITTY, TMUX: '/tmp/tmux-501/default,1,0' }]] as const) {
  test(`latex skips the renderer in ${name}`, async ($, on) => {
    mock.env(on, env)
    const clock = mock.clock(on)
    const runs = ratex(on)

    const ui = await $.ui.mount(reply(REPLY))
    await clock.settle()

    expect(runs.length).toBe(0)
    await ui.unmount()
  })
}

for (const [name, env] of [['a background session', { TMPDIR: '/tmp/', CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '1' }], ['tmux', { ...KITTY, TMUX: '/tmp/tmux-501/default,1,0', CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '1' }]] as const) {
  test(`latex draws in ${name} when CLAUDE_CODE_FORCE_TERMINAL_IMAGES is set`, async ($, on) => {
    mock.env(on, env)
    const clock = mock.clock(on)
    const runs = ratex(on)

    const ui = await $.ui.mount(reply(REPLY))
    await clock.settle()

    expect(runs.length).toBeGreaterThan(0)
    expect((await ui.find({ type: 'Image' }))?.props.alt).toBe('\\int_0^1 x^2\\,dx')
    await ui.unmount()
  })
}

test('the renderer runs as ratex-render in one folder named for the session plus a random suffix', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  const runs = ratex(on)

  const ui = await $.ui.mount(reply(REPLY))
  await clock.settle()

  expect(runs.length > 0).toBe(true)
  expect(runs.every(r => r.argv[0] === 'ratex-render')).toBe(true)
  const dirs = [...new Set(runs.map(r => r.argv[r.argv.indexOf('--output-dir') + 1]))]
  expect(dirs).toHaveLength(1)
  expect(dirs[0]).toMatch(/^\/tmp\/merman-latex-sess-1-[0-9a-f-]{36}$/)
  await ui.unmount()
})

test('formulas render at font 80 and density 1, so the renderer padding takes little of a row', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  const runs = ratex(on)

  const ui = await $.ui.mount(reply(REPLY))
  await clock.settle()

  expect(runs.at(-1)?.argv.join(' ')).toContain('--font-size 80 --dpr 1')
  await ui.unmount()
})

test('a formula is padded to whole rows only when fitting it would shrink it over 10% or stretch it over 5%', async () => {
  const heights = [60, 80, 88, 90, 212, 228, 229, 236]

  const rows = heights.map(height => padFor({ width: 600, height })?.rows ?? null)

  expect(rows).toEqual([1, null, null, 2, 3, 3, null, null])
})

test('padding raises the density as it lowers the font, so the glyphs keep their size', async () => {
  const pads = [60, 90, 212, 228].map(height => padFor({ width: 600, height }))

  expect(pads.map(pad => (pad?.dpr ?? 0) > 1)).toEqual([true, true, true, true])
  for (const pad of pads) expect(Math.abs((pad?.fontSize ?? 0) * (pad?.dpr ?? 0) - 80)).toBeLessThan(1e-9)
})

test('a formula between whole rows renders again with padding and draws at whole rows', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  const runs = ratex(on, ok, unpaddedFirst)

  const ui = await $.ui.mount(reply(REPLY))
  await clock.settle()

  const passes = runs.filter(r => r.formulas.includes('\\int_0^1 x^2\\,dx'))
  const image = await ui.find({ type: 'Image' })
  expect(passes.map(r => argOf(r, '--dpr') > 1)).toEqual([false, true])
  expect(Math.abs(argOf(passes[1], '--font-size') * argOf(passes[1], '--dpr') - 80) < 1e-9).toBe(true)
  expect((image?.props.source as { png?: string } | undefined)?.png).toBe(PNG_1228x240)
  expect(sizeOf(image).rows).toBe(3)
  await ui.unmount()
})

test('a padded formula too wide for the terminal draws the unpadded picture instead', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  ratex(on, ok, unpaddedFirst)

  const ui = await $.ui.mount(reply(REPLY, 24))
  await clock.settle()

  expect(((await ui.find({ type: 'Image' }))?.props.source as { png?: string } | undefined)?.png).toBe(PNG_1200x212)
  await ui.unmount()
})

test('a formula draws at its natural height and keeps its shape', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  const runs = ratex(on, ok, PNG_800x400)

  const ui = await $.ui.mount(reply(REPLY))
  await clock.settle()

  const { columns, rows } = sizeOf(await ui.find({ type: 'Image' }))
  expect(runs.map(r => argOf(r, '--dpr'))).toEqual([1, 1])
  expect(rows).toBe(5)
  expect(columns / rows).toBe(4)
  await ui.unmount()
})

test('two formulas that both need padding each draw their own picture', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  const picture = (run: Run) => (run.formulas.includes('b') ? PNG_1120x280 : unpaddedFirst(run))
  const runs = ratex(on, ok, picture)

  const ui = await $.ui.mount(reply('$$a$$\n\n$$b$$'))
  await clock.settle()

  const sources = (await ui.findAll({ type: 'Image' })).map(image => (image.props.source as { png?: string }).png)
  expect(runs.filter(r => argOf(r, '--dpr') !== 1)).toHaveLength(2)
  expect(sources).toHaveLength(2)
  expect(sources[0]).not.toBe(PNG_1120x280)
  expect(sources[1]).toBe(PNG_1120x280)
  await ui.unmount()
})

test('a multi-line formula reaches the renderer as one line without its % comments', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  const runs = ratex(on)

  const ui = await $.ui.mount(reply('$$\na + b % the sum\n= c \\% d\n$$'))
  await clock.settle()

  expect(runs.at(-1)?.formulas).toEqual(['a + b = c \\% d'])
  await ui.unmount()
})

test('a formula renders once however often the reply redraws', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  const runs = ratex(on)

  for (let i = 0; i < 3; i++) {
    const ui = await $.ui.mount(reply(REPLY))
    await clock.settle()
    await ui.unmount()
  }

  expect(runs.filter(r => r.formulas.includes('\\int_0^1 x^2\\,dx')).length).toBe(1)
})

test('an unclosed math fence does not run the renderer while it streams, and does once it closes', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  const runs = ratex(on)
  const rendered = () => runs.filter(r => r.formulas.includes('a^2 + b^2')).length

  const streaming = await $.ui.mount(reply('```math\na^2 + b^2'))
  await clock.settle()
  const whileStreaming = rendered()
  await streaming.unmount()
  const closed = await $.ui.mount(reply('```math\na^2 + b^2\n```'))
  await clock.settle()

  expect(whileStreaming).toBe(0)
  expect(rendered()).toBe(1)
  await closed.unmount()
})

test('on the desktop surface a formula stays text and the renderer does not run', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  const runs = ratex(on)

  const ui = await $.ui.mount({ ...reply(REPLY), surface: 'desktop' as const })
  await clock.settle()

  expect(runs).toHaveLength(0)
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  await ui.unmount()
})

test('a formula wider than the terminal shrinks to fit', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  ratex(on, ok, PNG_1120x280)

  const ui = await $.ui.mount(reply(REPLY, 20))
  await clock.settle()

  const { columns, rows } = sizeOf(await ui.find({ type: 'Image' }))
  expect(columns <= 18).toBe(true)
  expect(columns / rows).toBe(8)
  await ui.unmount()
})

test('a formula that cannot fit the terminal falls back to its text', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  ratex(on, ok, PNG_900x90)

  const ui = await $.ui.mount(reply(REPLY, 20))
  await clock.settle()

  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^∫₀¹ x² dx$/ })).toBeDefined()
  await ui.unmount()
})

const stubClipboard = (on: On) => {
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true as const } }
  })
  return copied
}

test("a typeset formula gets the usual copy button, and it copies the formula's LaTeX", async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  ratex(on)
  const copied = stubClipboard(on)

  const ui = await $.ui.mount(reply(REPLY))
  await clock.settle()
  const buttons = (await ui.findAll({ type: 'Button' })).filter(b => b.props.label === '⧉ copy')
  expect(await ui.find({ type: 'Image' })).toBeDefined()
  expect(buttons).toHaveLength(1)
  await ui.press({ key: String(buttons[0]?.key) })

  expect(copied).toEqual(['\\int_0^1 x^2\\,dx'])
  await ui.unmount()
})

test('with copy buttons off, a typeset formula has no copy button', { options: { copyButtons: false } }, async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  ratex(on)

  const ui = await $.ui.mount(reply(REPLY))
  await clock.settle()

  expect(await ui.find({ type: 'Image' })).toBeDefined()
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  await ui.unmount()
})

test('back-to-back formulas stack one per line instead of sharing a row', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  ratex(on)

  const ui = await $.ui.mount(reply('$$a^2 + b^2 = c^2$$\n\n$$e^{i\\pi} + 1 = 0$$'))
  await clock.settle()

  expect(await ui.findAll({ type: 'Image' })).toHaveLength(2)
  expect((await ui.findAll({ type: 'Box' })).filter(b => b.props.flexWrap === 'wrap')).toHaveLength(0)
  await ui.unmount()
})

for (const [color, hex] of [['ansi256(114)', '#87d787'], ['cyanBright', '#00ffff'], ['rgb(166, 227, 161)', '#a6e3a1'], ['#fc0', '#fc0']] as const) {
  test(`the diagram text color ${color} reaches the renderer as ${hex}, a color it accepts`, { options: { diagramTextColor: color } }, async ($, on) => {
    mock.env(on, KITTY)
    const clock = mock.clock(on)
    const runs = ratex(on)

    const ui = await $.ui.mount(reply(REPLY))
    await clock.settle()

    expect([...new Set(runs.map(r => r.argv[r.argv.indexOf('--color') + 1]))]).toEqual([hex])
    await ui.unmount()
  })
}

const keys = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => `k${from + i}`)
const storeOf = (names: string[]) => Object.fromEntries(names.map(name => [name, name]))

test('the formula store keeps the newest 50, dropping the oldest', async () => {
  const kept = keepFormulas(storeOf(keys(0, 50)), [['k50', 'k50']], new Set())

  expect(Object.keys(kept)).toEqual(keys(1, 51))
})

test('the formula store never drops a formula a draw still wants, even past 50', async () => {
  const kept = keepFormulas(storeOf(keys(0, 50)), [['k50', 'k50']], new Set(keys(0, 50)))

  expect(Object.keys(kept)).toEqual(keys(0, 51))
})

test('a reply that streams in more formulas than the store keeps renders each formula once', { timeoutMs: 20000 }, async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  const runs = ratex(on)
  const texs = Array.from({ length: 60 }, (_, i) => `x_{${i}}`)
  const replyOf = (count: number) => reply(texs.slice(0, count).map(tex => `$$${tex}$$`).join('\n\n'))

  const half = await $.ui.mount(replyOf(30))
  await clock.settle()
  await half.unmount()
  const whole = await $.ui.mount(replyOf(60))
  await clock.settle()

  expect(texs.map(tex => runs.filter(r => r.formulas.includes(tex)).length)).toEqual(texs.map(() => 1))
  expect(await whole.findAll({ type: 'Image' })).toHaveLength(60)
  await whole.unmount()
})

test('replies drawn together, as on resume, typeset their formulas in one renderer run', async ($, on) => {
  mock.env(on, KITTY)
  const clock = mock.clock(on)
  const runs = ratex(on)

  const uis = await Promise.all(['a^2', 'b^2', 'c^2'].map(tex => $.ui.mount(reply(`$$${tex}$$`))))
  await clock.settle()

  expect(runs.map(r => r.formulas)).toEqual([['x^2'], ['a^2', 'b^2', 'c^2']])
  expect(await Promise.all(uis.map(async ui => (await ui.findAll({ type: 'Image' })).length))).toEqual([1, 1, 1])
  await Promise.all(uis.map(ui => ui.unmount()))
})

test('display math without an image reads as Unicode, and keeps TeX it cannot convert', () => {
  expect(texText(String.raw`\frac{T}{R}\left(1 + \ln\frac{R}{T}\right) \approx \frac{1}{120{,}000}`)).toBe('(T/R)·(1 + ln(R/T)) ≈ 1/120,000')
  expect(texText(String.raw`\int_0^\infty e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}`)).toBe('∫₀^∞ e⁻ˣ² dx = √π/2')
  expect(texText(String.raw`g \sim \mathcal{U}[0, M), \mathbb{E}_M`)).toBe('g ∼ 𝒰[0, M), 𝔼_M')
  expect(texText(String.raw`x_{i+1} = \frac{a+b}{c}`)).toBe('xᵢ₊₁ = (a+b)/c')
  expect(texText(String.raw`\badcommand{x}`)).toContain('\\badcommand')
})

test('in Warp a formula draws as Unicode text, not as its TeX source', async ($, on) => {
  mock.env(on, { TERM_PROGRAM: 'WarpTerminal' })
  on('session.surfaces', () => ({ value: ['terminal'] as const }))
  const ui = await $.ui.mount(reply(REPLY))
  expect(await ui.find({ type: 'Text', text: /^∫₀¹ x² dx$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\\int/ })).toBeUndefined()
  await ui.unmount()
})

test('after /merman random, new formulas take the new theme color', { options: { theme: 'random' } }, async ($, on) => {
  mock.env(on, KITTY)
  on('config.set', (_, e) => ({ value: e.value }))
  const clock = mock.clock(on)
  const runs = ratex(on)
  const first = await $.ui.mount(reply(REPLY))
  await clock.settle()
  await first.unmount()
  const run = await $.command.run({ command: 'merman', args: 'random', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  const picked = (PRESETS as Record<string, { diagramText?: string; codeText?: string }>)[/^Theme set to random: (\S+) for now/.exec(run.text ?? '')?.[1] ?? '']
  const second = await $.ui.mount(reply('Next:\n\n$$\nx^3\n$$'))
  await clock.settle()
  expect(runs.at(-1)?.argv[runs.at(-1)!.argv.indexOf('--color') + 1]).toBe(ratexColor(picked?.diagramText ?? picked?.codeText ?? '#808080'))
  await second.unmount()
})

test('a theme switch while a formula typesets redraws it in the new color', { options: { theme: 'random' } }, async ($, on) => {
  mock.env(on, KITTY)
  on('config.set', (_, e) => ({ value: e.value }))
  const clock = mock.clock(on)
  let gate: Promise<void> = Promise.resolve()
  const runs = ratex(on, ok, PNG_160x80, { then: (done: () => void) => gate.then(done) } as Promise<void>)
  const warm = await $.ui.mount(reply(REPLY))
  await clock.settle()
  await warm.unmount()
  let release = () => {}
  gate = new Promise(r => (release = r))
  const late = await $.ui.mount(reply('Late:\n\n$$\nx^3\n$$'))
  await clock.settle()
  const run = await $.command.run({ command: 'merman', args: 'random', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  release()
  await clock.settle()
  await late.unmount()
  const picked = (PRESETS as Record<string, { diagramText?: string; codeText?: string }>)[/^Theme set to random: (\S+) for now/.exec(run.text ?? '')?.[1] ?? '']
  const again = await $.ui.mount(reply('Late:\n\n$$\nx^3\n$$'))
  await clock.settle()
  const cubes = runs.filter(r => r.formulas.includes('x^3'))
  expect(cubes.at(-1)?.argv[cubes.at(-1)!.argv.indexOf('--color') + 1]).toBe(ratexColor(picked?.diagramText ?? picked?.codeText ?? '#808080'))
  await again.unmount()
})

for (const tex of ['\\toString x', '\\constructor x', '\\hasOwnProperty x', '\\left\\toString x \\right.']) test(`${tex} draws as text, not as JavaScript`, async () => {
  expect(texText(tex)).not.toMatch(/function|native code|\[object/)
})
