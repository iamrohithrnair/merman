import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import type { Inline } from '../hooks/markdown'
import { inlineText } from '../hooks/markdown'
import { rtlShowcaseText } from '../hooks/help'
import { PRESETS } from '../hooks/presets'
import { ROW_MARK, ROW_MARK_TEXT, TERMINALS, WALL, commentTail, flow, holdEngine, holdRow, holdVisual, terminalLine } from '../hooks/rtl'
import { claudeAt, linksHttp } from './claude-version'
import { paintOf, paintsOf } from './paint'

const measure = (s: string) => [...s].length
const plain = (text: string, columns = 100) => flow([{ kind: 'text', text }], columns, measure)
const visual = (text: string) => plain(text)?.lines.map(inlineText).join('\n')

const mount = (text: string, columns = 120) => ({
  plugin: 'merman',
  component: 'AssistantMessage' as const,
  props: { text, isFirstOfReply: true },
  viewport: { columns, rows: 40 },
  surface: 'terminal' as const,
})

const mountDemo = (text: string) => ({
  plugin: 'merman',
  component: 'CommandOutput' as const,
  props: { command: 'merman', args: 'demo-rtl', text, isErrored: false },
  viewport: { columns: 120, rows: 40 },
  surface: 'terminal' as const,
})

test('pure Hebrew reverses and takes a right base', async () => {
  expect(plain('שלום')?.base).toBe('R')
  expect(visual('שלום')).toBe('םולש')
})

test('a Latin run inside Hebrew keeps its own order', async () => {
  expect(visual('שלום Warp')).toBe('Warp םולש')
  expect(visual('שרת web-server רץ על פורט')).toBe('טרופ לע ץר web-server תרש')
})

test('hyphen and percent around a number follow the Hebrew base', async () => {
  expect(visual('שרתים ו-100% פעילים')).toBe('םיליעפ 100%-ו םיתרש')
})

test('parentheses mirror inside a Hebrew line', async () => {
  expect(visual('שרתים (east ו-west) פעילים')).toBe('םיליעפ (west-ו east) םיתרש')
})

test('inline code and paths stay one left-to-right unit inside Hebrew', async () => {
  const nodes: Inline[] = [{ kind: 'text', text: 'מחליפים עם ' }, { kind: 'code', text: '/merman theme nord' }, { kind: 'text', text: ' ו-' }, { kind: 'path', text: '~/app/main.ts' }]
  const line = flow(nodes, 100, measure)?.lines[0]
  expect(line?.find(n => n.kind === 'code')).toEqual({ kind: 'code', text: '/merman theme nord' })
  expect(line?.find(n => n.kind === 'path')).toEqual({ kind: 'path', text: '~/app/main.ts' })
})

test('a percent sign stays on the right of its number', async () => {
  expect(visual('ירידה של 5%')).toBe('5% לש הדירי')
})

test('an English sentence with one Hebrew word stays left and flips only that word', async () => {
  const f = plain('The cluster is ready שלום now')
  expect(f?.base).toBe('L')
  expect(f?.lines.map(inlineText)).toEqual(['The cluster is ready םולש now'])
})

test('Hebrew points stay attached to their letter', async () => {
  expect(visual('שָלום')).toBe('םולשָ')
})

test('Arabic reverses and Arabic-Indic digits keep their order', async () => {
  expect(visual('مرحبا')).toBe('ابحرم')
  expect(visual('١٢٣ مرحبا')).toBe('ابحرم ١٢٣')
})

test('bold, code and links keep their style through reordering', async () => {
  const nodes: Inline[] = [
    { kind: 'strong', children: [{ kind: 'text', text: 'שלום' }] },
    { kind: 'text', text: ' עולם ' },
    { kind: 'code', text: 'kubectl' },
    { kind: 'text', text: ' ' },
    { kind: 'link', text: 'תיעוד', href: 'https://x.dev' },
  ]
  const line = flow(nodes, 100, measure)?.lines[0]
  expect(line?.map(n => n.kind)).toEqual(['link', 'text', 'code', 'text', 'strong'])
  const strong = line?.find(n => n.kind === 'strong')
  expect(strong?.kind === 'strong' && inlineText(strong.children)).toBe('םולש')
  expect(line?.find(n => n.kind === 'code')).toEqual({ kind: 'code', text: 'kubectl' })
})

test('a long right-based paragraph wraps in reading order, each line reordered', async () => {
  const f = plain('אחד שניים שלושה ארבעה חמישה שישה שבעה', 14)
  expect(f?.lines.map(inlineText)).toEqual(['םיינש דחא', 'העברא השולש', 'השיש השימח', 'העבש'])
})

test('text with no right-to-left character takes the old path', async () => {
  expect(plain('hello world 100%')).toBeNull()
  expect(flow([{ kind: 'strong', children: [{ kind: 'text', text: 'ok' }] }], 100, measure)).toBeNull()
  expect(commentTail('ls # hello')).toBeNull()
})

test('only the comment tail of a code line is reordered', async () => {
  expect(commentTail('ls # שלום')).toEqual({ head: 'ls', marker: ' # ', tail: 'םולש' })
  expect(commentTail('// שלום עולם')).toEqual({ head: '', marker: '// ', tail: 'םלוע םולש' })
})

