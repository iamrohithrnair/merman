import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { FIGURE_GLYPHS, FIGURE_HINT, FIGURE_MAX_COLUMNS, FIGURE_MAX_LINES, FIGURE_SAFE_COLUMNS, checkFigure, figureRoleColors, figureRuns, figureText, isFigureLang, reframe } from '../hooks/figure'
import { HINT } from '../hooks/help'
import { FIGURE_ROLES } from '../hooks/markdown'
import { PRESETS } from '../hooks/presets'
import { width } from '../hooks/render'

const lines = (text: string) => text.split('\n')

const CARDS = lines(`{accent:┌─ dev ──────┐}  {accent:╔═ prod ═════╗}
{accent:│} v1.8.0     {accent:│}  {accent:║} {strong:v1.7.2}     {accent:║}
{accent:│} {ok:● healthy}  {accent:│}  {accent:║} {warn:▲ degraded} {accent:║}
{accent:└────────────┘}  {accent:╚════════════╝}`)

const STORE = lines(`              Command ShipOrder
                    │
 ┌─ Handler ────────▼──────┐
 │ status = PAID? ✓        │
 └─────────────────────────┘
 ┌────┴──────────────────────────┐
 │ EVENT STORE · append only     │
 ├──────────┬──────────┬─────────┤
 │v1 Created│v2 +A-100 │v3 Paid  │
 └────┬─────┴──────────┴─────────┘
      ├──▶ customer view   lags a moment
      └──▶ warehouse       own table`)

const TIMELINE = lines(`{note:0 s        10 s  12 s        later}
Provider {accent:●── waits ──}{warn:✗ timeout}     {accent:●} retry, same event
Handler  {ok:■■■■■■■■■■■■■■■} books, 200 into the void
          ┌──┴──┐
          phase 2`)

const ROUNDED = lines(`╭─ before ─╮   ╭─ after ──╮
│ 40 apps  │ → │ 1 app    │
╰──────────╯   ╰──────────╯`)

const FORK = lines(`     │
  ┌──┴──┐
  │     │
  ▼     ▼
 old   new`)

const LEGS = lines(`  ┌──┴──┐
  │     │
  a     b`)

const BRANCH = lines(`┌─▶ fetch      ┌─────────┐
│              │ cache   │
│              └─────────┘
└─▶ store`)

const NESTED = lines(`┌─ app ──────────────┐
│ ┌─ api ──┐ ┌─ db ┐ │
│ │ v2     │ │ pg  │ │
│ └────────┘ └─────┘ │
├────────────────────┤
│ shared config      │
└────────────────────┘`)

const CYCLE = lines(`┌─▶ fetch ─┐
│          ▼
└─◀ store ◀┘`)

const CHILDREN = lines(`    ┌──┴──┐
    │     │
  ┌─┴─┐ ┌─┴─┐
  │ a │ │ b │
  └───┘ └───┘`)

const SIDEWAYS = lines(`  ┌──┴──┐
  │     │
  └─ a  └─ b`)

const MODULES = [
  '{accent:┌─ 1 Deployable, 1 Postgres ────────────────────────────────────┐}',
  '{accent:│ ┌─ Team A ───────┐  ┌─ Team B ───────┐  ┌─ Team C ───────┐ │}',
  '│ │ public API only │  │ public API only │  │ public API only │ │',
  '│ │ Schema a        │  │ Schema b        │  │ Schema c        │ │',
  '{accent:│ └─────────────────┘  └─────────────────┘  └─────────────────┘ │}',
  '│ {ok:B → A through API: fine}                                      │',
  '│ {warn:C reads a table from Schema a: CI fails it}                   │',
  '{accent:└───────────────────────────────────────────────────────────────┘}',
]

const ACCENTED = lines(`┌──────┐
│ cafe\u0301 │
└──────┘`)

test('a fence named figure opens a picture, other names do not', () => {
  expect(isFigureLang('figure')).toBe(true)
  expect(isFigureLang('Figure')).toBe(true)
  expect(isFigureLang('art')).toBe(false)
  expect(isFigureLang('')).toBe(false)
})

