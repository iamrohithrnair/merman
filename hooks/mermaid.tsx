import type { ElementTable, RenderElement } from 'claude-code'

import { c4Model, isC4Kind, plantUmlC4 } from './c4'
import { c4Colors, c4Element } from './c4draw'
import type { C4Paint, C4Picture } from './c4layout'
import { c4Grid, c4Layout, c4Width } from './c4layout'
import type { ChartArt } from './charts'
import { ganttText, pieText } from './charts'
import { drawFigure, isFigureLang } from './figure'
import type { Block } from './markdown'
import type { Drawn } from './render'
import { cells, graphemes, heldLtr, mirrored, remember, width } from './render'
import { hasRtl, holdEngine, holdRow, holdVisual, led } from './rtl'
import type { Run } from './runs'
import { drawRuns, joinRuns, lookOf } from './runs'
import type { Style, Theme } from './theme'
import { renderMermaidAscii, setChartSize } from './vendor/mermaid-text.js'
import type { ViewerProps, ViewerRun } from './viewer'
import { CONTINUED } from './viewer'

const MAX_LINES = 80
const PAD = '\uFDD0'

type ArtCaches = { fitted: Map<string, ChartArt | null>; texts: Map<string, string | null>; series: Map<string, number[][] | null>; widths: Map<string, number>; painted: WeakMap<Theme, Map<string, Painted>>; limit: number }

const artCaches = (limit: number): ArtCaches => ({ fitted: new Map(), texts: new Map(), series: new Map(), widths: new Map(), painted: new WeakMap(), limit })

const FINISHED = artCaches(200)
const UNFINISHED = artCaches(8)
let caches = FINISHED

export const chartSize = (columns: number, source = '') => {
  const labels = (/^\s*x-axis\b[^[\n]*\[([^\]\n]*)\]/m.exec(source)?.[1] ?? '').split(',').map(s => s.trim().replace(/^"|"$/g, ''))
  const fit = labels.length * (Math.max(...labels.map(l => l.length)) + 2)
  const width = Math.max(24, Math.min(60, Math.max(Math.floor(columns / 6), fit), columns - 12))
  return { width, height: Math.max(8, Math.min(20, Math.round(width * 0.3))) }
}

const padWide = (source: string) => (/^[\x00-\x7F]*$/.test(source) ? source : graphemes(source).map(g => (g.length === 1 && width(g) === 2 ? g + PAD : g)).join(''))

const unquoteCategories = (source: string) =>
  source.replace(/^(\s*x-axis\b[^[\n]*\[)([^\]\n]*)\]/m, (_, head: string, items: string) => `${head}${items.replace(/"([^"]*)"/g, (_q, s: string) => s.replaceAll(',', ' '))}]`)

const BLOCK = /[█▀▄]/

const labelBars = (art: string, source: string): string => {
  const series = source.match(/^\s*(bar|line)\b.*$/gm) ?? []
  const values = /^\s*bar\b[^[\n]*\[([^\]\n]*)\]/m.exec(source)?.[1]?.split(',').map(v => v.trim())
  if (series.length !== 1 || !values || /^\s*xychart(-beta)?\s+horizontal/m.test(source)) return art
  const grid = ['', ...art.split('\n')].map(l => [...l])
  const gutter = (r: number) => /^\s*(-?[\d.]+)[┤┼]/.exec(grid[r]?.join('') ?? '')?.[1]
  const axis = grid.findLastIndex((_, r) => gutter(r) !== undefined)
  const ticks = [...(grid[axis]?.join('') ?? '').matchAll(/┬|▀+/g)].map(m => m.index + Math.floor(m[0].length / 2))
  if (ticks.length !== values.length) return art
  const zero = grid.findIndex((_, r) => gutter(r) === '0')
  const top = grid.findIndex((_, r) => gutter(r) !== undefined)
  const base = zero !== -1 ? zero : gutter(top)?.startsWith('-') ? top : axis
  ticks.forEach((x, k) => {
    const filled = grid.flatMap((row, r) => (BLOCK.test(row[x] ?? '') ? [r] : []))
    const y = Number(values[k]) < 0 ? (filled.at(-1) ?? base) + 1 : (filled[0] ?? base) - 1
    const text = [...values[k]!]
    const bar = grid[filled[0] ?? -1] ?? []
    let [left, right] = [x, x]
    while (BLOCK.test(bar[left - 1] ?? '')) left--
    while (BLOCK.test(bar[right + 1] ?? '')) right++
    const from = left + Math.ceil((right - left + 1 - text.length) / 2)
    const row = y < axis ? grid[y] : undefined
    if (!row) return
    while (row.length < from + text.length) row.push(' ')
    if (!text.every((_, i) => /[ ·]/.test(row[from + i] ?? ' '))) return
    text.forEach((ch, i) => (row[from + i] = ch))
  })
  return grid.map(row => row.join('').trimEnd()).join('\n').replace(/^\n/, '')
}

