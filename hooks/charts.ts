import { graphemes, width } from './render'

const DAY = 86400000
const STEPS = [1, 5, 15, 30, 60, 120, 360, 720, 1440, 2880, 10080, 20160, 43200, 129600, 525600].map(m => m * 60000)
const UNIT: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000, d: DAY, w: 7 * DAY }
const TAGS = /^(done|active|crit|milestone)$/i
const IGNORED = /^(dateformat|axisformat|tickinterval|excludes|includes|todaymarker|weekday|weekend|inclusiveenddates|topaxis|displaymode|acctitle|accdescr|click)\b/i

const body = (source: string) => source.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('%%'))

const fit = (label: string, max: number) => {
  if (width(label) <= max) return label
  let out = ''
  for (const g of graphemes(label)) {
    if (width(out + g) > max - 1) break
    out += g
  }
  return `${out.trimEnd()}…`
}

const pad = (text: string, size: number) => text + ' '.repeat(Math.max(0, size - width(text)))

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

export type ChartArt = { text: string; slices?: number[][]; series?: number[][] }

const QUADRANTS = ' ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█'

type Slice = { label: string; text: string; value: number }

const quadrantCell = (sliceAt: (x: number, y: number) => number, cx: number, cy: number): [string, number] => {
  let mask = 0
  const votes = new Map<number, number>()
  for (const [bit, sx, sy] of [[1, 0, 0], [2, 1, 0], [4, 0, 1], [8, 1, 1]] as const) {
    const slice = sliceAt(cx + (sx + 0.5) / 2, 2 * cy + sy + 0.5)
    if (slice < 0) continue
    mask |= bit
    votes.set(slice, (votes.get(slice) ?? 0) + 1)
  }
  return [QUADRANTS[mask]!, mask ? [...votes].sort((a, b) => b[1] - a[1])[0]![0] : -1]
}

const roundPie = (colors: number, title: string | undefined, slices: Slice[], legend: string[], columns: number): ChartArt | null => {
  const radius = Math.min(6, Math.floor((columns - 10 - Math.max(...legend.map(width))) / 4))
  if (radius < 4 || slices.length > colors) return null
  const total = slices.reduce((sum, s) => sum + s.value, 0)
  let seen = 0
  const bounds = slices.map(s => (seen += s.value / total))
  const sliceAt = (x: number, y: number) => {
    const dx = x - 2 * radius
    const dy = y - 2 * radius
    if (dx * dx + dy * dy > 4 * radius * radius) return -1
    const turn = (Math.atan2(dx, -dy) / (2 * Math.PI) + 1) % 1
    return bounds.findIndex(b => turn < b)
  }
  const cells = Array.from({ length: 2 * radius }, (_, cy) => Array.from({ length: 4 * radius }, (_, cx) => quadrantCell(sliceAt, cx, cy)))
  const rows = cells.map(row => row.map(([glyph]) => glyph).join(''))
  const hues = cells.map(row => row.map(([, hue]) => hue))
  const offset = Math.floor((rows.length - legend.length) / 2)
  legend.forEach((line, i) => {
    rows[offset + i] += `   ██ ${line}`
    hues[offset + i]!.push(-1, -1, -1, i, i)
  })
  return { text: [...(title ? [title.trim()] : []), ...rows.map(r => r.trimEnd())].join('\n'), slices: [...(title ? [[]] : []), ...hues] }
}

const shares = (slices: Slice[], showData: boolean): { label: string; tail: string }[] => {
  const total = slices.reduce((sum, s) => sum + s.value, 0)
  const labelWidth = Math.max(...slices.map(s => width(s.label)))
  const percents = slices.map(s => {
    const pct = Math.round((s.value / total) * 100)
    return `${pct === 0 && s.value > 0 ? '<1' : pct}%`
  })
  const valueWidth = Math.max(...slices.map(s => s.text.length))
  const pctWidth = Math.max(...percents.map(p => p.length))
  return slices.map((s, i) => ({ label: pad(s.label, labelWidth), tail: `${showData ? `${s.text.padStart(valueWidth)}  ` : ''}${percents[i]!.padStart(pctWidth)}` }))
}