test('a line splits into runs, each role markup becoming one colored run', () => {
  expect(figureRuns('Handler {ok:■■} books {warn:twice}')).toEqual([
    { text: 'Handler ' },
    { text: '■■', role: 'ok' },
    { text: ' books ' },
    { text: 'twice', role: 'warn' },
  ])
})

test('markup that names no role stays as written', () => {
  expect(figureText('{accent:┌──┐} {id:42} {nope:x}{ok:y}')).toBe('┌──┐ {id:42} {nope:x}y')
})

test('markup with empty text draws nothing', () => {
  expect(figureRuns('a{ok:}b')).toEqual([{ text: 'a' }, { text: 'b' }])
})

test('emoji-capable arrows are drawn as their text forms', () => {
  expect(figureText('a ──▶ b ◀── c')).toBe('a ──► b ◄── c')
})

test('clean pictures have no findings', () => {
  for (const picture of [CARDS, STORE, TIMELINE, ROUNDED, FORK, LEGS, BRANCH, NESTED, CYCLE, CHILDREN, SIDEWAYS, ACCENTED]) expect(checkFigure(picture)).toEqual([])
})

test('glyphs that may draw as emoji are found once per line', () => {
  expect(checkFigure(['⚠ check ✔ done ⚠'])).toEqual([{ line: 1, message: '"⚠", "✔" may draw as an emoji, use a text glyph' }])
  expect(checkFigure(['Deploy 🚀 ok'])).toEqual([{ line: 1, message: '"🚀" may draw as an emoji, use a text glyph' }])
  expect(checkFigure(['✓ ✗ ▶ ◀ ▲ ▼ ● ○ ■ □ → ← · ⧉'])).toEqual([])
})

const KOREAN = lines(`{accent:┌─ 빌드 ─────────┐}
{accent:│} {ok:자연어로 정의}  {accent:│}
{accent:│} build {warn:실패}     {accent:│}
{accent:└────────────────┘}`)

test('Korean, Japanese and Chinese letters and fullwidth forms pass the checker', () => {
  expect(checkFigure(KOREAN)).toEqual([])
  expect(checkFigure(['名前 ok', 'カタカナ ひらがな', '中文 标签', 'ＡＢＣ　１２３'])).toEqual([])
})

test('flags, skin tones and keycaps still count as emoji', () => {
  expect(checkFigure(['ok 🇮🇪'])).toEqual([{ line: 1, message: '"🇮🇪" may draw as an emoji, use a text glyph' }])
  expect(checkFigure(['자연어 🚀'])).toEqual([{ line: 1, message: '"🚀" may draw as an emoji, use a text glyph' }])
  expect(checkFigure(['step 1⃣']).map(finding => finding.message)).toEqual(['"1⃣" may draw as an emoji, use a text glyph'])
})

test('a Korean box closes in the same column on every line, wide letters counted twice', () => {
  expect(new Set(KOREAN.map(line => width(figureText(line)))).size).toBe(1)
})

const drawn = (picture: readonly string[]) => reframe(picture.map(figureRuns)).map(runs => runs.map(run => run.text).join(''))

test('clean pictures are not reframed', () => {
  for (const picture of [CARDS, STORE, TIMELINE, ROUNDED, FORK, LEGS, BRANCH, NESTED, CYCLE, CHILDREN, SIDEWAYS, ACCENTED, KOREAN]) expect(drawn(picture)).toEqual(picture.map(figureText))
})

test('a box row whose side falls short is padded to the corner', () => {
  expect(drawn(['┌──────┐', '│ {accent:ab} │', '└──────┘'])).toEqual(['┌──────┐', '│ ab   │', '└──────┘'])
})

test('a box row whose side overshoots gives back its spare spaces', () => {
  expect(drawn(['┌──────┐', '│ ab     │', '└──────┘'])).toEqual(['┌──────┐', '│ ab   │', '└──────┘'])
})

test('a box next to a reframed box keeps its columns', () => {
  expect(drawn(['┌─ A ─┐  ┌─ B ─┐', '│ aa   │ │ bb  │', '└─────┘  └─────┘'])).toEqual(['┌─ A ─┐  ┌─ B ─┐', '│ aa  │  │ bb  │', '└─────┘  └─────┘'])
})