const SIDEWAYS = /^(\s*(?:flowchart|graph)[ \t]+)(LR|RL)\b/

const SUPPORTED = /^(flowchart|graph|statediagram(-v2)?|xychart(-beta)?|sequencediagram|classdiagram|erdiagram|pie|gantt)$/i

const kindOf = (source: string) => /^\s*(\S*)/.exec(source.replace(/^(\s*%%[^\n]*\n)+/, ''))![1]!

const unsupportedKind = (source: string): string | undefined => {
  const kind = kindOf(source)
  return kind && !SUPPORTED.test(kind) && !isC4Kind(kind) ? kind : undefined
}

const OWN: Record<string, typeof pieText> = {
  pie: pieText,
  gantt: (source, ascii, columns) => {
    const text = ganttText(source, ascii, columns)
    return text === null ? null : { text }
  },
}

const INLINE_TAG = /<\/?(?:b|i|u|s|em|strong|del|code|small|sub|sup|span|mark)\b[^<>\n]*>/gi

type Mark = { italic?: boolean; bold?: boolean; underline?: boolean; strikethrough?: boolean }
const TAG_MARK: Record<string, keyof Mark> = { i: 'italic', em: 'italic', b: 'bold', strong: 'bold', u: 'underline', s: 'strikethrough', del: 'strikethrough' }

export const inlineMarks = (source: string): [string[], Mark][] =>
  [...source.matchAll(/<(i|em|b|strong|u|s|del)\b[^<>\n]*>([^<\n]+)<\/\1\s*>/gi)]
    .map(m => [cells(m[2]!.trim()), { [TAG_MARK[m[1]!.toLowerCase()]!]: true }] as [string[], Mark])

const artWidth = (art: string) => remember(caches.widths, art, () => Math.max(...art.split('\n').map(width)), caches.limit)

export const mermaidText = (source: string, ascii: boolean, columns: number, pieColors = 0): string | null => mermaidArt(source, ascii, columns, pieColors)?.text ?? null

const C4_CELLS_PER_ENTRY = 1000
const C4_PICTURES = 256

const cellWeight = (cells: number) => 1 + Math.floor(cells / C4_CELLS_PER_ENTRY)

const paintedCells = (c4: C4Paint) => c4.roles.reduce((n, row) => n + row.length, 0)

const weightOf = (art: ChartArt | null | undefined) => (art?.c4 ? cellWeight(paintedCells(art.c4)) : 1)

const c4Pictures = new Map<string, C4Picture | null>()

const pictureWeight = (key: string) => cellWeight(c4Pictures.get(key)?.size ?? 0)

const widthOf = (art: ChartArt) => (art.c4 ? c4Width(art.c4) : artWidth(art.text))

const mermaidArt = (source: string, ascii: boolean, columns: number, pieColors: number): ChartArt | null => {
  const tint = kindOf(source).toLowerCase() === 'pie' ? pieColors : 0
  const fitted = caches.fitted
  return remember(fitted, `${ascii}:${columns}:${tint}:${source}`, () => {
    source = source.replace(INLINE_TAG, '')
    if (source.length > 8000 || source.split('\n').length > MAX_LINES) return null
    if (isC4Kind(kindOf(source))) return c4Art(source, ascii, columns)
    const own = OWN[kindOf(source).toLowerCase()]
    if (own) return own(source, ascii, columns, tint)
    const art = draw(source, ascii, columns)
    const text = art === null || artWidth(art) <= columns - 2 || !SIDEWAYS.test(source) ? art : (draw(source.replace(SIDEWAYS, '$1TD'), ascii, columns) ?? art)
    return text === null ? null : { text, series: chartSeries(source, ascii, columns) }
  }, caches.limit, key => weightOf(fitted.get(key)))
}