const barPie = (slices: Slice[], rows: { label: string; tail: string }[], ascii: boolean, columns: number): string[] => {
  const max = slices[0]!.value
  const bar = clamp(columns - 6 - width(rows[0]!.label) - width(rows[0]!.tail), 8, 40)
  return slices.map((s, i) => {
    const cells = s.value > 0 ? Math.max(1, Math.round((s.value / max) * bar)) : 0
    return `${rows[i]!.label}  ${(ascii ? '#' : '█').repeat(cells).padEnd(bar)} ${rows[i]!.tail}`
  })
}

const pieLines = (lines: string[], heading: string | undefined, data: boolean): { title?: string; showData: boolean; slices: Slice[] } | null => {
  let title = heading
  let showData = data
  const slices: Slice[] = []
  for (const line of lines) {
    const named = /^title\s+(.*)$/i.exec(line)
    if (named) title = named[1]
    else if (/^showData$/i.test(line)) showData = true
    else if (!/^acc(Title|Descr)\b/.test(line)) {
      const slice = /^"([^"]*)"\s*:\s*([\d.]+)$/.exec(line)
      const value = Number(slice?.[2])
      if (!slice || !Number.isFinite(value)) return null
      slices.push({ label: fit(slice[1]!, 20), text: slice[2]!, value })
    }
  }
  return slices.reduce((sum, s) => sum + s.value, 0) > 0 ? { title, showData, slices } : null
}

export const pieText = (source: string, ascii: boolean, columns: number, colors = 0): ChartArt | null => {
  const [first = '', ...rest] = body(source)
  const head = /^pie\b(\s+showData)?(?:\s+title\s+(.*))?$/i.exec(first)
  if (!head) return null
  const parsed = pieLines(rest, head[2], !!head[1])
  if (!parsed) return null
  const { title, showData, slices } = parsed
  slices.sort((a, b) => b.value - a.value)
  const rows = shares(slices, showData)
  return roundPie(ascii ? 0 : colors, title, slices, rows.map(r => `${r.label} ${r.tail}`), columns) ?? { text: [...(title ? [title.trim()] : []), ...barPie(slices, rows, ascii, columns)].join('\n') }
}

const dateParser = (format: string) => {
  if (/[A-Za-z]/.test(format.replace(/YYYY|MM|DD|HH|mm|ss/g, ''))) return null
  const order: string[] = []
  const pattern = format.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/YYYY|MM|DD|HH|mm|ss/g, token => {
    order.push(token)
    return token === 'YYYY' ? '(\\d{4})' : '(\\d{1,2})'
  })
  const exact = new RegExp(`^${pattern}$`)
  return (text: string): number | undefined => {
    const m = exact.exec(text)
    if (!m) return undefined
    const part = (token: string, fallback: number) => (order.includes(token) ? Number(m[order.indexOf(token) + 1]) : fallback)
    return Date.UTC(part('YYYY', 1970), part('MM', 1) - 1, part('DD', 1), part('HH', 0), part('mm', 0), part('ss', 0))
  }
}

const stamp = (t: number, span: number, sameYear: boolean) => {
  const iso = new Date(t).toISOString()
  return span < 2 * DAY ? iso.slice(11, 16) : sameYear ? iso.slice(5, 10) : iso.slice(0, 10)
}

const EIGHTHS = ' ▏▎▍▌▋▊▉'

const fineBar = (from: number, to: number, fallback: number) => {
  const half = from % 1 >= 0.25 && from % 1 < 0.75
  const start = half ? Math.floor(from) + 1 : Math.round(from)
  const eighths = Math.round(to * 8)
  const whole = Math.floor(eighths / 8) - start
  if (whole < 1) return ' '.repeat(fallback) + '█'
  return ' '.repeat(start - (half ? 1 : 0)) + (half ? '▐' : '') + '█'.repeat(whole) + (eighths % 8 > 1 ? EIGHTHS[eighths % 8]! : '')
}