test('a row wider than its box widens the box and moves the box beside it in one piece', () => {
  expect(drawn(['┌─ A ──┐  ┌─ B ─┐', '│ abcdef│ │ bb  │', '└──────┘  └─────┘'])).toEqual(['┌─ A ───┐  ┌─ B ─┐', '│ abcdef│  │ bb  │', '└───────┘  └─────┘'])
})

test('a taller box beside a widened box moves in one piece, rows above and below included', () => {
  expect(drawn(['          ┌─ B ─┐', '┌─ A ──┐  │ b1  │', '│ abcdef│ │ b2  │', '└──────┘  │ b3  │', '          └─────┘'])).toEqual(['           ┌─ B ─┐', '┌─ A ───┐  │ b1  │', '│ abcdef│  │ b2  │', '└───────┘  │ b3  │', '           └─────┘'])
})

test('boxes whose top border is the short row line up with their rows', () => {
  for (const line of drawn(MODULES)) expect(width(line)).toBe(65)
})

test('a lone box widens to its widest row', () => {
  expect(drawn(['┌─ A ──┐', '│ abcdef│', '└──────┘'])).toEqual(['┌─ A ───┐', '│ abcdef│', '└───────┘'])
})

test('a row with an arrow and no right side is drawn as written', () => {
  expect(drawn(['┌──────┐', '│ ▲ up', '└──────┘'])).toEqual(['┌──────┐', '│ ▲ up', '└──────┘'])
})

test('a slipped Korean box is padded in columns, wide letters counted twice', () => {
  const box = drawn(['┌─ 빌드 ───┐', '│ 실패 │', '└───────┘'])
  expect(new Set(box.map(width)).size).toBe(1)
  expect(box[1]).toBe('│ 실패     │')
})

test('a slipped inner box is reframed first, then the box around it', () => {
  expect(drawn(['┌───────────┐', '│ ┌────┐    │', '│ │ a │     │', '│ └────┘    │', '└───────────┘'])).toEqual(['┌───────────┐', '│ ┌────┐    │', '│ │ a  │    │', '│ └────┘    │', '└───────────┘'])
})

test('reframed border fill keeps the color of its corner', () => {
  expect(reframe([[{ text: '┌─────┐', role: 'accent' }], [{ text: '│ abc │' }], [{ text: '└──┘', role: 'accent' }]])[2]).toEqual([{ text: '└─────┘', role: 'accent' }])
})

test(`a line wider than ${FIGURE_MAX_COLUMNS} columns is found, wide glyphs counted twice and markup not at all`, () => {
  expect(checkFigure(['x'.repeat(FIGURE_MAX_COLUMNS + 1)])).toEqual([{ line: 1, message: `${FIGURE_MAX_COLUMNS + 1} columns wide, at most ${FIGURE_MAX_COLUMNS}` }])
  expect(checkFigure([`{accent:${'x'.repeat(FIGURE_MAX_COLUMNS)}}`])).toEqual([])
  expect(checkFigure(['名'.repeat(60)]).map(finding => finding.message)).toContain(`120 columns wide, at most ${FIGURE_MAX_COLUMNS}`)
})

test('a tab is found', () => {
  expect(checkFigure(['a\tb'])).toEqual([{ line: 1, message: 'tab, use spaces' }])
})

test('a role in the wrong case or with swapped letters is found, with the roles listed', () => {
  const message = (written: string) => `"${written}" is not a role, roles are accent, warn, ok, note, dim, strong in lower case`
  expect(checkFigure(['{OK:done}'])).toEqual([{ line: 1, message: message('{OK:') }])
  expect(checkFigure(['{wran:x}'])).toEqual([{ line: 1, message: message('{wran:') }])
})

test('markup holding other markup or braces is found', () => {
  expect(checkFigure(['{accent:{ok:x}}'])).toEqual([{ line: 1, message: '"{accent:" holds braces, markup does not nest' }])
  expect(checkFigure(['{warn:map{k}}'])).toEqual([{ line: 1, message: '"{warn:" holds braces, markup does not nest' }])
})

test('markup that is never closed is found', () => {
  expect(checkFigure(['{ok:done'])).toEqual([{ line: 1, message: '"{ok:" is not closed, end it with }' }])
})

