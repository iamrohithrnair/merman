import type { ElementTable, RenderElement } from 'claude-code'

import { cells, graphemes, heldLtr, mirrored, remember, width } from './render'
import { FIGURE_ROLES } from './markdown'
import { asIs, hasRtl, holdEngine, holdText, holdVisual, led } from './rtl'
import type { Style, Theme } from './theme'

type FigureRole = (typeof FIGURE_ROLES)[number]

type FigureRun = { text: string; role?: FigureRole }

type FigureFinding = { line: number; message: string }

export const FIGURE_MAX_COLUMNS = 100

export const FIGURE_MAX_LINES = 80

export const FIGURE_SAFE_COLUMNS = 74

const RAW_MAX_LINE = FIGURE_MAX_COLUMNS * 4

const LISTED_GLYPHS = 8

export const FIGURE_GLYPHS = '─│┌┐└┘├┤┬┴┼═║→←►◄▲▼✓✗●○█▏■□·'

export const FIGURE_HINT = [
  'Exactly ```figure opens a block drawn as written: use one where position matters (timelines, layouts, phases, before/after); mermaid stays for plain flows and charts; prose never retells a picture.',
  'Only when asked to explain, compare or plan and pictures would help, build the reply around them, core first.',
  'In figures, color with unnested {role:text}: accent lines, warn risk, ok healthy, note times, dim asides, strong emphasis.',
  `At most ${FIGURE_SAFE_COLUMNS} columns of one-column glyphs (${FIGURE_GLYPHS}), no emoji or tabs; markup takes no columns, CJK two; pad box rows to the top border; ticks ▏──▏ not ├┼┤.`,
].join(' ')

