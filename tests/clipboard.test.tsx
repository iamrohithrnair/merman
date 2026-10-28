import { expect, mock, test } from 'claude-code/testing'

import { LINUX_TABLE_COPY, MAC_IMAGE_COPY, MAC_TABLE_COPY, WIN_IMAGE_COPY, WIN_TABLE_COPY, imageCommand } from '../hooks/clipboard'
import { clipboardEnv, recordCopies, recordToasts, runResult, startSession } from './clipboard-env'

const source = '| Name | Value |\n|--|--:|\n| **שלום** | `$(ignored)` |'
const plain = 'Name\tValue\nשלום\t$(ignored)'
const mount = {
  plugin: 'merman',
  component: 'AssistantMessage' as const,
  props: { text: source, isFirstOfReply: true },
  viewport: { columns: 120, rows: 40 },
  surface: 'terminal' as const,
}

const backends = {
  macos: { platform: 'macos', env: {}, argv: ['/usr/bin/osascript', '-l', 'JavaScript', '-e', MAC_TABLE_COPY] },
  wayland: { platform: 'other', env: { WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' }, argv: ['copyq', 'eval', LINUX_TABLE_COPY, '-'] },
  x11: { platform: 'other', env: { DISPLAY: ':0' }, argv: ['copyq', 'eval', LINUX_TABLE_COPY, '-'] },
} as const

for (const [backend, setup] of Object.entries(backends)) test(`${backend} copies HTML and plain text together`, async ($, on) => {
  clipboardEnv(on, setup.platform, setup.env)
  const calls: { argv: readonly string[]; input: string }[] = []
  on('process.run', (_, e) => {
    calls.push({ argv: e.argv, input: e.init?.stdin ?? '' })
    return runResult(0)
  })
  const copies = recordCopies(on)
  const toasts = recordToasts(on)
  await startSession($, on)
  const ui = await $.ui.mount(mount)
  expect((await ui.findAll({ type: 'Button' })).map(button => button.props.label).filter(label => label !== '⧉ copy reply')).toEqual(['⧉ md', '⧉ art', '⧉ html', ...(backend === 'macos' ? ['▣ png'] : [])])
  expect(calls).toHaveLength(0)
  await ui.press({ key: 'html0' })
  expect(calls).toHaveLength(1)
  expect(calls[0]!.argv).toEqual(setup.argv)
  const payload = JSON.parse(calls[0]!.input)
  expect(payload.text).toBe(plain)
  expect(payload.html).toContain('<strong>שלום</strong>')
  expect(payload.html).toContain('<code style="white-space: pre-wrap">$(ignored)</code>')
  expect(copies).toHaveLength(0)
  expect(toasts).toEqual(['Copied formatted table'])
  await ui.unmount()
})

test('windows copies HTML and CRLF plain text through PowerShell', async ($, on) => {
  clipboardEnv(on, 'other', { OS: 'Windows_NT', SystemRoot: 'C:\\Windows' })
  const calls: { argv: readonly string[]; input: string }[] = []
  on('process.run', (_, e) => {
    calls.push({ argv: e.argv, input: e.init?.stdin ?? '' })
    return runResult(0)
  })
  const copies = recordCopies(on)
  const toasts = recordToasts(on)
  await startSession($, on)
  const ui = await $.ui.mount({ ...mount, props: { text: '| Name | Value |\n|--|--|\n| ✅ done | ❌ failed |', isFirstOfReply: true } })
  expect((await ui.findAll({ type: 'Button' })).map(button => button.props.label).filter(label => label !== '⧉ copy reply')).toEqual(['⧉ md', '⧉ art', '⧉ html', '▣ png'])
  expect(calls).toHaveLength(0)
  await ui.press({ key: 'html0' })
  expect(calls).toHaveLength(1)
  expect(calls[0]!.argv[0]).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
  expect(calls[0]!.argv).not.toContain('-ExecutionPolicy')
  expect(calls[0]!.argv).toContain('-STA')
  expect(calls[0]!.argv.at(-1)).toBe(WIN_TABLE_COPY)
  expect(calls[0]!.input).toMatch(/^[\x00-\x7e]*$/)
  const payload = JSON.parse(calls[0]!.input)
  expect(payload.html.startsWith('<table>')).toBe(true)
  expect(payload.html).toContain('<th style="text-align: left">Name</th>')
  expect(payload.html).not.toContain('Excel')
  expect(payload.html).toContain('✅ done')
  expect(payload.text).toBe('Name\tValue\r\n✅ done\t❌ failed')
  expect(copies).toHaveLength(0)
  expect(toasts).toEqual(['Copied formatted table'])
  await ui.unmount()
})

test('windows without SystemRoot falls back to plain text without running PowerShell', async ($, on) => {
  clipboardEnv(on, 'other', { OS: 'Windows_NT' })
  let processes = 0
  on('process.run', () => {
    processes++
    return runResult(0)
  })
  const copies = recordCopies(on)
  const toasts = recordToasts(on)
  await startSession($, on)
  const ui = await $.ui.mount(mount)
  await ui.press({ key: 'html0' })
  expect(processes).toBe(0)
  expect(copies).toEqual([plain])
  expect(toasts).toEqual(['Copied as plain text (Windows clipboard helper failed)'])
  await ui.unmount()
})

for (const failure of ['exit', 'refused'] as const) test(`native clipboard ${failure} falls back to plain text`, async ($, on) => {
  clipboardEnv(on, 'macos')
  on('process.run', () => failure === 'refused' ? { deny: 'Cannot start helper' } : runResult(1, 'Clipboard unavailable'))
  const copies = recordCopies(on)
  const toasts = recordToasts(on)
  await startSession($, on)
  const ui = await $.ui.mount(mount)
  await ui.press({ key: 'html0' })
  expect(toasts).toEqual([`Copied as plain text (${failure === 'exit' ? 'Clipboard unavailable' : 'macOS clipboard helper failed'})`])
  expect(copies).toEqual([plain])
  await ui.unmount()
})

for (const failure of ['missing', 'exit', 'timeout'] as const) test(`Linux clipboard ${failure} falls back to plain text`, async ($, on) => {
  clipboardEnv(on, 'other', { DISPLAY: ':0' })
  on('process.run', () => failure === 'timeout' ? { deny: 'Process timed out' } : runResult(failure === 'missing' ? 127 : 1))
  const copies = recordCopies(on)
  const toasts = recordToasts(on)
  await startSession($, on)
  const ui = await $.ui.mount(mount)
  await ui.press({ key: 'html0' })
  expect(copies).toEqual([plain])
  expect(toasts).toEqual(['Copied as plain text (CopyQ failed; install and start CopyQ in the graphical session)'])
  await ui.unmount()
})

const hidden = {
  'over SSH_CONNECTION': { platform: 'macos', env: { SSH_CONNECTION: 'remote connection' }, surface: 'terminal' },
  'over SSH_TTY': { platform: 'macos', env: { SSH_TTY: '/dev/ttys001' }, surface: 'terminal' },
  'over SSH with a forwarded display': { platform: 'other', env: { SSH_CONNECTION: 'remote connection', DISPLAY: 'localhost:10.0' }, surface: 'terminal' },
  'over SSH on Windows': { platform: 'other', env: { OS: 'Windows_NT', SSH_CONNECTION: 'remote connection' }, surface: 'terminal' },
  'without a graphical session': { platform: 'other', env: {}, surface: 'terminal' },
  'on desktop': { platform: 'macos', env: {}, surface: 'desktop' },
  'on desktop in Linux': { platform: 'other', env: { WAYLAND_DISPLAY: 'wayland-0' }, surface: 'desktop' },
} as const

for (const [where, setup] of Object.entries(hidden)) test(`the HTML action is hidden ${where}`, async ($, on) => {
  clipboardEnv(on, setup.platform, setup.env)
  let processes = 0
  on('process.run', () => {
    processes++
    return { deny: 'Must not run the native helper' }
  })
  const copies = recordCopies(on)
  await startSession($, on)
  const ui = await $.ui.mount({ ...mount, surface: setup.surface })
  expect((await ui.findAll({ type: 'Button' })).map(button => button.props.label).filter(label => label !== '⧉ copy reply')).toEqual(['⧉ md', '⧉ art'])
  await ui.press({ key: 'copy0' })
  expect(copies).toEqual([source])
  expect(processes).toBe(0)
  await ui.unmount()
})

test('the HTML check runs once, on session start or on the first prompt after a reload', async ($, on) => {
  let checks = 0
  mock.env(on, {})
  on('fs.stat', (_, e, next) => {
    if (!e.path.replace(/\\/g, '/').endsWith('/usr/bin/osascript')) return next(e)
    checks++
    return { value: { kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false } }
  })
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  on('session.start', () => ({ cwd: '/tmp' }))
  const before = await $.ui.mount(mount)
  expect((await before.findAll({ type: 'Button' })).map(button => button.props.label).filter(label => label !== '⧉ copy reply')).toEqual(['⧉ md', '⧉ art'])
  await before.unmount()
  await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })
  await $.prompt.submit({ text: 'again', wait: false, origin: { kind: 'composer' } })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const after = await $.ui.mount(mount)
  expect((await after.findAll({ type: 'Button' })).map(button => button.props.label).filter(label => label !== '⧉ copy reply')).toEqual(['⧉ md', '⧉ art', '⧉ html', '▣ png'])
  expect(checks).toBe(1)
  await after.unmount()
})