test('braces that hold data are no finding', () => {
  expect(checkFigure(['config {id:42} {a:b} {retries:3} {node:api} {os:linux}', '{on:1} {dir:/tmp} {notes:x} {string:x} { ok: true }'])).toEqual([])
})

test('the figure hint names the opening line, every role, the width, one-column glyphs and two-column letters', () => {
  expect(FIGURE_HINT).toContain('Exactly ```figure opens a block drawn as written')
  for (const role of FIGURE_ROLES) expect(FIGURE_HINT).toMatch(new RegExp(` ${role} [a-z]+[,.]`))
  expect(FIGURE_HINT).toContain(`At most ${FIGURE_SAFE_COLUMNS} columns of one-column glyphs (${FIGURE_GLYPHS})`)
  expect(FIGURE_HINT).toContain('no emoji or tabs')
  expect(FIGURE_HINT).toContain('markup takes no columns')
  expect(FIGURE_HINT).toContain('CJK two')
  expect(FIGURE_HINT).toContain('pad box rows to the top border')
  expect(FIGURE_HINT).toContain('In figures, color with unnested {role:text}')
  expect(FIGURE_HINT).toContain('ticks ▏──▏ not ├┼┤')
})

test('the figure hint says when to draw one and when not', () => {
  expect(FIGURE_HINT).toContain('where position matters')
  expect(FIGURE_HINT).toContain('mermaid stays for plain flows and charts')
  expect(HINT).toContain('not in short answers, code changes or reports, nor as a second picture of a figure')
  expect(HINT).toContain('never inline code')
  expect(FIGURE_HINT).toContain('Only when asked to explain, compare or plan and pictures would help, build the reply around them')
  expect(FIGURE_HINT).toContain('prose never retells a picture')
})

test('the render hint and the figure hint stay under 1,100 characters together', () => {
  expect(`${HINT}\n${FIGURE_HINT}`.length).toBeLessThan(1100)
})

test('every glyph the figure hint offers passes the checker', () => {
  expect([...FIGURE_GLYPHS].length).toBeGreaterThan(20)
  expect([...FIGURE_GLYPHS].every(glyph => width(glyph) === 1)).toBe(true)
  expect(checkFigure([[...FIGURE_GLYPHS].join(' ')])).toEqual([])
})

const engine = (on: On) =>
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

const reply = (text: string, surface: 'terminal' | 'desktop' = 'terminal', columns = 120) => ({
  plugin: 'merman',
  surface,
  component: 'AssistantMessage' as const,
  props: { text, isFirstOfReply: true },
  viewport: { columns, rows: 40 },
})

const ROLES = ['```figure', '{accent:┌──┐} plain {warn:break}', '{ok:done} {note:10 s} {dim:aside} {strong:key}', '```'].join('\n')

const EXPECTED_ROLES = {
  'catppuccin-mocha': { warn: '#f38ba8', ok: '#a6e3a1', note: '#f9e2af' },
  'github-light': { warn: '#cf222e', ok: '#116329', note: '#953800' },
} as const

for (const theme of ['catppuccin-mocha', 'github-light'] as const) {
  test(`a figure draws each role in its ${theme} color on terminal and desktop`, { options: { theme } }, async ($, on) => {
    engine(on)
    const colors = PRESETS[theme]
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount(reply(ROLES, surface))
      const colorOf = async (text: RegExp) => (await ui.find({ type: 'Text', text }))?.props
      expect((await colorOf(/^┌──┐$/))?.color).toBe(colors.diagram)
      expect((await colorOf(/^ plain $/))?.color).toBe(colors.diagramText)
      expect((await colorOf(/^break$/))?.color).toBe(EXPECTED_ROLES[theme].warn)
      expect((await colorOf(/^done$/))?.color).toBe(EXPECTED_ROLES[theme].ok)
      expect((await colorOf(/^10 s$/))?.color).toBe(EXPECTED_ROLES[theme].note)
      expect((await colorOf(/^aside$/))?.color).toBe(colors.codeComment)
      expect((await colorOf(/^key$/))?.color).toBe(colors.strong)
      expect((await colorOf(/^key$/))?.bold).toBe(true)
      expect(await ui.find({ type: 'Text', text: /^── figure$/ })).toBeUndefined()
      await ui.unmount()
    }
  })
}