const MARKUP = new RegExp(`\\{(${FIGURE_ROLES.join('|')}):([^{}]*)\\}`, 'g')
const MARKER = /\{([A-Za-z][\w-]*):/g
const TEXT_FORMS: Record<string, string> = { '▶': '►', '◀': '◄' }
const ROLE_TOKENS: Record<FigureRole, keyof Theme> = { accent: 'diagram', warn: 'codeFlag', ok: 'codeString', note: 'heading', dim: 'codeComment', strong: 'strong' }
const EMOJI_CAPABLE = /\p{Extended_Pictographic}|\p{Emoji_Presentation}|\u20e3/u
const CONTROL = /[\0-\x08\x0b-\x1f\x7f-\x9f]/
const DIRECTION_MARK = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/
const INVISIBLE = /[\u00ad\u200b-\u200d\u2028\u2029\ufeff]/
const isRole = (name: string | undefined): name is FigureRole => FIGURE_ROLES.some(role => role === name)

export const isFigureLang = (lang: string): boolean => lang.toLowerCase() === 'figure'

const textForm = (text: string): string => text.replace(/[▶◀]/g, glyph => TEXT_FORMS[glyph] ?? glyph)

export const figureRuns = (line: string): FigureRun[] => {
  const runs: FigureRun[] = []
  let at = 0
  for (const match of line.matchAll(MARKUP)) {
    const [whole, role, text = ''] = match
    if (match.index > at) runs.push({ text: textForm(line.slice(at, match.index)) })
    if (text && isRole(role)) runs.push({ text: textForm(text), role })
    at = match.index + whole.length
  }
  if (at < line.length) runs.push({ text: textForm(line.slice(at)) })
  return runs
}

export const figureText = (line: string): string => figureRuns(line).map(run => run.text).join('')

const swapsTwoLetters = (name: string, role: string): boolean => {
  if (name.length !== role.length) return false
  const differ = [...name].flatMap((letter, i) => (letter === role[i] ? [] : [i]))
  const [first = -1, second = -1] = differ
  return differ.length === 2 && second === first + 1 && name[first] === role[second] && name[second] === role[first]
}

const markupMessage = (marker: RegExpExecArray, drawn: ReadonlySet<number>, lastClose: number): string | undefined => {
  const [written, name = ''] = marker
  if (drawn.has(marker.index)) return undefined
  const lower = name.toLowerCase()
  const role = FIGURE_ROLES.find(candidate => candidate === lower || swapsTwoLetters(lower, candidate))
  if (!role) return undefined
  if (name !== role) return `"${written}" is not a role, roles are ${FIGURE_ROLES.join(', ')} in lower case`
  if (lastClose < marker.index + written.length) return `"${written}" is not closed, end it with }`
  return `"${written}" holds braces, markup does not nest`
}

const markupMessages = (line: string): string[] => {
  const drawn = new Set([...line.matchAll(MARKUP)].map(match => match.index))
  const lastClose = line.lastIndexOf('}')
  return [...line.matchAll(MARKER)].flatMap(marker => markupMessage(marker, drawn, lastClose) ?? [])
}

const quoted = (glyphs: readonly string[]): string => {
  const distinct = [...new Set(glyphs)]
  const listed = distinct.slice(0, LISTED_GLYPHS).map(glyph => `"${glyph}"`).join(', ')
  return distinct.length > LISTED_GLYPHS ? `${listed} and ${distinct.length - LISTED_GLYPHS} more` : listed
}

const lineMessages = (line: string): string[] => {
  const text = figureText(line)
  const glyphs = graphemes(text)
  const emoji = glyphs.filter(glyph => EMOJI_CAPABLE.test(glyph))
  const columns = width(text)
  return [
    ...(columns > FIGURE_MAX_COLUMNS ? [`${columns} columns wide, at most ${FIGURE_MAX_COLUMNS}`] : []),
    ...(text.includes('\t') ? ['tab, use spaces'] : []),
    ...(CONTROL.test(text) ? ['control character, use plain text'] : []),
    ...(DIRECTION_MARK.test(text) ? ['direction mark, use plain text'] : []),
    ...(INVISIBLE.test(text) ? ['invisible character, use plain text'] : []),
    ...(emoji.length ? [`${quoted(emoji)} may draw as an emoji, use a text glyph`] : []),
    ...markupMessages(line),
  ]
}

const withoutTrailingBlanks = (lines: readonly string[]): readonly string[] => {
  let end = lines.length
  while (end > 0 && !lines[end - 1]?.trim()) end--
  return lines.slice(0, end)
}

export const checkFigure = (lines: readonly string[], first = 0): FigureFinding[] =>
  lines.flatMap((line, index) => lineMessages(line).map(message => ({ line: first + index + 1, message })))

const leadingBlanks = (lines: readonly string[]): number => {
  const start = lines.findIndex(line => line.trim())
  return start < 0 ? lines.length : start
}

const ROLE_HUES = { warn: 0, ok: 120, note: 45 } as const

type HuedRole = keyof typeof ROLE_HUES

const INK: readonly (keyof Theme)[] = ['accent', 'heading', 'tableHeader', 'emphasis', 'inlineCode', 'codeCommand', 'codeFlag', 'codeString', 'link', 'path', 'number', 'bullet', 'quote']

const HEX = /^#(?:[0-9a-f]{3}){1,2}$/i

const RGB = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i

const channelsOf = (color: string): readonly [number, number, number] | undefined => {
  const value = color.trim()
  if (HEX.test(value)) {
    const full = value.length === 4 ? [...value.slice(1)].map(digit => digit + digit).join('') : value.slice(1)
    const [r = 0, g = 0, b = 0] = [0, 2, 4].map(at => parseInt(full.slice(at, at + 2), 16))
    return [r, g, b]
  }
  const rgb = RGB.exec(value)
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : undefined
}

const colorKey = (channels: readonly [number, number, number]): string => channels.join(',')

const hueOf = (channels: readonly [number, number, number]): { hue: number; saturation: number } => {
  const [r, g, b] = channels.map(channel => Math.min(channel, 255) / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const spread = max - Math.min(r, g, b)
  const lightness = (max + max - spread) / 2
  const saturation = spread === 0 ? 0 : spread / (1 - Math.abs(2 * lightness - 1))
  const sector = spread === 0 ? 0 : max === r ? ((g - b) / spread) % 6 : max === g ? (b - r) / spread + 2 : (r - g) / spread + 4
  return { hue: (sector * 60 + 360) % 360, saturation }
}

const hueDistance = (a: number, b: number): number => Math.min(Math.abs(a - b), 360 - Math.abs(a - b))

const pickedRoles = new WeakMap<Theme, Partial<Record<HuedRole, string>>>()

export const figureRoleColors = (theme: Theme): Partial<Record<HuedRole, string>> => {
  const known = pickedRoles.get(theme)
  if (known) return known
  const inks = [...new Set(INK.map(token => theme[token]).filter((color): color is string => color !== undefined))]
    .flatMap(color => {
      const channels = channelsOf(color)
      return channels ? [{ color, key: colorKey(channels), ...hueOf(channels) }] : []
    })
    .filter(ink => ink.saturation > 0.15)
  const frame = theme.diagram === undefined ? undefined : channelsOf(theme.diagram)
  const taken = new Set(frame ? [colorKey(frame)] : [])
  const picked: Partial<Record<HuedRole, string>> = {}
  for (const role of Object.keys(ROLE_HUES) as HuedRole[]) {
    const [best] = inks.filter(ink => !taken.has(ink.key)).sort((a, b) => hueDistance(a.hue, ROLE_HUES[role]) - hueDistance(b.hue, ROLE_HUES[role]))
    if (!best) continue
    picked[role] = best.color
    taken.add(best.key)
  }
  pickedRoles.set(theme, picked)
  return picked
}

const isHued = (role: FigureRole): role is HuedRole => role in ROLE_HUES

const runColor = (style: Style, role: FigureRole | undefined): string | undefined => {
  if (!role) return style.theme.diagramText
  const own = style.theme[ROLE_TOKENS[role]]
  if (!isHued(role) || (own !== undefined && !channelsOf(own))) return own
  return figureRoleColors(style.theme)[role] ?? own
}

const isBold = (style: Style, role: FigureRole | undefined): boolean => role === 'strong' || (role === 'warn' && !runColor(style, 'warn'))

const heldRuns = (style: Style, runs: readonly FigureRun[]): FigureRun[] => {
  const hold = !hasRtl(runs.map(run => run.text).join('')) ? null : mirrored(style) ? holdText : style.shape === 'engine' ? holdEngine : style.reorder && style.shape === 'visual' ? holdVisual : null
  const chars = runs.flatMap(run => [...run.text])
  const roles = runs.flatMap(run => [...run.text].map(() => run.role))
  const base = hold ? hold(chars) : asIs(chars)
  const { cells, from } = mirrored(style) ? led(chars, base) : base
  const held: FigureRun[] = []
  cells.forEach((ch, p) => {
    const role = roles[from[p]!]
    const last = held.at(-1)
    if (last && last.role === role) last.text += ch
    else held.push(role ? { text: ch, role } : { text: ch })
  })
  return held
}

const figureElement = ({ Box, Text }: ElementTable, style: Style, rows: readonly (readonly FigureRun[])[], key: string): RenderElement => (
  <Box key={key} flexDirection="column" paddingLeft={mirrored(style) ? 0 : 2}>
    {rows.map((row, i) => {
      const runs = heldRuns(style, row)
      return (
        <Text key={`${key}.${i}`} {...heldLtr(style)}>
          {runs.length
            ? runs.map((run, r) => (
                <Text key={`r${r}`} color={runColor(style, run.role)} bold={isBold(style, run.role)} dimColor={run.role === 'dim' && !style.theme.codeComment}>
                  {run.text}
                </Text>
              ))
            : ' '}
        </Text>
      )
    })}
  </Box>
)

type Cell = { glyph: string; role?: FigureRole }

type Frame = { top: number; left: number; corner: number; edges: readonly number[] }

const TOP_LEFT = '┌╔╭'
const TOP_RIGHT = '┐╗╮'
const BOTTOM_LEFT = '└╚╰'
const BOTTOM_RIGHT = '┘╝╯'
const SIDE = '│║├┤┼╟╢╠╣'
const RULE = '─═'
const MAX_REFRAMES = 200

const isOf = (set: string, glyph: string | undefined): boolean => !!glyph && set.includes(glyph)

const cellsOf = (runs: readonly FigureRun[]): Cell[] => runs.flatMap(run => cells(run.text).map(glyph => ({ glyph, role: run.role })))

const runsOf = (row: readonly Cell[]): FigureRun[] =>
  row.reduce<FigureRun[]>((runs, cell) => {
    const last = runs.at(-1)
    if (last && last.role === cell.role) last.text += cell.glyph
    else runs.push(cell.role ? { text: cell.glyph, role: cell.role } : { text: cell.glyph })
    return runs
  }, [])

const nearest = (row: readonly Cell[], from: number, target: number, set: string): number => {
  let best = -1
  row.forEach((cell, column) => {
    if (column > from && isOf(set, cell.glyph) && (best < 0 || Math.abs(column - target) < Math.abs(best - target))) best = column
  })
  return best
}

const frameAt = (grid: readonly Cell[][], top: number, left: number): Frame | undefined => {
  const row = grid[top]!
  const corner = row.findIndex((cell, column) => column > left && (isOf(TOP_RIGHT, cell.glyph) || isOf(TOP_LEFT, cell.glyph)))
  if (corner < 0 || !isOf(TOP_RIGHT, row[corner]?.glyph)) return undefined
  const edges = [corner]
  for (let line = top + 1; line < grid.length; line++) {
    const cells = grid[line]!
    const start = cells[left]?.glyph
    if (isOf(BOTTOM_LEFT, start)) {
      const end = nearest(cells, left, corner, BOTTOM_RIGHT)
      return end < 0 ? undefined : { top, left, corner, edges: [...edges, end] }
    }
    if (!isOf(SIDE, start)) return undefined
    const edge = nearest(cells, left, corner, SIDE)
    if (edge < 0) return undefined
    edges.push(edge)
  }
  return undefined
}

const framesOf = (grid: readonly Cell[][]): Frame[] =>
  grid
    .flatMap((row, top) => row.flatMap((cell, left) => (isOf(TOP_LEFT, cell.glyph) ? [frameAt(grid, top, left)] : [])))
    .filter((frame): frame is Frame => frame !== undefined)
    .sort((a, b) => a.corner - a.left - (b.corner - b.left))

const fillOf = (row: readonly Cell[], edge: number, border: boolean): string => {
  const before = row[edge - 1]?.glyph
  return before && isOf(RULE, before) ? before : border ? '─' : ' '
}

const spareBefore = (row: readonly Cell[], edge: number, fill: string): number => {
  let run = 0
  while (row[edge - 1 - run]?.glyph === fill) run++
  return Math.max(0, run - 1)
}

const blanks = (count: number, glyph: string, role?: FigureRole): Cell[] => Array.from({ length: count }, () => (glyph === ' ' || !role ? { glyph } : { glyph, role }))

const spacesAfter = (row: readonly Cell[], edge: number, most: number): number => {
  let run = 0
  while (run < most && row[edge + 1 + run]?.glyph === ' ') run++
  return run
}

const firstAfter = (row: readonly Cell[], column: number): number => row.findIndex((cell, at) => at > column && cell.glyph !== ' ' && cell.glyph !== '')

const place = (row: Cell[], edge: number, target: number, shift: number, fill: string): boolean => {
  if (target < edge) row.splice(target, edge - target)
  if (target > edge) row.splice(edge, 0, ...blanks(target - edge, fill, row[edge]?.role))
  if (shift > 0) row.splice(target + 1, 0, ...blanks(shift, ' '))
  if (shift < 0) row.splice(target + 1, spacesAfter(row, target, -shift))
  return target !== edge || shift !== 0
}

const pushRight = (grid: Cell[][], frame: Frame, frames: readonly Frame[], by: number): void => {
  const bottom = frame.top + frame.edges.length - 1
  const pushed = new Set(Array.from({ length: frame.edges.length }, (_, i) => frame.top + i))
  for (const other of [...frames].sort((a, b) => a.left - b.left)) {
    const rows = Array.from({ length: other.edges.length }, (_, i) => other.top + i)
    if (other.left <= frame.corner || !rows.some(row => pushed.has(row))) continue
    if (other.top <= bottom && other.top + other.edges.length - 1 >= frame.top && rows.every(row => row >= frame.top && row <= bottom)) continue
    for (const row of rows) {
      if (pushed.has(row)) continue
      grid[row]!.splice(other.left, 0, ...blanks(by, ' '))
      pushed.add(row)
    }
  }
}

const fit = (grid: Cell[][], frame: Frame, frames: readonly Frame[]): boolean => {
  const last = frame.edges.length - 1
  const rows = frame.edges.map((_, i) => grid[frame.top + i]!)
  const fills = frame.edges.map((edge, i) => fillOf(rows[i]!, edge, i === 0 || i === last))
  const reaches = frame.edges.map((edge, i) => (i === 0 ? edge : edge - spareBefore(rows[i]!, edge, fills[i]!)))
  const target = Math.max(frame.corner, ...reaches)
  const after = firstAfter(rows[0]!, frame.corner)
  const shifts = frame.edges.map((edge, i) => (after >= 0 && firstAfter(rows[i]!, edge) === after ? edge - frame.corner : 0))
  const moved = frame.edges.map((edge, i) => place(rows[i]!, edge, target, shifts[i]!, fills[i]!)).some(Boolean)
  if (target > frame.corner) pushRight(grid, frame, frames, target - frame.corner)
  return moved
}

export const reframe = (rows: readonly (readonly FigureRun[])[]): FigureRun[][] => {
  const grid = rows.map(cellsOf)
  for (let pass = 0; pass < MAX_REFRAMES; pass++) {
    const frames = framesOf(grid)
    if (!frames.some(frame => fit(grid, frame, frames))) break
  }
  return grid.map(runsOf)
}

type FigureDecision = { rows: readonly (readonly FigureRun[])[]; texts: readonly string[]; widest: number } | { note: string }

const decisions = new Map<string, FigureDecision>()

const drawable = (lines: readonly string[]): FigureDecision => {
  const rows = reframe(lines.map(figureRuns))
  const texts = rows.map(runs => runs.map(run => run.text).join(''))
  return { rows, texts, widest: Math.max(0, ...texts.map(width)) }
}

const decide = (raw: readonly string[]): FigureDecision => {
  const tooLong = raw.findIndex(line => line.length > RAW_MAX_LINE)
  if (tooLong >= 0) return { note: `figure line ${tooLong + 1} is ${raw[tooLong]!.length} characters long` }
  if (raw.length > FIGURE_MAX_LINES * 2) return { note: `figure has ${raw.length} lines, at most ${FIGURE_MAX_LINES}` }
  const first = leadingBlanks(raw)
  const lines = withoutTrailingBlanks(raw.slice(first))
  if (lines.length > FIGURE_MAX_LINES) return { note: `figure has ${lines.length} lines, at most ${FIGURE_MAX_LINES}` }
  const [finding] = checkFigure(lines, first)
  return finding ? { note: `figure line ${finding.line}: ${finding.message}` } : drawable(lines)
}

export const drawFigure = (el: ElementTable, style: Style, block: { lines: readonly string[]; isOpen?: true }, columns: number, key: string): { element?: RenderElement; art?: string; note?: string } | null => {
  if (block.isOpen) return null
  const decision = remember(decisions, block.lines.join('\n'), () => decide(block.lines))
  if ('note' in decision) return decision
  if (decision.rows.length === 0) return null
  if (decision.widest > columns - 2) return { note: `figure is ${decision.widest} cols, terminal is ${columns}` }
  return { element: figureElement(el, style, decision.rows, key), art: decision.texts.join('\n') }
}