const c4Art = (source: string, ascii: boolean, columns: number): ChartArt | null => {
  const model = c4Model(source)
  const art = model && c4Layout(model, columns, ascii, (key, make) => remember(c4Pictures, `${key}\0${source}`, make, C4_PICTURES, pictureWeight))
  return art ? { text: art.text, c4: art.paint } : null
}

const prepared = (padded: string) => unquoteCategories(padded.replace(/^(\s*%%[^\n]*\n)+/, '')).replace(/(-->|-\.->|==>|---|-\.-|===)[ \t]+\|/g, '$1|')

const NEUTRAL = '#808080'
const PROBE = { fg: NEUTRAL, border: NEUTRAL, line: NEUTRAL, arrow: NEUTRAL, corner: NEUTRAL, junction: NEUTRAL, accent: '#ff0000', bg: '#000000' }
const SGR = /\x1b\[([\d;]*)m/g

const seriesOf = (colored: string): number[][] => {
  const hues = colored.split('\n').map(line => {
    const row: (string | undefined)[] = []
    let hue: string | undefined
    let at = 0
    const take = (text: string) => graphemes(text).forEach(() => row.push(hue))
    for (const m of line.matchAll(SGR)) {
      take(line.slice(at, m.index))
      hue = m[1]!.startsWith('38;2;') && m[1] !== '38;2;128;128;128' ? m[1] : undefined
      at = m.index + m[0].length
    }
    take(line.slice(at))
    return row
  })
  const legend = hues.find(row => row.some(Boolean)) ?? []
  const order = [...new Set(legend.filter((h): h is string => h !== undefined))]
  return hues.map(row => row.map(h => (h === undefined ? -1 : order.indexOf(h))))
}

const chartSeries = (source: string, ascii: boolean, columns: number): number[][] | undefined => {
  if (!/^\s*xychart/.test(source) || (source.match(/^\s*(bar|line)\b/gm) ?? []).length < 2) return undefined
  const padded = padWide(source)
  const size = chartSize(columns, padded)
  return remember(caches.series, `${ascii}:${size.width}:${source}`, () => {
    try {
      setChartSize(size.width, size.height)
      return seriesOf(renderMermaidAscii(prepared(padded), { useAscii: ascii, colorMode: 'truecolor', theme: PROBE, paddingX: 3, paddingY: 1 }))
    } catch {
      return null
    }
  }, caches.limit) ?? undefined
}

const draw = (source: string, ascii: boolean, columns: number): string | null => {
  const isChart = /^\s*xychart/.test(source)
  const padded = padWide(source)
  const size = chartSize(columns, isChart ? padded : '')
  const key = `${ascii}:${isChart ? size.width : 0}:${source}`
  return remember(caches.texts, key, () => {
    try {
      if (isChart) setChartSize(size.width, size.height)
      const art = renderMermaidAscii(prepared(padded), { useAscii: ascii, colorMode: 'none', paddingX: 3, paddingY: 1 }).replace(/[ \t]+$/gm, '').trimEnd().replace(/▶/g, '►').replace(/◀/g, '◄')
      return (isChart ? labelBars(art, padded) : art.split('\n').filter(l => !/^[\s│|]*$/.test(l)).join('\n')).replaceAll(PAD, '')
    } catch {
      return null
    }
  }, caches.limit)
}

const LINE = /[─-╿◇▏]/
const ARROW = /[►◄▲▼]/
const PART = /[▐▏▎▍▌▋▊▉]/

const barStart = (row: string[], c: number): number => {
  const ch = row[c] ?? ''
  const solid = BLOCK.test(ch) ? ch : PART.test(ch) && row[c + 1] === '█' ? '█' : PART.test(ch) && row[c - 1] === '█' ? '█' : ''
  if (!solid) return -1
  let start = BLOCK.test(ch) ? c : row[c + 1] === '█' ? c + 1 : c - 1
  while (row[start - 1] === solid) start--
  return start
}

type Painted = { grid: string[][]; colors: (string | undefined)[][] }

export const diagramPalette = (t: Theme): string[] => [...new Set([t.link, t.number, t.heading, t.emphasis, t.path, t.codeFlag, t.accent])].filter((c): c is string => c !== undefined)

const paint = (art: string, style: Style, series?: number[][]): Painted => {
  const t = style.theme
  const grid = art.split('\n').map(cells)
  const cell = (r: number, c: number) => grid[r]?.[c] ?? ''
  const color: (string | undefined)[][] = grid.map(row => row.map(() => undefined))
  const palette = diagramPalette(t)
  const next = (i: number) => palette[i % palette.length]
  const labels = new Map<string, string | undefined>()

  const rects: { r: number; c: number; r2: number; c2: number }[] = []
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < (grid[r]?.length ?? 0); c++) {
      if (!/[┌╭(]/.test(cell(r, c))) continue
      let c2 = c + 1
      while (/[─┬┴┼▲▼]/.test(cell(r, c2))) c2++
      if (!/[┐╮)]/.test(cell(r, c2)) || c2 === c + 1) continue
      let r2 = r + 1
      while (/[│├┤┼►◄]/.test(cell(r2, c))) r2++
      if (!/[└╰(]/.test(cell(r2, c)) || !/[┘╯)]/.test(cell(r2, c2))) continue
      rects.push({ r, c, r2, c2 })
    }
  }
  const inside = (a: (typeof rects)[number], b: (typeof rects)[number]) => a !== b && b.r > a.r && b.r2 < a.r2 && b.c > a.c && b.c2 < a.c2
  for (const box of rects.filter(a => !rects.some(b => inside(a, b)))) {
    const { r, c, r2, c2 } = box
    const label = grid.slice(r + 1, r2).map(row => row.slice(c + 1, c2).join('')).join(' ').trim()
    if (!labels.has(label)) labels.set(label, next(labels.size))
    const hue = labels.get(label)
    for (let y = r; y <= r2; y++) for (let x = c; x <= c2; x++) if (cell(y, x).trim()) color[y]![x] = hue
  }

  const bars = [...new Set(grid.flatMap(row => row.flatMap((ch, c) => (BLOCK.test(ch) && row[c - 1] !== ch ? [c] : []))))].sort((a, b) => a - b)
  const ends = bars.map(x => {
    const row = grid.find(row => BLOCK.test(row[x] ?? ''))!
    let end = x
    while (row[end + 1] === row[x]) end++
    return end
  })
  const tops = bars.map(x => {
    const r = grid.findIndex(row => BLOCK.test(row[x] ?? ''))
    return r * 2 + (grid[r]![x] === '▄' ? 1 : 0)
  })
  const single = bars.length > 1 && bars.every((x, i) => i === 0 || x - ends[i - 1]! > 2)
  const barColor = (i: number) => (single ? (tops[i] === Math.min(...tops) ? t.emphasis ?? t.accent : t.quote) : next(i))
  series?.forEach((row, r) => row.forEach((owner, c) => owner >= 0 && grid[r]?.[c]?.trim() && (color[r]![c] = next(owner))))
  grid.forEach((row, r) =>
    row.forEach((ch, c) => {
      if (color[r]![c] !== undefined) return
      const start = barStart(row, c)
      if (start >= 0) color[r]![c] = barColor(bars.indexOf(start))
      else if (ch === '·') color[r]![c] = t.rule
      else if (ARROW.test(ch)) color[r]![c] = t.accent
      else if (LINE.test(ch)) color[r]![c] = t.diagram
      else if (/^\d+[┤┼]/.test(row.slice(c).join(''))) color[r]![c] = t.number
      else color[r]![c] = t.diagramText
    }),
  )
  return { grid, colors: color }
}