const hueOf = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (h * 60 + 360) % 360
}

const away = (a: number, b: number): number => Math.min(Math.abs(a - b), 360 - Math.abs(a - b))

test('in every preset with colors, warn, ok, note and accent differ, warn leans red and ok leans green', () => {
  for (const [name, theme] of Object.entries(PRESETS)) {
    if (name === 'mono') continue
    const roles = figureRoleColors(theme)
    const colors = [theme.diagram, roles.warn, roles.ok, roles.note]
    expect(colors.every(color => typeof color === 'string')).toBe(true)
    expect(new Set(colors).size).toBe(4)
    expect(away(hueOf(roles.warn!), 0)).toBeLessThan(45)
    expect(away(hueOf(roles.ok!), 120)).toBeLessThan(75)
  }
})

test('no role takes the diagram color, even when it is the reddest in the theme', () => {
  const theme = { diagram: '#e06c75', accent: '#e06c75', codeFlag: '#d19a66', codeString: '#98c379', heading: '#e5c07b' }
  expect(figureRoleColors(theme)).toEqual({ warn: '#d19a66', ok: '#98c379', note: '#e5c07b' })
})

test('a role whose own color you set by name keeps that color', { options: { codeFlagColor: 'red' } }, async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(reply(ROLES, surface))
    expect((await ui.find({ type: 'Text', text: /^break$/ }))?.props.color).toBe('red')
    await ui.unmount()
  }
})

test('an rgb diagram color still keeps the roles off the frame color', () => {
  const theme = { diagram: 'rgb(243,139,168)', codeFlag: '#f38ba8', emphasis: '#eb6f92', codeString: '#a6e3a1', heading: '#f9e2af' }
  expect(figureRoleColors(theme).warn).not.toBe('#f38ba8')
})

test('rgb colors take part in the pick', () => {
  expect(figureRoleColors({ diagram: '#89b4fa', codeFlag: 'rgb(220, 30, 40)', codeString: '#a6e3a1', heading: '#f9e2af' }).warn).toBe('rgb(220, 30, 40)')
})

test('a theme without hex colors keeps the role tokens it had', () => {
  expect(figureRoleColors({ codeFlag: 'red', codeString: 'green', heading: 'yellow', diagram: 'blue' })).toEqual({})
})

test('a figure offers its source and its drawn text as copies', async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(reply(ROLES, surface))
    const labels = (await ui.findAll({ type: 'Button' })).map(button => button.props.label)
    expect(labels).toContain('⧉ source')
    expect(labels).toContain('⧉ art')
    await ui.unmount()
  }
})

test('a figure with an emoji or a markup error stays a code block', async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const line of ['┌────┐ 🚀', '{OK:done}']) {
      const ui = await $.ui.mount(reply(['```figure', line, '```'].join('\n'), surface))
      expect(await ui.find({ type: 'Text', text: /^── figure$/ })).toBeDefined()
      await ui.unmount()
    }
  }
})

test('a figure whose frame slips is reframed and one that does not close is drawn as written, without a note', async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(reply(['```figure', '┌────────┐', '│ v1.4.2 │', '│ old    │', '```'].join('\n'), surface))
    expect(await ui.find({ type: 'Text', text: /^── figure$/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^figure line/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^│ old    │$/ })).toBeDefined()
    await ui.unmount()
    const modules = await $.ui.mount(reply(['```figure', ...MODULES, '```'].join('\n'), surface))
    expect(await modules.find({ type: 'Text', text: /^── figure$/ })).toBeUndefined()
    expect(await modules.find({ type: 'Text', text: /^│ ┌─ Team A ────────┐  ┌─ Team B ────────┐  ┌─ Team C ────────┐ │$/ })).toBeDefined()
    await modules.unmount()
  }
})