test('with copyButtons off the HTML check waits for /merman setup, whose copy samples still show every button', { options: { copyButtons: false } }, async ($, on) => {
  let checks = 0
  mock.env(on, {})
  on('fs.stat', (_, e, next) => {
    if (!e.path.replace(/\\/g, '/').endsWith('/usr/bin/osascript')) return next(e)
    checks++
    return { value: { kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false } }
  })
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  on('session.start', () => ({ cwd: '/tmp' }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })
  const quiet = await $.ui.mount(mount)
  expect(await quiet.findAll({ type: 'Button' })).toEqual([])
  await quiet.unmount()
  expect(checks).toBe(0)
  const { text = '' } = await $.command.run({ command: 'merman', args: 'setup copy', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  expect(checks).toBe(1)
  const sample = await $.ui.mount({ plugin: 'merman', surface: 'terminal', component: 'CommandOutput', props: { command: 'merman', args: 'setup copy', text, isErrored: false }, viewport: { columns: 120, rows: 40 } })
  expect(await sample.findAll({ type: 'Text', text: /^\[ (⧉ html|▣ png) \]$/ })).toHaveLength(4)
  await sample.unmount()
})

test('a table drawn before the HTML check lands gains ⧉ html when it lands', async ($, on) => {
  let release = () => {}
  const held = new Promise<void>(resolve => { release = resolve })
  mock.env(on, {})
  on('fs.stat', async (_, e, next) => {
    if (!e.path.replace(/\\/g, '/').endsWith('/usr/bin/osascript')) return next(e)
    await held
    return { value: { kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false } }
  })
  on('session.start', () => ({ cwd: '/tmp' }))
  const ui = await $.ui.mount(mount)
  const labels = async () => (await ui.findAll({ type: 'Button' })).map(button => button.props.label).filter(label => label !== '⧉ copy reply')
  const started = $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  expect(await labels()).toEqual(['⧉ md', '⧉ art'])
  release()
  await started
  expect(await labels()).toEqual(['⧉ md', '⧉ art', '⧉ html', '▣ png'])
  await ui.unmount()
})

for (const key of ['copy0', 'html0']) for (const failure of ['unavailable', 'refused'] as const) test(`${key} reports a ${failure} surface clipboard`, async ($, on) => {
  clipboardEnv(on, 'macos')
  on('process.run', () => runResult(1))
  on('ui.copy', () => failure === 'refused'
    ? { deny: 'Clipboard denied' }
    : { value: { isCopied: false as const, reason: 'no-clipboard' as const } })
  const toasts = recordToasts(on)
  await startSession($, on)
  const ui = await $.ui.mount(mount)
  await ui.press({ key })
  expect(toasts).toEqual([failure === 'refused' ? 'Copy failed' : 'Copy failed: no-clipboard'])
  await ui.unmount()
})

test('the image helper gets each glyph at its terminal column, and the theme colors as RGB, on stdin', async () => {
  const text = '┌──┬──┐\n│苹│ab│\n└──┴──┘'
  const mac = imageCommand('macos', text, { foreground: '#cdd6f4', background: '#1e1e2e' })!
  expect(mac.argv).toEqual(['/usr/bin/osascript', '-l', 'JavaScript', '-e', MAC_IMAGE_COPY])
  const row = (s: string) => [...s].map((text, at) => ({ at, text }))
  expect(JSON.parse(mac.stdin)).toEqual({
    lines: [row('┌──┬──┐'), [{ at: 0, text: '│' }, { at: 1, text: '苹' }, { at: 3, text: '│' }, { at: 4, text: 'a' }, { at: 5, text: 'b' }, { at: 6, text: '│' }], row('└──┴──┘')],
    columns: 7,
    foreground: [205, 214, 244],
    background: [30, 30, 46],
  })
  const win = imageCommand('windows', text, { foreground: 'ansi256(15)', background: '#fff' }, 'C:\\Windows')!
  expect(win.argv).toEqual(['C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', '-NoProfile', '-NonInteractive', '-STA', '-Command', WIN_IMAGE_COPY])
  expect(win.stdin).toMatch(/^[\x00-\x7e]*$/)
  expect(JSON.parse(win.stdin)).toEqual({ ...JSON.parse(mac.stdin), foreground: [0, 0, 0], background: [255, 255, 255] })
  expect(JSON.parse(imageCommand('macos', 'x', { foreground: 'cyan' })!.stdin)).toMatchObject({ foreground: [0, 0, 0], background: [255, 255, 255] })
  expect(JSON.parse(imageCommand('macos', 'x', { foreground: '#c9d4f2' })!.stdin)).toMatchObject({ foreground: [0, 0, 0], background: [255, 255, 255] })
  expect(JSON.parse(imageCommand('macos', 'x', { foreground: '#202020', background: '#1e1e2e' })!.stdin)).toMatchObject({ foreground: [255, 255, 255] })
})

test('the image helper gets right-to-left cell text in drawn order, each letter in its own column, borders kept in place', async () => {
  const lines = JSON.parse(imageCommand('macos', '│ שלום │ 3 │\n│ Pears אגסים │', {}).stdin).lines
  expect(lines[0]).toEqual([{ at: 0, text: '│' }, { at: 2, text: 'ם' }, { at: 3, text: 'ו' }, { at: 4, text: 'ל' }, { at: 5, text: 'ש' }, { at: 7, text: '│' }, { at: 9, text: '3' }, { at: 11, text: '│' }])
  expect(lines[1].map((g: { text: string }) => g.text).join('')).toBe('│Pearsםיסגא│')
  expect(lines[1].at(-1)).toEqual({ at: 14, text: '│' })
})

const figures = '| Item | Qty |\n|--|--:|\n| 苹果 | 3 |\n\n```mermaid\ngraph LR\nA[User] --> B[Gateway]\n```'
const pngSetups = {
  macos: { platform: 'macos', env: {}, script: MAC_IMAGE_COPY },
  windows: { platform: 'other', env: { OS: 'Windows_NT', SystemRoot: 'C:\\Windows' }, script: WIN_IMAGE_COPY },
  linux: { platform: 'other', env: { DISPLAY: ':0' }, script: undefined },
} as const

for (const surface of ['terminal', 'desktop'] as const) for (const [backend, setup] of Object.entries(pngSetups)) test(`▣ png on tables and diagrams ${setup.script && surface === 'terminal' ? 'copies an image' : 'is hidden'} on ${backend} ${surface}`, async ($, on) => {
  clipboardEnv(on, setup.platform, setup.env)
  const calls: { argv: readonly string[]; input: string }[] = []
  on('process.run', (_, e) => {
    calls.push({ argv: e.argv, input: e.init?.stdin ?? '' })
    return runResult(0)
  })
  const copies = recordCopies(on)
  const toasts = recordToasts(on)
  await startSession($, on)
  const ui = await $.ui.mount({ ...mount, surface, props: { text: figures, isFirstOfReply: true } })
  const pngs = (await ui.findAll({ type: 'Button' })).filter(button => button.props.label === '▣ png').map(button => button.key)
  if (!setup.script || surface !== 'terminal') {
    expect(pngs).toEqual([])
    await ui.unmount()
    return
  }
  expect(pngs).toEqual(['png0', 'png1'])
  await ui.press({ key: 'art0' })
  await ui.press({ key: 'png0' })
  expect(calls).toHaveLength(1)
  expect(calls[0]!.argv.at(-1)).toBe(setup.script)
  const drawn = JSON.parse(calls[0]!.input).lines.map((glyphs: { text: string }[]) => glyphs.map(g => g.text).join(''))
  expect(copies[0]).toContain('```')
  expect(drawn.join('\n')).not.toContain('`')
  expect(drawn).toEqual(copies[0]!.split('\n').slice(1, -1).map(line => line.replace(/ /g, '')))
  await ui.press({ key: 'png1' })
  expect(JSON.parse(calls[1]!.input).lines.flat().map((run: { text: string }) => run.text).join('')).toContain('Gateway')
  expect(toasts).toEqual(['Copied', 'Copied as image', 'Copied as image'])
  await ui.unmount()
})

test('a failed image copy falls back to the drawn text and says why', async ($, on) => {
  clipboardEnv(on, 'macos')
  on('process.run', () => runResult(1, 'Cannot draw image'))
  const copies = recordCopies(on)
  const toasts = recordToasts(on)
  await startSession($, on)
  const ui = await $.ui.mount({ ...mount, props: { text: figures, isFirstOfReply: true } })
  await ui.press({ key: 'png0' })
  expect(copies[0]).toContain('│ 苹果 │')
  expect(toasts).toEqual(['Copied as plain text (Cannot draw image)'])
  await ui.unmount()
})

test('copyButtons off draws no ▣ png', { options: { copyButtons: false } }, async ($, on) => {
  clipboardEnv(on, 'macos')
  await startSession($, on)
  const ui = await $.ui.mount({ ...mount, props: { text: figures, isFirstOfReply: true } })
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  await ui.unmount()
})