const paintPie = (art: string, slices: number[][], style: Style): Painted => {
  const t = style.theme
  const palette = diagramPalette(t)
  const grid = art.split('\n').map(cells)
  const hue = (slice: number) => (slice < 0 ? t.diagramText : palette[slice % palette.length])
  return { grid, colors: grid.map((row, r) => row.map((_, c) => hue(slices[r]?.[c] ?? -1))) }
}

const piePainted = new WeakMap<Theme, WeakMap<number[][], Painted>>()

const c4Painted = new WeakMap<Theme, WeakMap<C4Paint, Painted>>()

const paintC4 = (style: Style, c4: C4Paint): Painted => {
  const cache = c4Painted.get(style.theme) ?? new WeakMap<C4Paint, Painted>()
  c4Painted.set(style.theme, cache)
  const done = cache.get(c4) ?? { grid: c4Grid(c4), colors: c4Colors(c4, style.theme, diagramPalette(style.theme)) }
  cache.set(c4, done)
  return done
}

const painting = (style: Style, art: string, slices?: number[][], series?: number[][], c4?: C4Paint): Painted => {
  if (c4) return paintC4(style, c4)
  if (!slices) {
    const cache = caches.painted.get(style.theme) ?? new Map<string, Painted>()
    caches.painted.set(style.theme, cache)
    return remember(cache, art, () => paint(art, style, series), caches.limit)
  }
  const cache = piePainted.get(style.theme) ?? new WeakMap<number[][], Painted>()
  piePainted.set(style.theme, cache)
  const done = cache.get(slices) ?? paintPie(art, slices, style)
  cache.set(slices, done)
  return done
}