test('a figure wider than the terminal stays a code block', async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(reply(['```figure', `{accent:${'─'.repeat(70)}}`, '```'].join('\n'), surface, 60))
    expect(await ui.find({ type: 'Text', text: /^── figure$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a figure as wide as the hint allows draws in an 80-column window, one column more does not', async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const safe = await $.ui.mount(reply(['```figure', `{accent:${'─'.repeat(FIGURE_SAFE_COLUMNS)}}`, '```'].join('\n'), surface, 80))
    expect(await safe.find({ type: 'Text', text: /^── figure$/ })).toBeUndefined()
    await safe.unmount()
    const wider = await $.ui.mount(reply(['```figure', `{accent:${'─'.repeat(FIGURE_SAFE_COLUMNS + 1)}}`, '```'].join('\n'), surface, 80))
    expect(await wider.find({ type: 'Text', text: /^── figure$/ })).toBeDefined()
    await wider.unmount()
  }
})

test('a figure still streaming stays a code block until its fence closes', async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const open = await $.ui.mount(reply(['```figure', '{ok:done} a'].join('\n'), surface))
    expect(await open.find({ type: 'Text', text: /^── figure$/ })).toBeDefined()
    await open.unmount()
    const closed = await $.ui.mount(reply(['```figure', '{ok:done} a', '```'].join('\n'), surface))
    expect(await closed.find({ type: 'Text', text: /^── figure$/ })).toBeUndefined()
    await closed.unmount()
  }
})

test(`a figure over ${FIGURE_MAX_LINES} lines stays a code block`, async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const figure = (count: number) => ['```figure', ...Array.from({ length: count }, (_, i) => `row ${i}`), '```'].join('\n')
    const long = await $.ui.mount(reply(figure(FIGURE_MAX_LINES + 1), surface))
    expect(await long.find({ type: 'Text', text: /^── figure$/ })).toBeDefined()
    await long.unmount()
    const fits = await $.ui.mount(reply(figure(FIGURE_MAX_LINES), surface))
    expect(await fits.find({ type: 'Text', text: /^── figure$/ })).toBeUndefined()
    await fits.unmount()
  }
})

const figureBox = async (ui: { findAll: (query: { type: string }) => Promise<{ props: Record<string, unknown>; text?: string; children?: unknown[] }[]> }) =>
  (await ui.findAll({ type: 'Box' })).find(box => box.props.paddingLeft === 2)

test('figures draw with mermaid off', { options: { mermaid: false } }, async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(reply(ROLES, surface))
    expect(await ui.find({ type: 'Text', text: /^── figure$/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^break$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('in a theme without colors, warn draws bold and dim draws dimmed', { options: { theme: 'mono' } }, async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(reply(ROLES, surface))
    expect((await ui.find({ type: 'Text', text: /^break$/ }))?.props.bold).toBe(true)
    expect((await ui.find({ type: 'Text', text: /^aside$/ }))?.props.dimColor).toBe(true)
    await ui.unmount()
  }
})

test('blank lines around a figure are not drawn, blank lines inside are', async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(reply(['```figure', '', '{ok:a}', '', 'b', '', '```'].join('\n'), surface))
    const figure = await figureBox(ui)
    expect(figure?.children?.length).toBe(3)
    expect(figure?.text).toBe('a b')
    await ui.unmount()
  }
})

test('control characters and direction marks are found, they would not draw as written', () => {
  expect(checkFigure(['a\u001b[31mb'])).toEqual([{ line: 1, message: 'control character, use plain text' }])
  expect(checkFigure(['a\u202eb'])).toEqual([{ line: 1, message: 'direction mark, use plain text' }])
  expect(checkFigure(['a\u2066b\u2069'])).toEqual([{ line: 1, message: 'direction mark, use plain text' }])
})

test('marks that draw no column are found, they would hide in the picture', () => {
  for (const mark of ['\u200e', '\u200f', '\u061c']) expect(checkFigure([`a${mark}b`])).toEqual([{ line: 1, message: 'direction mark, use plain text' }])
  for (const mark of ['\u200b', '\u200c', '\u200d', '\u2028', '\u2029', '\ufeff', '\u00ad']) expect(checkFigure([`a${mark}b`])).toEqual([{ line: 1, message: 'invisible character, use plain text' }])
})