test('a Hebrew paragraph is right aligned and reordered', { options: { rtl: 'warp' } }, async $ => {
  const ui = await $.ui.mount(mount('שלום עולם'))
  expect(await ui.find({ type: 'Text', text: /^םלוע םולש$/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Box' })).some(b => b.props.alignItems === 'flex-end')).toBe(true)
  await ui.unmount()
})

test('a Hebrew paragraph wraps into right aligned lines at the viewport width', { options: { rtl: 'warp' } }, async $ => {
  const ui = await $.ui.mount(mount('אחד שניים שלושה ארבעה חמישה שישה שבעה', 30))
  const lines = (await ui.findAll({ type: 'Text' })).filter(t => /[א-ת]/.test(t.text))
  expect(lines.length >= 2).toBe(true)
  await ui.unmount()
})

test('bullets move to the right end and ordered items keep their number', { options: { rtl: 'warp' } }, async $ => {
  const ui = await $.ui.mount(mount('- שלום\n- עולם\n\n1. אחד\n2. שניים'))
  expect((await ui.findAll({ type: 'Text', text: /^ •$/ })).length).toBe(2)
  expect(await ui.find({ type: 'Text', text: /^ \.1$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ \.2$/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Box' })).some(b => b.props.justifyContent === 'flex-end')).toBe(true)
  await ui.unmount()
})

for (const rtl of ['warp', 'windows-terminal'] as const) test(`a Hebrew ordered item draws its dot or bracket on the left of the number on ${rtl}`, { options: { rtl } }, async $ => {
  const ui = await $.ui.mount(mount('1. אחד\n2. שניים\n\n9) תשע\n10) עשר'))
  expect(await ui.find({ type: 'Text', text: /^ \.1$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ \(9$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ \(10$/ })).toBeDefined()
  await ui.unmount()
})

test('a terminal that orders Hebrew itself gets the ordered marker as written', { options: { rtl: 'gnome' } }, async $ => {
  const ui = await $.ui.mount(mount('1. אחד\n2. שניים'))
  expect(await ui.find({ type: 'Text', text: /\.1/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /1\./ })).toBeDefined()
  await ui.unmount()
})

test('an English list keeps the left bullet', { options: { rtl: 'warp' } }, async $ => {
  const ui = await $.ui.mount(mount('- hello\n- world'))
  expect((await ui.findAll({ type: 'Text', text: /^• $/ })).length).toBe(2)
  await ui.unmount()
})

test('table cells are reordered one by one and English cells are untouched', { options: { rtl: 'warp' } }, async $ => {
  const ui = await $.ui.mount(mount('| שם | a |\n|---|---|\n| שלום | b |'))
  expect(await ui.find({ type: 'Text', text: /^םש$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^םולש$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^b$/ })).toBeDefined()
  await ui.unmount()
})

test('a Hebrew table is mirrored and right aligned, with the first column on the right', { options: { rtl: 'warp' } }, async $ => {
  const ui = await $.ui.mount(mount('| לוחם | סרט |\n|---|---|\n| מנטיס | פנדה |'))
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts.indexOf('טרס') < texts.indexOf('םחול')).toBe(true)
  expect((await ui.findAll({ type: 'Box' })).some(b => b.props.alignSelf === 'flex-end')).toBe(true)
  await ui.unmount()
})

test('an English table with one Hebrew cell keeps its column order and side', { options: { rtl: 'warp' } }, async $ => {
  const ui = await $.ui.mount(mount('| name | tag |\n|---|---|\n| web | שלום |\n| api | db |'))
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts.indexOf('name') < texts.indexOf('tag')).toBe(true)
  expect((await ui.findAll({ type: 'Box' })).some(b => b.key !== 'reply' && b.props.alignSelf === 'flex-end')).toBe(false)
  await ui.unmount()
})

test('a code comment is reordered and the code itself is not', { options: { rtl: 'warp' } }, async $ => {
  const ui = await $.ui.mount(mount('```bash\nls -la # שלום\n```'))
  expect(await ui.find({ type: 'Text', text: /^ # םולש$/ })).toBeDefined()
  expect(await paintOf(ui, 'ls')).toBeDefined()
  await ui.unmount()
})

test('Hebrew lines in a plain text block draw in display order', { options: { rtl: 'warp' } }, async $ => {
  const ui = await $.ui.mount(mount('```text\nשלום\nהיי אורן!\nבheadline שים ex-8200\n```'))
  expect(await ui.find({ type: 'Text', text: /^םולש$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^!ןרוא ייה$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ex-8200 םיש headlineב$/ })).toBeDefined()
  await ui.unmount()
})

test('a Hebrew string in highlighted code draws in display order and the code around it does not move', { options: { rtl: 'warp' } }, async $ => {
  const ui = await $.ui.mount(mount('```python\nprint("שלום עולם")\n```'))
  expect(await ui.find({ type: 'Text', text: /^"םלוע םולש"$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^print$/ })).toBeDefined()
  await ui.unmount()
})

test('a Hebrew line wider than a plain text block wraps before it is reordered, so the first row opens the sentence', { options: { rtl: 'warp' } }, async $ => {
  const words = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שביעי', 'שמיני', 'תשיעי', 'עשירי', 'אחד', 'עשר', 'שנים', 'עשר']
  const ui = await $.ui.mount(mount(`\`\`\`text\n${words.join(' ')}\n\`\`\``, 60))
  const rows = (await ui.find({ type: 'Text', text: /ןושאר/ }))!.text.split('\n')
  expect(rows.length).toBe(2)
  expect(rows[0]!.endsWith('ןושאר')).toBe(true)
  await ui.unmount()
})

test('a Hebrew string in a bash block draws in display order and the command keeps its color', { options: { rtl: 'warp' } }, async $ => {
  const ui = await $.ui.mount(mount('```bash\necho "שלום עולם"\n```'))
  expect(await ui.find({ type: 'Text', text: /^"םלוע םולש"$/ })).toBeDefined()
  expect((await paintOf(ui, 'echo'))?.color).toBeDefined()
  await ui.unmount()
})

test('a shell line that opens with a command keeps the command first when most of its words are Hebrew', { options: { rtl: 'warp' } }, async $ => {
  const ui = await $.ui.mount(mount('```bash\necho "שלום עולם"\n```'))
  expect(await ui.find({ type: 'Text', text: /^echo "םלוע םולש"$/ })).toBeDefined()
  await ui.unmount()
})

test('a plain text block keeps Hebrew as written where the terminal orders it', { options: { rtl: 'gnome' } }, async $ => {
  const ui = await $.ui.mount(mount('```text\nשלום\n```'))
  expect(await ui.find({ type: 'Text', text: /^שלום$/ })).toBeDefined()
  await ui.unmount()
})

test('a highlighted comment is reordered too', { options: { rtl: 'warp' } }, async $ => {
  const ui = await $.ui.mount(mount('```ts\nconst x = 1 // שלום\n```'))
  expect(await ui.find({ type: 'Text', text: /^\/\/ םולש$/ })).toBeDefined()
  await ui.unmount()
})

test('quotes and alerts put their bar and box on the right', { options: { rtl: 'warp' } }, async $ => {
  const ui = await $.ui.mount(mount('> שלום\n\n> [!NOTE]\n> עולם'))
  expect(await ui.find({ type: 'Text', text: /^ │$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^םולש$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^םלוע$/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Box' })).some(b => b.props.alignSelf === 'flex-end' && b.props.borderStyle === 'round')).toBe(true)
  await ui.unmount()
})

for (const surface of ['terminal', 'desktop'] as const) test(`a Hebrew quote keeps its paragraphs and list, its bar on the right of every line on ${surface}`, { options: { rtl: 'warp' } }, async $ => {
  const ui = await $.ui.mount({ ...mount('> שלום חברים\n>\n> - אחד\n> - שניים\n>\n> להתראות'), surface })
  expect(await ui.find({ type: 'Text', text: /^םירבח םולש$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^תוארתהל$/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: /^ •$/ })).toHaveLength(2)
  const bar = await ui.find({ type: 'Text', text: /^( │\n)+ │$/ })
  expect(bar!.text.split('\n').length >= 6).toBe(true)
  const row = (await ui.findAll({ type: 'Box' })).find(b => b.props.justifyContent === 'flex-end' && b.props.alignItems === 'stretch')
  expect(row?.text.endsWith(' │')).toBe(true)
  await ui.unmount()
})

test('headings are right aligned and reordered', { options: { rtl: 'warp' } }, async $ => {
  const ui = await $.ui.mount(mount('## שלום'))
  expect(await ui.find({ type: 'Text', text: /^םולש$/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Box' })).some(b => b.props.alignSelf === 'flex-end')).toBe(true)
  await ui.unmount()
})

test('an English reply draws exactly as before', { options: { rtl: 'warp' } }, async $ => {
  const ui = await $.ui.mount(mount('# Title\n\nplain text\n\n- item\n\n> quote'))
  expect((await ui.findAll({ type: 'Box' })).some(b => b.props.alignItems === 'flex-end' || b.props.paddingRight !== undefined)).toBe(false)
  expect(await ui.find({ type: 'Text', text: /^• $/ })).toBeDefined()
  await ui.unmount()
})

test('by default Hebrew is left exactly as written', async $ => {
  const ui = await $.ui.mount(mount('שלום עולם\n\n- אחד'))
  expect(await ui.find({ type: 'Text', text: /^שלום עולם$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^• $/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Box' })).some(b => b.props.alignItems === 'flex-end' || b.props.justifyContent === 'flex-end' && b.props.paddingRight !== undefined)).toBe(false)
  await ui.unmount()
})

test('rtl off keeps Hebrew as written even in Warp', { options: { rtl: 'off' } }, async ($, on) => {
  mock.env(on, { TERM_PROGRAM: 'WarpTerminal' })
  const ui = await $.ui.mount(mount('שלום עולם'))
  expect(await ui.find({ type: 'Text', text: /^שלום עולם$/ })).toBeDefined()
  await ui.unmount()
})

test('auto reorders Hebrew in Warp', async ($, on) => {
  mock.env(on, { TERM_PROGRAM: 'WarpTerminal' })
  on('session.start', () => ({ cwd: '/tmp' }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(mount('שלום עולם'))
  expect(await ui.find({ type: 'Text', text: /^םלוע םולש$/ })).toBeDefined()
  await ui.unmount()
})

test('auto in kitty puts words in visual order and leaves each word for kitty to reverse', async ($, on) => {
  mock.env(on, { TERM: 'xterm-kitty', KITTY_WINDOW_ID: '1', TERM_PROGRAM: 'WarpTerminal' })
  on('session.start', () => ({ cwd: '/tmp' }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(mount('שלום עולם\n\n- פרוסים בשני אזורים (us-east ו-eu-west)'))
  expect(await ui.find({ type: 'Text', text: /^עולם שלום$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\(eu-west-ו us-east\) אזורים בשני פרוסים$/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Box' })).some(b => b.props.alignItems === 'flex-end')).toBe(true)
  await ui.unmount()
})

test('auto in Apple Terminal keeps the right-to-left layout and leaves the letters to its own bidi', async ($, on) => {
  mock.env(on, { TERM_PROGRAM: 'Apple_Terminal' })
  on('session.start', () => ({ cwd: '/tmp' }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(mount('שלום עולם'))
  expect(await ui.find({ type: 'Text', text: /^שלום עולם$/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Box' })).some(b => b.props.alignItems === 'flex-end')).toBe(true)
  await ui.unmount()
})

test('auto in fullscreen Apple Terminal sends lines its own bidi turns into reading order', async ($, on) => {
  mock.env(on, { TERM_PROGRAM: 'Apple_Terminal' })
  on('session.start', () => ({ cwd: '/tmp' }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...mount('שלום kubectl עולם'), viewport: { columns: 120, rows: 40, isFullscreen: true } })
  expect(await ui.find({ type: 'Text', text: /^עולם kubectl שלום$/ })).toBeDefined()
  await ui.unmount()
})

test('the inverse shape comes back as the visual line after a left-to-right bidi pass', async () => {
  for (const text of ['שלום חברים, כמו kubectl, מספרים וגם', 'פרוסים בשני אזורים (us-east ו-eu-west)', 'שרתים ו-100% פעילים']) {
    const nodes: Inline[] = [{ kind: 'text', text }]
    const visualLine = flow(nodes, 100, measure)!.lines[0]!
    const inverse = flow(nodes, 100, measure, 'inverse')!.lines[0]!
    expect(inlineText(terminalLine(inverse))).toBe(inlineText(visualLine))
  }
})

test('auto leaves an unknown terminal alone', async ($, on) => {
  mock.env(on, { TERM_PROGRAM: 'iTerm.app' })
  on('session.start', () => ({ cwd: '/tmp' }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(mount('שלום עולם'))
  expect(await ui.find({ type: 'Text', text: /^שלום עולם$/ })).toBeDefined()
  await ui.unmount()
})

test('logical mode wraps in reading order and keeps every line as written', async () => {
  const f = flow([{ kind: 'text', text: 'אחד שניים שלושה ארבעה חמישה' }], 12, measure, 'logical')
  expect(f?.base).toBe('R')
  expect(f?.lines.map(inlineText)).toEqual(['אחד שניים', 'שלושה ארבעה', 'חמישה'])
})

test('auto reorders fully in Ghostty, which has no bidi of its own', async ($, on) => {
  mock.env(on, { TERM_PROGRAM: 'ghostty', TERM: 'xterm-ghostty' })
  on('session.start', () => ({ cwd: '/tmp' }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(mount('שלום עולם'))
  expect(await ui.find({ type: 'Text', text: /^םלוע םולש$/ })).toBeDefined()
  await ui.unmount()
})

test('detection also runs when a prompt is submitted, so a reload without session start still gets it', async ($, on) => {
  mock.env(on, { TERM_PROGRAM: 'WarpTerminal' })
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })
  const ui = await $.ui.mount(mount('שלום עולם'))
  expect(await ui.find({ type: 'Text', text: /^םלוע םולש$/ })).toBeDefined()
  await ui.unmount()
})

test('the demo-rtl screen has every element and draws right to left', { options: { rtl: 'warp' } }, async $ => {
  const ui = await $.ui.mount(mountDemo(rtlShowcaseText()))
  expect(await ui.find({ type: 'Text', text: /^לאמשל ןימימ תירבע$/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Text' })).some(t => t.text.includes('הטויט'))).toBe(true)
  expect((await ui.findAll({ type: 'Box' })).filter(b => b.props.alignItems === 'flex-end').length >= 3).toBe(true)
  expect((await ui.findAll({ type: 'Box' })).some(b => b.props.width === '100%')).toBe(true)
  await ui.unmount()
})

test('the demo-rtl screen draws a diagram with a mixed Hebrew label as held art on iTerm', { options: { rtl: 'iterm' } }, async $ => {
  const ui = await $.ui.mount(mountDemo(rtlShowcaseText()))
  expect((await ui.findAll({ type: 'Text' })).some(t => t.text.includes('⠀') && t.text.includes('cache'))).toBe(true)
  await ui.unmount()
})

for (const rtl of ['iterm', 'warp'] as const)
  test(`a done task in Hebrew keeps the done look on ${rtl}`, { options: { rtl, taskStyle: 'checks' } }, async $ => {
    const ui = await $.ui.mount(mount('- [x] לסיים את הבדיקות\n- [ ] לכתוב את המדריך'))
    const texts = (await ui.findAll({ type: 'Text' })).filter(t => /[א-ת]/.test(t.text))
    expect(texts.some(t => t.text.includes('תוקידבה') || t.text.includes('הבדיקות') ? t.props.strikethrough === true && t.props.dimColor === true : false)).toBe(true)
    expect(texts.some(t => (t.text.includes('ךירדמה') || t.text.includes('המדריך')) && t.props.strikethrough === true)).toBe(false)
    await ui.unmount()
  })

test('the demo-rtl screen shows a Hebrew row that opens with English on iTerm', { options: { rtl: 'iterm' } }, async $ => {
  const marks = async (text: string) => {
    const ui = await $.ui.mount(mountDemo(text))
    const n = (await ui.findAll({ type: 'Text' })).filter(t => t.text === ROW_MARK_TEXT).length
    await ui.unmount()
    return n
  }
  const demo = rtlShowcaseText()
  const englishFirst = demo.split('\n').filter(l => /^- [A-Za-z]/.test(l))
  expect(englishFirst.length).toBe(1)
  expect(await marks(demo)).toBeGreaterThan(await marks(demo.replace(`${englishFirst[0]}\n`, '')))
})

test('links in a Hebrew paragraph are hyperlinks in the link color, or plain text where they cannot be clicked', { options: { rtl: 'warp' } }, async ($, on) => {
  claudeAt(on, '2.1.289')
  const surfaces = (await linksHttp($.ui.mount(mount('[x](http://example.com)')))) ? (['terminal', 'desktop'] as const) : (['desktop'] as const)
  for (const surface of surfaces) {
    const ui = await $.ui.mount({ ...mount('שלום [mail](mailto:someone@example.com) ו [תיעוד](https://x.dev) ו [דף](http://example.com) עולם'), surface })
    const texts = await ui.findAll({ type: 'Text' })
    const hrefs = (await ui.findAll({ type: 'Link' })).map(l => l.props.href).sort()
    expect(hrefs).toEqual(surface === 'terminal' ? ['http://example.com', 'https://x.dev'] : ['https://x.dev'])
    expect((await ui.find({ type: 'Text', text: /^דועית$/ }))?.props.color).toBe(PRESETS['catppuccin-mocha'].link)
    expect(texts.some(t => t.text.includes('someone@example.com'))).toBe(true)
    expect(texts.some(t => t.text.includes('mailto:'))).toBe(false)
    expect(texts.some(t => t.props.underline === true)).toBe(false)
    if (surface === 'desktop') expect(texts.some(t => t.text.includes('ףד (http://example.com)') || t.text.includes('(http://example.com) ףד'))).toBe(true)
    await ui.unmount()
  }
})

for (const rtl of ['warp', 'iterm'] as const) {
  test(`a Hebrew line draws a clickable named link and a file link that shows its path once, like an English line, ${rtl}`, { options: { rtl } }, async ($, on) => {
    claudeAt(on, '2.1.289')
    mock.env(on, { FORCE_HYPERLINK: '1', HOME: '/home/me' })
    if (!(await linksHttp($.ui.mount(mount('[/x](file:///x)'))))) return
    const ui = await $.ui.mount(mount('שלום [קישור להודעה](https://x.dev/archives/p1) ו [/tmp/notes.md](file:///tmp/notes.md) ו [המסמך](file:///tmp/setup.command) עולם'))
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    expect((await ui.findAll({ type: 'Link' })).map(l => String(l.props.href)).sort()).toEqual(['file:///tmp/notes.md', 'https://x.dev/archives/p1'])
    expect(texts.some(t => t.includes('(https://x.dev/archives/p1)'))).toBe(false)
    expect(texts.some(t => t.includes('(file:///tmp/notes.md)'))).toBe(false)
    expect(texts.some(t => t.includes('(file:///tmp/setup.command)'))).toBe(true)
    await ui.unmount()
  })
}

test('a file link whose label is its path reads as written when the line is reordered for the terminal', () => {
  for (const shape of ['visual', 'words', 'inverse'] as const) {
    const lines = flow([{ kind: 'text', text: 'הקובץ נמצא ב-' }, { kind: 'link', text: '/tmp/notes.md', href: 'file:///tmp/notes.md' }, { kind: 'text', text: ' ו-' }, { kind: 'link', text: '../etc/x', href: 'file:///etc/x' }, { kind: 'text', text: ' עכשיו' }], 100, measure, shape)?.lines ?? []
    expect(lines.flat().filter(n => n.kind === 'link').map(n => inlineText([n])).sort()).toEqual(['../etc/x', '/tmp/notes.md'])
  }
})

test('a link labelled with an issue number reads #181 in a Hebrew line on every terminal', () => {
  for (const [terminal, shape] of Object.entries(TERMINALS)) {
    const lines = flow([{ kind: 'text', text: 'ראה ' }, { kind: 'link', text: '#181', href: 'https://example.com/pull/181' }, { kind: 'text', text: ' עכשיו' }], 100, measure, shape)?.lines ?? []
    expect([terminal, lines.flat().filter(n => n.kind === 'link').map(n => inlineText([n])).join('')]).toEqual([terminal, '#181'])
  }
})

test('a named link keeps its target when a Hebrew line reorders', async () => {
  const lines = flow([{ kind: 'text', text: 'ראה ' }, { kind: 'link', text: 'המדריך', href: 'https://example.com/guide' }, { kind: 'text', text: ' עכשיו' }], 100, measure)?.lines ?? []
  const links = lines.flat().filter(n => n.kind === 'link')
  expect(links.map(l => l.kind === 'link' && l.href)).toEqual(['https://example.com/guide'])
})

test('/merman random keeps Hebrew reordered', { options: { theme: 'random' } }, async ($, on) => {
  mock.env(on, { TERM_PROGRAM: 'WarpTerminal' })
  on('session.start', () => ({ cwd: '/tmp' }))
  on('config.set', (_, e) => ({ value: e.value }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const reordered = async () => {
    const ui = await $.ui.mount(mount('שלום עולם'))
    const found = await ui.find({ type: 'Text', text: /^םלוע םולש$/ })
    await ui.unmount()
    return found !== undefined
  }
  expect(await reordered()).toBe(true)
  await $.command.run({ command: 'merman', args: 'random', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  expect(await reordered()).toBe(true)
})

test('kitty shaping keeps a Hebrew URL as written', async () => {
  const href = 'https://he.wikipedia.org/wiki/שלום'
  const lines = flow([{ kind: 'text', text: 'ראו ' }, { kind: 'link', text: 'מאמר', href }, { kind: 'text', text: ' עכשיו' }], 200, measure, 'words')?.lines ?? []
  expect(lines.flat().filter(n => n.kind === 'link').map(l => l.kind === 'link' && l.href)).toEqual([href])
})

test('on a terminal that does its own bidi, a Hebrew line that opens with a Latin word gets a Hebrew mark first', async () => {
  const f = flow([{ kind: 'text', text: 'kubectl נכשל על ה-cluster' }], 100, measure, 'logical')
  expect(f?.base).toBe('R')
  expect(f?.lines[0]?.[0]).toEqual(ROW_MARK)
  expect(inlineText(f!.lines[0]!)).toBe('׀ kubectl נכשל על ה-cluster')
})

test('a Hebrew line that opens with a Hebrew word gets no mark, and other shapes never do', async () => {
  expect(flow([{ kind: 'text', text: 'שלום kubectl' }], 100, measure, 'logical')?.lines[0]?.[0]).not.toEqual(ROW_MARK)
  expect(flow([{ kind: 'text', text: 'kubectl נכשל על ה-cluster' }], 100, measure, 'visual')?.lines[0]?.[0]).not.toEqual(ROW_MARK)
  expect(flow([{ kind: 'text', text: 'kubectl נכשל על ה-cluster' }], 100, measure, 'words')?.lines[0]?.[0]).not.toEqual(ROW_MARK)
})

test('an English-majority line with a Hebrew tail stays left and gets no mark', async () => {
  const f = flow([{ kind: 'text', text: 'kubectl get pods shows three pods stuck וזה מסביר' }], 100, measure, 'logical')
  expect(f?.base).toBe('L')
  expect(f?.lines[0]?.[0]).not.toEqual(ROW_MARK)
})

test('Windows Terminal leaves the order to Claude Code: inline code is held left to right by LRMs and right-to-left brackets come mirrored', async () => {
  const f = flow([{ kind: 'text', text: 'ואז ' }, { kind: 'code', text: '/reload-plugins' }, { kind: 'text', text: ' (עכשיו)' }], 100, measure, TERMINALS['windows-terminal'])
  expect(f?.base).toBe('R')
  expect(inlineText(f!.lines[0]!)).toBe('ואז \u200E/reload-plugins\u200E )עכשיו(')
})

test('Windows Terminal mirrors brackets around English inside a Hebrew row and still marks a row that opens with Latin', async () => {
  const f = flow([{ kind: 'text', text: 'kubectl נכשל (timeout) על ה-cluster' }], 100, measure, 'engine')
  expect(f?.lines[0]?.[0]).toEqual(ROW_MARK)
  expect(inlineText(f!.lines[0]!)).toBe('׀ kubectl נכשל )timeout( על ה-cluster')
})

test('Windows Terminal keeps a number next to the Hebrew word before it in a mostly English line, with a braille blank between them', async () => {
  const sent = (text: string) => inlineText(flow([{ kind: 'text', text }], 100, measure, 'engine')!.lines[0]!)
  expect(sent('ok אחרי 3m')).toBe('ok אחרי⠀3m')
  expect(sent('ok אחרי 3.5m')).toBe('ok אחרי⠀3.5m')
  expect(sent('done אחרי 3')).toBe('done אחרי⠀3')
  expect(sent('ok now אחרי 3 ימים')).toBe('ok now אחרי 3 ימים')
  expect(sent('הרצתי 3 בדיקות של kubectl')).not.toContain('⠀')
})

test('Windows Terminal mirrors brackets for the left-to-right base its opening LRM sets when a line starts with a symbol-only code span', async () => {
  const f = flow([{ kind: 'code', text: '(1)' }, { kind: 'text', text: ' הוא הצעד (הראשון)' }], 100, measure, 'engine')
  expect(inlineText(f!.lines[0]!)).toBe('\u200E(1)\u200E הוא הצעד )הראשון)')
})

test('Windows Terminal diagram labels that read right to left are sent so Claude Code shows them in reading order, with blanks between labels held', async () => {
  const sent = (row: string) => holdEngine([...row]).cells.join('')
  expect(sent('│ עם engine │')).toBe('│‎ engine עם‎ │')
  expect(sent('│ יש עברית? │')).toBe('│‎ ?יש עברית‎ │')
  expect(sent('│ התחלה │──►│ סוף │')).toBe('│‎ התחלה‎ │──►│‎ סוף‎ │')
  expect(sent('│ ArgoCD sync │')).toBe('│ ArgoCD sync │')
})

test('Windows Terminal keeps the arrow of a diagram edge in place when its label is Hebrew', () => {
  const sent = (row: string) => holdEngine([...row]).cells.join('')
  expect(sent('├─כן─►')).toBe('├─כן─►')
  expect(sent('◄──עם engine──┤')).toBe('◄──engine עם──┤')
  expect(sent('│ גרסה+beta │')).toBe('│‎ beta+גרסה‎ │')
})

test('a symbol inside a Hebrew diagram label stays part of the label', () => {
  const drawn = (row: string) => holdVisual([...row]).cells.join('')
  expect(drawn('│ גרסה+beta │')).toBe('│ beta+הסרג │')
  expect(drawn('├─כן─►')).toBe('├─ןכ─►')
})

test('an ASCII diagram edge keeps its arrow in place when its label is Hebrew', () => {
  expect(holdVisual([...'| start |כן->| end |']).cells.join('')).toBe('| start |ןכ->| end |')
  expect(holdEngine([...'|כן->|']).cells.join('')).toBe('|כן->|')
  expect(holdVisual([...'│ בית-ספר │']).cells.join('')).toBe('│ רפס-תיב │')
})

test('a held diagram row says where each drawn cell came from, so colors and marks land on the same letters after a label is reordered', () => {
  const cases: [string[], typeof holdRow, string[]][] = [[[...'│ עם engine │'], holdEngine, ['‎', ' ']], [[...'│ האם יש token │'], holdRow, ['⠀']]]
  for (const [row, hold, blanks] of cases) {
    const held = hold([...row])
    expect(held.cells.join('')).not.toBe(row.join(''))
    expect(held.cells.length).toBe(held.from.length)
    held.cells.forEach((ch, p) => expect(blanks.includes(ch) ? row[held.from[p]!] : ch).toBe(row[held.from[p]!]))
  }
})

test('a wrapped Hebrew paragraph marks only the rows that open with Latin, and every row still fits', async () => {
  const f = flow([{ kind: 'text', text: 'הבדיקה נפלה בגלל timeout ארוך מאוד pytest נתקע kubeconfig חסר' }], 24, measure, 'logical')
  const rows = f!.lines.map(inlineText)
  expect(rows.length >= 2).toBe(true)
  for (const row of rows) expect(measure(row) <= 24).toBe(true)
  for (const row of rows) expect(/^׀ [A-Za-z]/.test(row) || /^[^A-Za-z]*[֐-׿]/.test(row)).toBe(true)
  expect(rows.some(row => row.startsWith('׀ '))).toBe(true)
})

test('iTerm mirrors a right-to-left row itself, so a Hebrew paragraph that opens with Latin gets the mark and no right alignment', { options: { rtl: 'iterm' } }, async $ => {
  const ui = await $.ui.mount(mount('kubectl נכשל על ה-cluster\n\n- GC-174176 נכשל שוב'))
  expect(await ui.find({ type: 'Text', text: /^׀ $/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Box' })).some(b => b.props.alignItems === 'flex-end')).toBe(false)
  expect(await ui.find({ type: 'Text', text: /^• $/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ •$/ })).toBeUndefined()
  await ui.unmount()
})

const MOSTLY_HEBREW_LIST = '1. הרצה של `/team-code-review` על השינוי\n2. בדיקה שנייה עם `/codex:review` אחרי התיקונים\n3. Codex adversarial review\n4. סיכום הממצאים ופתיחת PR'
const MOSTLY_ENGLISH_LIST = '- run the unit tests\n- push the branch\n- בדיקה ידנית של המסך\n- open the PR'

test('a mostly Hebrew list draws its English item right to left too, so the list stays one list', { options: { rtl: 'warp' } }, async $ => {
  const ui = await $.ui.mount(mount(MOSTLY_HEBREW_LIST))
  expect((await ui.findAll({ type: 'Box' })).filter(b => b.props.justifyContent === 'flex-end' && b.props.paddingRight !== undefined).length).toBe(4)
  await ui.unmount()
})

test('iTerm marks the English item of a mostly Hebrew list, so the terminal mirrors it with the rest', { options: { rtl: 'iterm' } }, async $ => {
  const ui = await $.ui.mount(mount(MOSTLY_HEBREW_LIST))
  expect((await ui.findAll({ type: 'Text' })).filter(t => t.text === ROW_MARK_TEXT).length).toBe(1)
  await ui.unmount()
})

test('a mostly English list draws its Hebrew item left to right with the rest', { options: { rtl: 'warp' } }, async $ => {
  const ui = await $.ui.mount(mount(MOSTLY_ENGLISH_LIST))
  expect((await ui.findAll({ type: 'Box' })).some(b => b.props.justifyContent === 'flex-end' && b.props.paddingRight !== undefined)).toBe(false)
  await ui.unmount()
})

test('iTerm holds the Hebrew item of a mostly English list left to right with a braille blank after the bullet', { options: { rtl: 'iterm' } }, async $ => {
  const ui = await $.ui.mount(mount(MOSTLY_ENGLISH_LIST))
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts.filter(t => t === '• ').length).toBe(3)
  expect(texts.filter(t => t === '•').length).toBe(1)
  expect(texts.some(t => t === '⠀בדיקה ידנית של המסך')).toBe(true)
  await ui.unmount()
})

test('a long Hebrew item in a mostly English list still wraps in reading order', { options: { rtl: 'warp' } }, async $ => {
  const ui = await $.ui.mount(mount('- run the unit tests\n- push the branch\n- בדיקה ידנית של המסך הראשי ושל כל החלונות שנפתחים ממנו\n- open the PR', 30))
  const rows = (await ui.findAll({ type: 'Text' })).map(t => t.text).filter(t => /[א-ת]/.test(t) && !t.includes('\n'))
  expect(rows.length >= 2).toBe(true)
  for (const row of rows) expect(measure(row) <= 28).toBe(true)
  expect(rows[0]!.endsWith('הקידב')).toBe(true)
  await ui.unmount()
})

for (const rtl of ['warp', 'iterm'] as const)
  test(`an English item with a named link in a mostly Hebrew list keeps its link label and no raw address on ${rtl}`, { options: { rtl } }, async $ => {
    const ui = await $.ui.mount(mount('1. הרצה של הבדיקות\n2. בדיקה שנייה של התוצאות\n3. see [the docs](https://example.com/docs)'))
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    expect(texts.some(t => t.includes('(https://example.com/docs)'))).toBe(false)
    expect(texts.some(t => t.includes('the docs'))).toBe(true)
    await ui.unmount()
  })

for (const rtl of ['warp', 'iterm'] as const)
  test(`an English item with a footnote in a mostly Hebrew list keeps its mark clickable on ${rtl}`, { options: { rtl } }, async ($, on) => {
    claudeAt(on, '2.1.295')
    if (!(await linksHttp($.ui.mount(mount('Fast[^a].\n\n[^a]: Measured twice.'))))) return
    const ui = await $.ui.mount(mount('1. הרצה של הבדיקות\n2. בדיקה שנייה של התוצאות\n3. see the note[^1]\n\n[^1]: the note'))
    expect((await ui.findAll({ type: 'Button' })).filter(b => b.props.plain && b.props.label === '¹').length).toBe(1)
    await ui.unmount()
  })

test('Apple Terminal keeps the right alignment and gets the mark too', { options: { rtl: 'apple-terminal' } }, async $ => {
  const ui = await $.ui.mount(mount('kubectl נכשל על ה-cluster'))
  expect(await ui.find({ type: 'Text', text: /^׀ $/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Box' })).some(b => b.props.alignItems === 'flex-end')).toBe(true)
  await ui.unmount()
})

test('iTerm draws a Hebrew prompt bubble across the whole width, so the terminal mirrors it in place', { options: { rtl: 'iterm' } }, async $ => {
  const ui = await $.ui.mount({ plugin: 'merman', component: 'UserMessage' as const, props: { text: 'עשיתי reload, תראה את השורות', origin: { kind: 'composer' } as never, isExpanded: true }, viewport: { columns: 120, rows: 40 }, surface: 'terminal' as const })
  expect((await ui.findAll({ type: 'Box' })).some(b => b.props.borderStyle === 'round' && b.props.width === '100%')).toBe(true)
  expect((await ui.findAll({ type: 'Box' })).some(b => b.props.alignSelf === 'flex-end' || b.props.alignItems === 'flex-end')).toBe(false)
  await ui.unmount()
})

test('under mirror any Hebrew makes the line right-to-left, so an English-majority line gets the mark too', async () => {
  const f = flow([{ kind: 'text', text: 'kubectl get pods shows three pods stuck וזה מסביר' }], 100, measure, 'mirror')
  expect(f?.base).toBe('R')
  expect(f?.lines[0]?.[0]).toEqual(ROW_MARK)
})

const mirrorLine = (nodes: Inline[]) => flow(nodes, 100, measure, 'mirror')?.lines[0] ?? []
const texts = (line: Inline[]) => line.map(n => inlineText([n]))

test('iTerm gets the neutral edges of a code span or path between Hebrew words swapped and turned, so its own bidi draws them where they were written', () => {
  const line = mirrorLine([{ kind: 'text', text: 'תפתח את ' }, { kind: 'path', text: '~/.aws/credentials', href: 'file:///Users/me/.aws/credentials' }, { kind: 'text', text: ' ותוסיף ' }, { kind: 'code', text: '--profile nightly-rw' }, { kind: 'text', text: ' ואת ' }, { kind: 'code', text: '/team-code-review' }])
  expect(texts(line)).toEqual(['תפתח את ', 'aws/credentials./~', ' ותוסיף ', 'profile nightly-rw--', ' ואת ', 'team-code-review/'])
  expect(line[1]).toEqual({ kind: 'path', text: 'aws/credentials./~', href: 'file:///Users/me/.aws/credentials' })
})

test('every terminal leaves the period that ends a sentence after a path outside the path', () => {
  const nodes: Inline[] = [{ kind: 'text', text: 'סיימתי את ה-' }, { kind: 'path', text: '/simplify.' }, { kind: 'text', text: ' שלושה שינויים' }]
  for (const shape of Object.values(TERMINALS)) expect(flow(nodes, 100, measure, shape)?.lines[0]?.filter(n => n.kind === 'path').map(n => inlineText([n]).replace(/\u200E/g, ''))).toEqual([shape === 'mirror' ? 'simplify/' : '/simplify'])
  expect(texts(mirrorLine(nodes))).toEqual(['סיימתי את ה-', 'simplify/', '. שלושה שינויים'])
  expect(texts(mirrorLine([{ kind: 'text', text: 'תמחק את ' }, { kind: 'path', text: '/tmp/.' }, { kind: 'text', text: ' עכשיו' }]))[1]).toBe('./tmp/')
  expect(texts(mirrorLine([{ kind: 'text', text: 'תוסיף את ' }, { kind: 'code', text: '--flag.' }, { kind: 'text', text: ' לפקודה' }]))[1]).toBe('.flag--')
})

test('iTerm gets the neutral edges of a link whose label is a path swapped too, so the slash stays at the start of the path', () => {
  const line = mirrorLine([{ kind: 'text', text: 'הקובץ נמצא ב-' }, { kind: 'link', text: '/tmp/notes.md', href: 'file:///tmp/notes.md' }, { kind: 'text', text: ' ומוכן' }, { kind: 'text', text: ' וגם ' }, { kind: 'link', text: 'ההודעה', href: 'https://example.com' }])
  expect(texts(line)).toEqual(['הקובץ נמצא ב-', 'tmp/notes.md/', ' ומוכן וגם ', 'ההודעה'])
  expect(line[1]).toEqual({ kind: 'link', text: 'tmp/notes.md/', href: 'file:///tmp/notes.md' })

  const signs = mirrorLine([{ kind: 'text', text: 'ראה ' }, { kind: 'link', text: '#181', href: 'https://example.com/pull/181' }, { kind: 'text', text: ' ועוד ' }, { kind: 'link', text: '100%', href: 'https://example.com/a' }, { kind: 'text', text: ' ו-' }, { kind: 'code', text: '$5' }, { kind: 'text', text: ' עכשיו' }])
  expect(texts(signs)).toEqual(['ראה ', '#181', ' ועוד ', '100%', ' ו-', '$5', ' עכשיו'])
})

test('iTerm keeps a code span as written when English sits beside it, since there its edges already read left to right', () => {
  const line = mirrorLine([{ kind: 'text', text: 'run ' }, { kind: 'code', text: '--all' }, { kind: 'text', text: ' now ואז נבדוק' }])
  expect(texts(line).join('')).toBe('׀ run --all now ואז נבדוק')
})

test('iTerm turns a code span with no letters whole, so an arrow between Hebrew words still points the way it was written', () => {
  expect(texts(mirrorLine([{ kind: 'text', text: 'שלב ' }, { kind: 'code', text: '->' }, { kind: 'text', text: ' שלב' }]))).toEqual(['שלב ', '<-', ' שלב'])
})

test('iTerm draws a Hebrew table in reading order with a paseq wall on every row, frame included', { options: { rtl: 'iterm' } }, async $ => {
  const ui = await $.ui.mount(mount('| רכיב | Status | הערה |\n|---|---|---|\n| הבדיקה | passed | רצה אתמול |'))
  const marks = (await ui.findAll({ type: 'Text' })).filter(t => t.text.startsWith('׀'))
  expect(marks.length >= 5).toBe(true)
  expect(await ui.find({ type: 'Text', text: /^׀[─┬]+׀$/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Box' })).some(b => b.props.alignSelf === 'flex-end' && b.props.key !== 'reply')).toBe(false)
  await ui.unmount()
})

const MIXED_TABLE = '| לילה | תוצאה | deploy |\n|---|---|---|\n| 13/10 | ✓ 8/8 | 86m |\n| 15/10 | ✗ נכשל | - |\n| ok אחרי 3m | ✓ | 51m |'

test('iTerm holds a mostly English table left to right with a braille blank after every wall, so a row that opens in Hebrew keeps its column order', { options: { rtl: 'iterm', tableStyle: 'box' } }, async $ => {
  const ui = await $.ui.mount(mount(MIXED_TABLE))
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts.filter(t => t === '│⠀').length).toBe(4)
  expect(texts.filter(t => t === ' │⠀').length).toBe(8)
  expect(texts.some(t => t.includes(WALL))).toBe(false)
  await ui.unmount()
})

test('iTerm keeps a number next to the Hebrew word before it in a mostly English held table cell, with a braille blank between them', { options: { rtl: 'iterm', tableStyle: 'box' } }, async $ => {
  const ui = await $.ui.mount(mount('| night | result | deploy |\n|---|---|---|\n| ok אחרי 3m | ok אחרי 3.5m | done אחרי 3 |\n| ok now אחרי 3 ימים | 86m | 51m |'))
  for (const text of [/^ok אחרי⠀3m$/, /^ok אחרי⠀3.5m$/, /^done אחרי⠀3$/, /^ok now אחרי 3 ימים$/]) expect(await ui.find({ type: 'Text', text })).toBeDefined()
  await ui.unmount()
})

test('iTerm keeps inline code and a path in written order inside a mostly Hebrew cell of a held table', { options: { rtl: 'iterm', tableStyle: 'box' } }, async $ => {
  const ui = await $.ui.mount(mount('| night | result | deploy |\n|---|---|---|\n| run `--all` now | תריץ את `--all` | ok |\n| see `~/.aws/credentials` file | הקובץ `~/.aws/credentials` חסר | ok |'))
  for (const text of [/^--all תריץ את$/, /^חסר ~\/\.aws\/credentials הקובץ$/]) expect(await ui.find({ type: 'Text', text })).toBeDefined()
  await ui.unmount()
})

test('iTerm draws a mostly Hebrew cell of a held table in the order the terminal flips back', { options: { rtl: 'iterm', tableStyle: 'box' } }, async $ => {
  const ui = await $.ui.mount(mount('| night | result | deploy |\n|---|---|---|\n| ok | ✗ אחרי 14m | 86m |'))
  expect(await ui.find({ type: 'Text', text: /^14m אחרי ✗$/ })).toBeDefined()
  await ui.unmount()
})

test('iTerm holds every row of a mostly English rules table, the rules included, so the columns stay lined up', { options: { rtl: 'iterm', tableStyle: 'rules' } }, async $ => {
  const ui = await $.ui.mount(mount(MIXED_TABLE))
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts.filter(t => t === '⠀').length).toBe(7)
  expect(texts.filter(t => t === '⠀ ').length).toBe(14)
  await ui.unmount()
})

for (const tableStyle of ['box', 'rules'] as const) {
  test(`iTerm leaves a ${tableStyle} table without Hebrew as it was`, { options: { rtl: 'iterm', tableStyle } }, async $ => {
    const ui = await $.ui.mount(mount('| night | result |\n|---|---|\n| 13/10 | ok 8/8 |'))
    expect((await ui.findAll({ type: 'Text' })).some(t => t.text.includes('⠀'))).toBe(false)
    await ui.unmount()
  })
}

test('iTerm adds no row mark inside a quote, an alert or a table cell, where a paseq wall already leads the row', { options: { rtl: 'iterm', tableStyle: 'box' } }, async $ => {
  const rule = PRESETS['catppuccin-mocha'].rule
  for (const text of ['> kubectl החזיר שגיאה', '> [!NOTE]\n> kubectl החזיר שגיאה', '| כלי | הערה |\n|---|---|\n| kubectl בודק | רץ אתמול |']) {
    const ui = await $.ui.mount(mount(text))
    expect((await ui.findAll({ type: 'Text' })).filter(t => t.text === ROW_MARK_TEXT && t.props.color === rule)).toEqual([])
    await ui.unmount()
  }
})

test('a diagram label that opens in Hebrew and holds English reads right to left once a terminal reorders the held row', () => {
  const held = holdRow([...'│ האם יש token? │']).cells.join('')
  expect(held.startsWith('│⠀') && held.endsWith('⠀│')).toBe(true)
  expect(inlineText(terminalLine([{ kind: 'text', text: held }]))).toBe(`│⠀${visual('האם יש token?')}⠀│`)
  expect(holdRow([...'│ ArgoCD sync │']).cells.join('')).toBe('│ ArgoCD sync │')
})

test('a held diagram label that is mostly English puts a braille blank between a Hebrew word and the number after it', () => {
  expect(holdRow([...'│ ok אחרי 3m │']).cells.join('')).toBe('│⠀ok אחרי⠀3m⠀│')
  expect(holdRow([...'│ ok بعد ٣m │']).cells.join('')).toBe('│⠀ok بعد⠀٣m⠀│')
  expect(holdRow([...'│ ok بعد ۳m │']).cells.join('')).toBe('│⠀ok بعد⠀۳m⠀│')
})

const DIAGRAMS = ['```mermaid\nflowchart LR\n  A[בקשה נכנסת] --> B[ArgoCD sync]\n```', '```figure\n│ שלב א │──►│ שלב ב │\n```']

const hebrewRows = async (ui: { findAll: (q: { type: 'Text' }) => Promise<{ text: string }[]> }) => (await ui.findAll({ type: 'Text' })).map(t => t.text).filter(t => /[א-ת]/.test(t))

test('iTerm keeps a diagram row with Hebrew left to right: blanks around labels become braille blanks, spaces inside a Hebrew label stay', { options: { rtl: 'iterm' } }, async $ => {
  for (const source of DIAGRAMS) {
    const ui = await $.ui.mount(mount(source))
    const rows = await hebrewRows(ui)
    expect(rows.some(t => t.includes('⠀'))).toBe(true)
    expect(rows.every(t => !/^ | $| [─│├┤►]|[─│├┤►] /.test(t))).toBe(true)
    expect(rows.some(t => /[א-ת] [א-ת]/.test(t))).toBe(true)
    await ui.unmount()
  }
})

test('iTerm opens every held diagram row with a braille blank, so an edge label on a diamond edge does not turn its row right to left', { options: { rtl: 'iterm' } }, async $ => {
  for (const source of ['```mermaid\nflowchart TD\n  B{האם יש cache?} -->|כן| C[מחזירים]\n  B -->|לא| D[פונים]\n```', '```figure\n◇──כן──◇\n```']) {
    const ui = await $.ui.mount(mount(source))
    const rows = await hebrewRows(ui)
    expect(rows.filter(t => /◇─+כן─+◇/.test(t)).some(t => t.startsWith('⠀⠀'))).toBe(true)
    await ui.unmount()
  }
})

test('iTerm holds a figure row as one line, so a colored word inside a mixed label keeps the label in reading order', { options: { rtl: 'iterm' } }, async $ => {
  const plain = await $.ui.mount(mount('```figure\n│ שלב build │\n```'))
  const [want] = await hebrewRows(plain)
  await plain.unmount()
  const ui = await $.ui.mount(mount('```figure\n│ {strong:שלב} build │\n```'))
  const [got] = await hebrewRows(ui)
  expect(got).toBe(want)
  expect((await ui.findAll({ type: 'Text' })).some(t => t.text === 'שלב' && t.props.bold === true)).toBe(true)
  await ui.unmount()
})

for (const [rtl, label, note] of [
  ['iterm', '⠀Saved Tabs-נעלם מ⠀', '(Recent Sessions-נמצא ב)'],
  ['warp', ' Saved Tabs-מ םלענ ', '(Recent Sessions-ב אצמנ)'],
] as const)
  test(`a figure label that mixes Hebrew with two English words stays one label on ${rtl}, so the English words and the brackets stay together`, { options: { rtl } }, async $ => {
    const ui = await $.ui.mount(mount('```figure\nרגיל  ──► נעלם מ-Saved Tabs ──► סוף\n          (נמצא ב-Recent Sessions)\n```'))
    const rows = (await hebrewRows(ui)).join('\n')
    expect(rows).toContain(label)
    expect(rows).toContain(note)
    await ui.unmount()
  })

test('a single space keeps English words in a Hebrew figure label only between letters, on either side of the Hebrew, so boxes, members and connectors still split as before', () => {
  for (const [row, held] of [
    ['[בנייה] [בדיקה] [Deploy]', '[בנייה]⠀[בדיקה]⠀[Deploy]'],
    ['│ +שם: String  │', '│⠀+שם:⠀String⠀⠀│'],
    ['עברית -- English words', 'עברית --⠀English⠀words'],
    ['אבג──►Saved Tabs', 'Saved►──אבג⠀Tabs'],
    ['│ שלב │──►│ ArgoCD sync │', '│⠀שלב⠀│──►│⠀ArgoCD⠀sync⠀│'],
    ['A B──►C שלב', 'A⠀B──►C שלב'],
    ['Saved Tabs-נעלם  ──►  x', 'Saved Tabs-נעלם⠀⠀──►⠀⠀x'],
    ['שלב 1 2 3 4', 'שלב 1⠀2⠀3⠀4'],
    ['בִּ Foo', 'Foo בִּ'],
  ] as const)
    expect(holdRow([...row]).cells.join('')).toBe(held)
})

test('Windows Terminal keeps English words in a Hebrew figure label together too', () => {
  expect(holdEngine([...'רגיל  ──► נעלם מ-Saved Tabs ──► סוף']).cells.join('')).toContain('\u200e Saved Tabs-נעלם מ\u200e ')
  expect(holdEngine([...'(נמצא ב-Recent Sessions)']).cells.join('')).toBe('(Recent Sessions-נמצא ב)')
})

test('terminals that do not mirror rows draw diagrams with plain spaces', { options: { rtl: 'warp' } }, async $ => {
  for (const source of DIAGRAMS) {
    const ui = await $.ui.mount(mount(source))
    const rows = await hebrewRows(ui)
    expect(rows.length > 0).toBe(true)
    expect(rows.some(t => t.includes('⠀'))).toBe(false)
    await ui.unmount()
  }
})

test('iTerm draws a Hebrew banner heading so every row of it mirrors: paseq walls for the title box, an underline for the section title', { options: { rtl: 'iterm', headingStyle: 'banner' } }, async $ => {
  const ui = await $.ui.mount(mount('# עברית מימין לשמאל\n\n## רשימות'))
  const texts = await ui.findAll({ type: 'Text' })
  expect(texts.filter(t => /^׀━+׀$/.test(t.text)).length).toBe(2)
  expect(texts.some(t => /^━+$/.test(t.text))).toBe(false)
  expect((await ui.findAll({ type: 'Box' })).some(b => b.props.borderStyle === 'bold')).toBe(false)
  expect(texts.some(t => /רשימות|תומישר/.test(t.text) && t.props.underline === true)).toBe(true)
  await ui.unmount()
})

test('iTerm draws the quote bar as a paseq, so the row mirrors without a mark of its own', { options: { rtl: 'iterm' } }, async $ => {
  const ui = await $.ui.mount(mount('> kubectl החזיר שגיאה'))
  expect(await ui.find({ type: 'Text', text: /^׀ $/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^│ $/ })).toBeUndefined()
  await ui.unmount()
})

test('iTerm draws a Hebrew alert as a paseq frame so every row mirrors alike', { options: { rtl: 'iterm' } }, async $ => {
  const ui = await $.ui.mount(mount('> [!NOTE]\n> הריצה הבאה מתחילה בעוד שעה'))
  expect(await ui.find({ type: 'Text', text: /^׀─+׀$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Note$/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Box' })).some(b => b.props.borderStyle === 'round')).toBe(false)
  await ui.unmount()
})

test('iTerm marks the engine notice line when it holds Hebrew and opens with English', { options: { rtl: 'iterm' } }, async ($, on) => {
  let drawn = ''
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    drawn = e.component === 'InfoNotice' ? String(e.props.text) : ''
    return <Text>{drawn}</Text>
  })
  const ui = await $.ui.mount({ plugin: 'merman', component: 'InfoNotice' as const, props: { text: 'recap: תיקנו את ה-RTL', command: '/config' }, viewport: { columns: 120, rows: 40 }, surface: 'terminal' as const })
  expect(drawn).toBe('׀ recap: תיקנו את ה-RTL')
  await ui.unmount()
  const hebrewFirst = await $.ui.mount({ plugin: 'merman', component: 'InfoNotice' as const, props: { text: 'תיקנו את ה-RTL', command: '/config' }, viewport: { columns: 120, rows: 40 }, surface: 'terminal' as const })
  expect(drawn).toBe('תיקנו את ה-RTL')
  await hebrewFirst.unmount()
})

test('a terminal without bidi gets each Hebrew diagram label in display order, in place', () => {
  const drawn = (row: string) => holdVisual([...row]).cells.join('')
  expect(drawn('│ בקשה חדשה │──►│ האם יש cache? │')).toBe('│ השדח השקב │──►│ ?cache שי םאה │')
  expect(drawn('├─כן─►')).toBe('├─ןכ─►')
  expect(drawn('│ plain │')).toBe('│ plain │')
})

const toolCard = (tool: string, output: unknown) => ({ plugin: 'merman', surface: 'terminal' as const, component: 'ToolResult' as const, props: { tool_use_id: `t-${tool}`, tool, output, isErrored: false } })

for (const rtl of ['iterm', 'warp'] as const)
  test(`a code row with only Hebrew in it stays in its column on ${rtl}: the gutter ends in a braille blank on iTerm, so the terminal does not mirror the row`, { options: { rtl } }, async ($, on) => {
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine</Text>
    })
    claudeAt(on, '2.1.295')
    const blank = rtl === 'iterm' ? '⠀' : ' '
    const edit = await $.ui.mount(toolCard('Edit', { filePath: '/tmp/notes.md', structuredPatch: [{ oldStart: 4, newStart: 4, lines: [' keep this', '-שלום עולם', '+שלום עולם חדש'] }] }))
    expect(await edit.find({ type: 'Box', text: new RegExp(`^5${blank}- שלום עולם$`) })).toBeDefined()
    expect(await edit.find({ type: 'Box', text: new RegExp(`^5${blank}\\+ שלום עולם חדש$`) })).toBeDefined()
    expect(await edit.find({ type: 'Box', text: /^4 {3}keep this$/ })).toBeDefined()
    await edit.unmount()
    const write = await $.ui.mount(toolCard('Write', { type: 'create', filePath: '/tmp/notes.md', content: 'keep this\nשלום עולם\n', structuredPatch: [], originalFile: null }))
    const written = (await write.findAll({ type: 'Text' })).map(t => t.text)
    expect(written).toContain(`2 ${blank}`)
    expect(written).toContain('1  ')
    await write.unmount()
    const fence = await $.ui.mount(mount('```ts\nkeep this\nשלום עולם\n```'))
    if (rtl === 'iterm') expect(await fence.find({ type: 'Box', text: /^ ⠀שלום עולם$/ })).toBeDefined()
    expect((await fence.findAll({ type: 'Text' })).some(t => t.text.includes('⠀'))).toBe(rtl === 'iterm')
    await fence.unmount()
  })

test('on iTerm a long Hebrew line in a code block wraps into rows that each open with a braille blank, so no continuation is mirrored away from the gutter', { options: { rtl: 'iterm' } }, async $ => {
  const words = 'שורה ארוכה מאוד בעברית שעוברת את רוחב המסך הצר ולכן נשברת לכמה שורות'
  const ui = await $.ui.mount(mount(`\`\`\`ts\nconst a = 1\n${words}\n\`\`\``, 40))
  const rows = (await ui.findAll({ type: 'Box' })).map(b => b.text).filter(t => /^ ⠀[א-ת]/.test(t))
  expect(rows.length).toBeGreaterThan(1)
  expect(rows.map(r => r.slice(2).trim()).join(' ')).toBe(words)
  expect(rows.every(r => r.length <= 40)).toBe(true)
  await ui.unmount()
})

test('on iTerm a shell block whose Hebrew comes after the command keeps its shell colors and gets no braille blank, since the row already opens with English', { options: { rtl: 'iterm' } }, async $ => {
  const ui = await $.ui.mount(mount('```bash\nls -la # רשימת הקבצים\n```'))
  expect((await ui.findAll({ type: 'Text' })).some(t => t.text.includes('⠀'))).toBe(false)
  expect((await paintOf(ui, 'ls'))?.color).toBeDefined()
  await ui.unmount()
})

test('on iTerm a shell block with a line that opens with Hebrew keeps the shell colors the block has without Hebrew', { options: { rtl: 'iterm' } }, async $ => {
  const colors = async (source: string, texts: string[]) => {
    const ui = await $.ui.mount(mount(source))
    const found = await Promise.all(texts.map(async text => (await paintsOf(ui, text)).map(p => p.color)))
    await ui.unmount()
    return found
  }
  const words = ['npm', '--save', '"x"']
  const plain = (await colors('```bash\n# note\nnpm install --save "x"\n```', ['# note', ...words])).map(c => c[0])
  const held = await colors('```bash\n# התקנת החבילות\nnpm install --save "x"\n```', ['# התקנת החבילות', ...words, ' ⠀'])
  expect(new Set(plain).size).toBe(4)
  plain.forEach((color, i) => expect(held[i]).toContain(color))
  expect(held[4]!.length).toBeGreaterThan(0)
})

const shellCall = (id: string, command: string) => ({ tool_use_id: id, tool: 'Bash', input: { command }, isRunning: false, isErrored: false, isInterrupted: false })

for (const rtl of ['iterm', 'warp'] as const)
  test(`a shell output line with only Hebrew in it stays after its gutter on ${rtl}: the gutter ends in a braille blank on iTerm`, { options: { rtl, toolOutput: 'quiet' } }, async ($, on) => {
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine</Text>
    })
    const blank = rtl === 'iterm' ? '⠀' : ' '
    const quiet = await $.ui.mount({ ...toolCard('Bash', { stdout: 'שלום עולם\nend\n', stderr: '' }), props: { tool_use_id: `q-${rtl}`, tool: 'Bash', output: { stdout: 'שלום עולם\nend\n', stderr: '' }, isErrored: false } })
    expect(await quiet.find({ type: 'Box', text: new RegExp(`^  ⎿ ${blank}שלום עולם$`) })).toBeDefined()
    expect(await quiet.find({ type: 'Box', text: /^ {5}end$/ })).toBeDefined()
    await quiet.unmount()
    const group = await $.ui.mount({ plugin: 'merman', surface: 'terminal', component: 'ToolGroup', props: { calls: [shellCall(`x-${rtl}`, 'ls')], isActive: false, isExpanded: true } })
    await group.unmount()
    const expanded = await $.ui.mount({ plugin: 'merman', surface: 'terminal', component: 'ToolUse', props: { ...shellCall(`x-${rtl}`, "cat <<'EOF'\nשלום\nEOF"), output: { stdout: 'שלום עולם\nend', stderr: '' } } })
    expect(await expanded.find({ type: 'Box', text: new RegExp(`^${blank}שלום עולם$`) })).toBeDefined()
    expect(await expanded.find({ type: 'Box', text: /^ end$/ })).toBeDefined()
    if (rtl === 'iterm') expect(await expanded.find({ type: 'Box', text: /^ ⠀שלום$/ })).toBeDefined()
    await expanded.unmount()
  })

const expandShell = async ($: Parameters<TestBody>[0], id: string, command: string, stdout: string) => {
  const group = await $.ui.mount({ plugin: 'merman', surface: 'terminal', component: 'ToolGroup', props: { calls: [shellCall(id, 'ls')], isActive: false, isExpanded: true } })
  await group.unmount()
  return $.ui.mount({ plugin: 'merman', surface: 'terminal', component: 'ToolUse', props: { ...shellCall(id, command), output: { stdout, stderr: '' } }, viewport: { columns: 30, rows: 40 } })
}

const longHebrew = Array(6).fill('שלום עולם').join(' ')

test('on iTerm a long Hebrew command and output line in an expanded shell call wrap into rows that fit the box and each open with a braille blank', { options: { rtl: 'iterm' } }, async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const expanded = await expandShell($, 'wi', `echo '${longHebrew}'`, `${longHebrew}\nשם\tגיל`)
  const command = (await expanded.findAll({ type: 'Box', text: /^(●Bash\(| ⠀)/ })).filter(r => r.props.flexDirection === 'row' && !/[│╭╰]/.test(r.text)).map(r => r.text)
  expect(command.length).toBeGreaterThan(1)
  expect(command[0]).toMatch(/^●Bash\(echo '/)
  expect(command.slice(1).every(r => /^ ⠀\S/.test(r))).toBe(true)
  expect(command.every(r => r.length <= 30)).toBe(true)
  expect([command[0]!.slice(1), ...command.slice(1).map(r => r.slice(2))].map(r => r.trimEnd()).join(' ')).toBe(`Bash(echo '${longHebrew}')`)
  expect((await expanded.find({ type: 'Text', text: /^Bash\($/ }))?.props.bold).toBe(true)
  const quoted = (await expanded.find({ type: 'Text', text: /^'שלום/ }))?.props.color
  expect(quoted).toBeDefined()
  expect((await expanded.findAll({ type: 'Text', text: /^(שלום|עולם).*'$/ })).some(t => t.props.color === quoted)).toBe(true)
  const rows = (await expanded.findAll({ type: 'Box', text: /^⠀(שלום|עולם)/ })).filter(r => r.props.flexDirection === 'row').map(r => r.text)
  expect(rows.length).toBeGreaterThan(1)
  expect(rows.every(r => r.length <= 30 - 4)).toBe(true)
  expect(rows.map(r => r.slice(1).trimEnd()).join(' ')).toBe(longHebrew)
  expect(await expanded.find({ type: 'Box', text: /^⠀שם\tגיל$/ })).toBeDefined()
  await expanded.unmount()
})

test('on warp a long Hebrew command and output line in an expanded shell call stay one row each, left to the terminal', { options: { rtl: 'warp' } }, async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const expanded = await expandShell($, 'ww', `echo '${longHebrew}'`, longHebrew)
  const command = (await expanded.findAll({ type: 'Box', text: /^(●Bash\(| [ ⠀])/ })).filter(r => r.props.flexDirection === 'row' && !/[│╭╰]/.test(r.text)).map(r => r.text)
  expect(command).toHaveLength(1)
  expect(command[0]).toMatch(/^●Bash\(echo '[^⠀]+'\)$/)
  expect((await expanded.findAll({ type: 'Box', text: /^ (שלום|עולם)/ })).filter(r => r.props.flexDirection === 'row').map(r => r.text)).toEqual([` ${longHebrew}`])
  await expanded.unmount()
})

test('on iTerm a single Hebrew output line too long for 120 rows is cut there and says so', { options: { rtl: 'iterm' } }, async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const expanded = await expandShell($, 'big', 'ls', Array(2000).fill('שלום עולם').join(' '))
  expect((await expanded.findAll({ type: 'Box', text: /^⠀\S/ })).filter(r => r.props.flexDirection === 'row')).toHaveLength(120)
  expect(await expanded.find({ type: 'Box', text: /^ … \+1 lines$/ })).toBeDefined()
  await expanded.unmount()
})

test('on iTerm the last of the 120 rows shows a cantillated Hebrew line whole when it fits, never a broken letter', { options: { rtl: 'iterm' } }, async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const line = 'שָּׁ֑'.repeat(20)
  const expanded = await expandShell($, 'pts', 'ls', `${Array(119).fill('x').join('\n')}\n${line}`)
  expect(await expanded.find({ type: 'Box', text: new RegExp(`^⠀${line}$`) })).toBeDefined()
  expect(await expanded.find({ type: 'Box', text: /^ … \+\d+ lines$/ })).toBeUndefined()
  await expanded.unmount()
})

test('on iTerm a Hebrew output line that is one letter with a huge run of points is cut and says so', { options: { rtl: 'iterm' } }, async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const expanded = await expandShell($, 'marks', 'ls', `ש${'\u05B8'.repeat(200000)}`)
  expect(await expanded.find({ type: 'Box', text: /^ … \+1 lines$/ })).toBeDefined()
  expect((await expanded.findAll({ type: 'Text' })).every(t => t.text.length < 1000)).toBe(true)
  await expanded.unmount()
})

for (const rtl of ['iterm', 'warp'] as const)
  test(`a failed tool's Hebrew reason stays after its ⎿ on ${rtl}: the gutter ends in a braille blank on iTerm`, { options: { rtl, toolStyle: 'tree-dim', toolOutput: 'quiet' } }, async ($, on) => {
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine</Text>
    })
    const blank = rtl === 'iterm' ? '⠀' : ' '
    const failed = await $.ui.mount({ ...toolCard('Bash', 'Exit code 1\nהקובץ לא נמצא'), props: { tool_use_id: `f-${rtl}`, tool: 'Bash', output: 'Exit code 1\nהקובץ לא נמצא', isErrored: true } })
    expect(await failed.find({ type: 'Text', text: new RegExp(`^  ⎿${blank}הקובץ לא נמצא$`) })).toBeDefined()
    await failed.unmount()
  })