const artRuns = (chars: string[], hues: (string | undefined)[], marked: (Mark | undefined)[], from: number[] | undefined): Run[] => {
  const runs: Run[] = []
  const at = (p: number) => (from ? from[p]! : p)
  for (let start = 0, end = 1; start < chars.length; start = end, end = start + 1) {
    const hue = hues[at(start)]
    const mark = marked[at(start)]
    while (end < chars.length && hues[at(end)] === hue && marked[at(end)] === mark) end++
    runs.push({ text: chars.slice(start, end).join(''), look: lookOf({ color: hue, ...mark }) })
  }
  return runs
}

const UNMARKED: (Mark | undefined)[] = []

const UNCOLORED: (string | undefined)[] = []

const markedRow = (row: string[], marks: [string[], Mark][]): (Mark | undefined)[] => {
  if (!marks.length) return UNMARKED
  const marked: (Mark | undefined)[] = row.map(() => undefined)
  for (const [phrase, mark] of marks)
    for (let c = 0; c + phrase.length <= row.length; c++)
      if (phrase.every((ch, k) => row[c + k] === ch)) for (let k = 0; k < phrase.length; k++) marked[c + k] = mark
  return marked
}

const heldCells = (style: Style, row: string[], visual: boolean) => (mirrored(style) ? led(row, holdRow(row)) : style.shape === 'engine' ? holdEngine(row) : visual ? holdVisual(row) : undefined)

export const boxArt = (el: ElementTable, style: Style, art: string, key: string, marks: [string[], Mark][] = [], slices?: number[][], series?: number[][], c4?: C4Paint): RenderElement => {
  const { Box, Text } = el
  const { grid, colors } = painting(style, art, slices, series, c4)
  const visual = style.reorder && style.shape === 'visual' && hasRtl(art)
  if (c4 && !mirrored(style) && style.shape !== 'engine' && !visual) return c4Element(el, style.theme, grid, colors, c4, key, style.noteKey === undefined ? undefined : `${style.noteKey}:${key}`)
  return (
    <Box key={key} flexDirection="column" paddingLeft={mirrored(style) ? 0 : 2}>
      {grid.map((row, i) => {
        const held = heldCells(style, row, visual)
        const parts = drawRuns(Text, joinRuns(artRuns(held?.cells ?? row, colors[i] ?? UNCOLORED, markedRow(row, marks), held?.from)))
        return <Text key={`${key}.${i}`} {...heldLtr(style)}>{parts.length ? parts : ' '}</Text>
      })}
    </Box>
  )
}

const EDGE_LABEL = /(-[-.=]+\s*)"([^"\n]+)"(\s*[-.=]+>)|\|([^|\n]+)\|/g

const cap = (label: string, max: number) => {
  const flat = label.replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim()
  const chars = graphemes(flat)
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : flat
}

export const shortenEdgeLabels = (source: string, max: number): string =>
  source.replace(EDGE_LABEL, (_, open, quoted, close, piped) =>
    quoted !== undefined ? `${open}"${cap(quoted, max)}"${close}` : `|${cap(piped, max)}|`)

const leanOf = (el: ElementTable, style: Style, art: ChartArt, key: string) => (art.c4 && style.noteKey !== undefined ? { lean: () => boxArt(el, { ...style, noteKey: undefined }, art.text, key, [], undefined, undefined, art.c4) } : {})