export const ganttText = (source: string, ascii: boolean, columns: number): string | null => {
  const [first = '', ...rest] = body(source)
  if (!/^gantt$/i.test(first)) return null
  const format = /^dateFormat\s+(.+)$/im.exec(rest.join('\n'))?.[1]?.trim() ?? 'YYYY-MM-DD'
  const parse = dateParser(format)
  if (!parse) return null
  let title: string | undefined
  const rows: ({ section: string } | { name: string; start: number; end: number; milestone: boolean })[] = []
  const ends = new Map<string, { start: number; end: number }>()
  let previous: number | undefined
  for (const line of rest) {
    const named = /^title\s+(.*)$/i.exec(line)
    const section = /^section\s+(.*)$/i.exec(line)
    if (named) title = named[1]
    else if (section) rows.push({ section: fit(section[1]!.trim(), 24) })
    else if (!IGNORED.test(line)) {
      const colon = line.indexOf(':')
      if (colon < 1) return null
      const items = line.slice(colon + 1).split(',').map(s => s.trim())
      let milestone = false
      while (items.length > 1 && TAGS.test(items[0]!)) milestone = /milestone/i.test(items.shift()!) || milestone
      if (items.length > 3) return null
      const [id, from, to] = items.length === 3 ? items : items.length === 2 ? [undefined, ...items] : [undefined, undefined, items[0]]
      const after = /^after\s+(.+)$/i.exec(from ?? '')
      const start = from === undefined ? previous : after ? Math.max(...after[1]!.split(/\s+/).map(ref => ends.get(ref)?.end ?? NaN)) : parse(from)
      if (start === undefined || !Number.isFinite(start)) return null
      const duration = /^(\d+(?:\.\d+)?)(ms|s|m|h|d|w)$/.exec(to ?? '')
      const until = /^until\s+(\S+)$/i.exec(to ?? '')
      const end = duration ? start + Number(duration[1]) * UNIT[duration[2]!]! : until ? ends.get(until[1]!)?.start : parse(to ?? '')
      if (end === undefined || end < start) return null
      if (id) ends.set(id, { start, end })
      previous = end
      rows.push({ name: fit(line.slice(0, colon).trim(), 22), start, end, milestone })
    }
  }
  const tasks = rows.flatMap(r => ('name' in r ? [r] : []))
  if (!tasks.length) return null
  const min = Math.min(...tasks.map(t => t.start))
  const max = Math.max(...tasks.map(t => t.end))
  const span = max - min || DAY
  const sameYear = new Date(min).getUTCFullYear() === new Date(max).getUTCFullYear()
  const labelWidth = Math.max(...rows.map(r => ('name' in r ? width(r.name) + 2 : width(r.section))))
  const chart = clamp(columns - 6 - labelWidth, 10, 60)
  const col = (t: number) => Math.round(((t - min) / span) * chart)
  const tickText = stamp(min, span, sameYear).length
  const room = Math.max(1, Math.floor(chart / (tickText + 3)))
  const step = STEPS.find(ms => span / ms <= room) ?? span
  const ticks = Array.from({ length: Math.floor(span / step) + 1 }, (_, i) => min + i * step)
  const axis = [...(ascii ? '-' : '─').repeat(chart + 1)]
  const labels = [...' '.repeat(chart + 1)]
  let free = 0
  for (const t of ticks) {
    const at = col(t)
    axis[at] = ascii ? '|' : '▏'
    const text = stamp(t, span, sameYear)
    const from = Math.min(at, chart + 1 - text.length)
    if (from < free) continue
    labels.splice(from, text.length, ...text)
    free = from + text.length + 1
  }
  const lead = ' '.repeat(labelWidth + 2)
  const lines = rows.map(r => {
    if (!('name' in r)) return r.section
    const a = Math.min(col(r.start), chart - 1)
    const cells = r.milestone ? (ascii ? '*' : '◆') : ascii ? '#'.repeat(Math.max(1, col(r.end) - a)) : null
    return `${pad(`  ${r.name}`, labelWidth)}  ${cells === null ? fineBar(((r.start - min) / span) * chart, ((r.end - min) / span) * chart, a) : ' '.repeat(a) + cells}`
  })
  return [...(title ? [title.trim()] : []), lead + labels.join('').trimEnd(), lead + axis.join(''), ...lines].join('\n')
}