test('a finding lists at most eight glyphs', () => {
  expect(checkFigure(['🚀🔥🎉🍕🎈🐛🌍📦🧪🔧']).map(finding => finding.message)).toContain('"🚀", "🔥", "🎉", "🍕", "🎈", "🐛", "🌍", "📦" and 2 more may draw as an emoji, use a text glyph')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`a figure that stays code says why in a dim line on ${surface}`, async ($, on) => {
    engine(on)
    const finding = await $.ui.mount(reply(['```figure', '┌────────┐', '│ v1.4.2 │', '│ 🚀     │', '```'].join('\n'), surface))
    expect(await finding.find({ type: 'Text', text: /^figure line 3: "🚀" may draw as an emoji, use a text glyph$/ })).toBeDefined()
    await finding.unmount()
    const wide = await $.ui.mount(reply(['```figure', `{accent:${'─'.repeat(70)}}`, '```'].join('\n'), surface, 60))
    expect(await wide.find({ type: 'Text', text: /^figure is 70 cols, terminal is \d+$/ })).toBeDefined()
    await wide.unmount()
    const long = await $.ui.mount(reply(['```figure', ...Array.from({ length: FIGURE_MAX_LINES + 1 }, (_, i) => `row ${i}`), '```'].join('\n'), surface))
    expect(await long.find({ type: 'Text', text: new RegExp(`^figure has ${FIGURE_MAX_LINES + 1} lines, at most ${FIGURE_MAX_LINES}$`) })).toBeDefined()
    await long.unmount()
  })

  test(`a figure that stays code counts its lines from the first line of the block on ${surface}`, async ($, on) => {
    engine(on)
    const ui = await $.ui.mount(reply(['```figure', '', '', '┌────────┐', '│ v1.4.2 │', '│ {Ok:old}    │', '```'].join('\n'), surface))
    expect(await ui.find({ type: 'Text', text: /^figure line 5: "\{Ok:" is not a role, roles are accent, warn, ok, note, dim, strong in lower case$/ })).toBeDefined()
    await ui.unmount()
  })

  test(`a figure with a line far too long stays code at once on ${surface}`, async ($, on) => {
    engine(on)
    const ui = await $.ui.mount(reply(['```figure', '┌'.repeat(5_000), '```'].join('\n'), surface))
    expect(await ui.find({ type: 'Text', text: /^figure line 1 is 5000 characters long$/ })).toBeDefined()
    await ui.unmount()
  })

  test(`the art copy of a figure is its drawn text, without markup, on ${surface}`, async ($, on) => {
    engine(on)
    const copied: string[] = []
    on('ui.copy', (_, e) => {
      copied.push(e.text)
      return { value: { isCopied: true as const } }
    })
    const ui = await $.ui.mount(reply(['```figure', '{accent:┌──┐} plain {warn:break}', '{ok:done}', '```'].join('\n'), surface))
    const art = (await ui.findAll({ type: 'Button' })).find(button => button.props.label === '⧉ art')
    await ui.press({ key: art!.key! })
    expect(copied).toEqual(['┌──┐ plain break\ndone'])
    await ui.unmount()
  })

  test(`a Korean figure draws as written, frame aligned and colored, on ${surface}`, async ($, on) => {
    engine(on)
    const ui = await $.ui.mount(reply(['```figure', ...KOREAN, '```'].join('\n'), surface))
    expect(await ui.find({ type: 'Text', text: /^── figure$/ })).toBeUndefined()
    const word = await ui.find({ type: 'Text', text: /^자연어로 정의$/ })
    expect(word?.props.color).toBeDefined()
    expect(word?.props.color).not.toBe((await ui.find({ type: 'Text', text: /^ build $/ }))?.props.color)
    const drawn = await Promise.all(['│ 자연어로 정의  │', '│ build 실패     │', '┌─ 빌드 ─────────┐'].map(async text => (await ui.find({ type: 'Text', text: new RegExp(`^${text}$`) }))?.text))
    expect(drawn.map(text => width(text ?? ''))).toEqual([18, 18, 18])
    await ui.unmount()
  })

  test(`a figure whose box side is three columns off is pulled back to its corner on ${surface}`, async ($, on) => {
    engine(on)
    const ui = await $.ui.mount(reply(['```figure', '┌────────┐', '│ v1.4.2    │', '└────────┘', '```'].join('\n'), surface))
    expect(await ui.find({ type: 'Text', text: /^── figure$/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^│ v1\.4\.2 │$/ })).toBeDefined()
    await ui.unmount()
  })
}