const pieColorsOf = (style: Style) => (style.pieStyle === 'round' ? diagramPalette(style.theme).length : 0)

const PLANTUML = /^(plantuml|puml)$/i

const sourceOf = (block: Extract<Block, { kind: 'code' }>): string | undefined => {
  if (block.lang.toLowerCase() === 'mermaid') return block.lines.join('\n')
  return PLANTUML.test(block.lang) ? plantUmlC4(block.lines.join('\n')) : undefined
}

type Diagram = NonNullable<ReturnType<Drawn['get']>>

const waitsForFence = (block: Extract<Block, { kind: 'code' }>, source: string) => block.isOpen && isC4Kind(kindOf(source))

const labelLimits = (source: string) => (isC4Kind(kindOf(source)) ? [Infinity] : [Infinity, 24, 12])

const diagramOf = (el: ElementTable, style: Style, block: Extract<Block, { kind: 'code' }>, source: string, columns: number, key: string): Diagram | undefined => {
  caches = block.isOpen ? UNFINISHED : FINISHED
  if (waitsForFence(block, source)) return undefined
  const pieColors = pieColorsOf(style)
  let narrowest = Infinity
  let full: ChartArt | null = null
  for (const max of labelLimits(source)) {
    const art = mermaidArt(max === Infinity ? source : shortenEdgeLabels(source, max), style.mermaidAscii, columns, pieColors)
    if (max === Infinity) full = art
    const wide = art === null ? Infinity : widthOf(art)
    narrowest = Math.min(narrowest, wide)
    if (art !== null && wide <= columns - 2) return { element: boxArt(el, style, art.text, key, inlineMarks(source), art.slices, art.series, art.c4), art: art.text, ...leanOf(el, style, art, key) }
  }
  return block.isOpen ? undefined : { note: noteOf(source, narrowest, columns), ...(full ? { full } : {}) }
}

const noteOf = (source: string, narrowest: number, columns: number) => {
  const kind = unsupportedKind(source)
  return kind ? `${kind} diagrams draw as source for now` : narrowest === Infinity ? 'diagram failed to render' : `diagram is ${narrowest} cols, terminal is ${columns}`
}

const viewerRow = (row: string[], hues: (string | undefined)[], index: (hue?: string) => number): ViewerRun[] => {
  const runs: ViewerRun[] = []
  row.forEach((cell, c) => {
    const hue = index(hues[c])
    const text = cell === '' ? CONTINUED : cell
    const last = runs[runs.length - 1]
    if (last && last[1] === hue) last[0] += text
    else runs.push([text, hue])
  })
  return runs
}

export const viewerProps = (style: Style, art: ChartArt, view: number): ViewerProps => {
  const { grid, colors } = painting(style, art.text, art.slices, art.series, art.c4)
  const palette: string[] = []
  const index = (hue?: string) => (hue ? (palette.includes(hue) ? palette.indexOf(hue) : palette.push(hue) - 1) : -1)
  const t = style.theme
  return { rows: grid.map((row, r) => viewerRow(row, colors[r] ?? UNCOLORED, index)), palette, width: widthOf(art), view, bar: [t.accent ?? '', t.rule ?? '', t.codeComment ?? ''] }
}

const diagramAt = (el: ElementTable, style: Style, block: Block, columns: number, key: string): Diagram | undefined => {
  if (block.kind !== 'code') return undefined
  const source = sourceOf(block)
  return source === undefined ? undefined : diagramOf(el, style, block, source, columns, key)
}

export const drawDiagrams = (el: ElementTable, style: Style, blocks: Block[], columns: number): Drawn => {
  const drawn: Drawn = new Map()
  if (style.mermaid) {
    for (const [i, block] of blocks.entries()) {
      const diagram = diagramAt(el, style, block, columns, `b${i}`)
      if (diagram) drawn.set(i, diagram)
    }
    caches = FINISHED
  }
  for (const [i, block] of blocks.entries()) {
    if (block.kind !== 'code' || !isFigureLang(block.lang)) continue
    const figure = drawFigure(el, style, block, columns, `b${i}`)
    if (figure) drawn.set(i, figure)
  }
  return drawn
}
