import type { C4Element, C4Item, C4Model, C4Rel } from './c4'
import { isFrame, wrap } from './c4'
import { cells, width } from './render'

export const ROLE = { blank: 0, frame: 1, frameLabel: 2, box: 3, name: 4, line: 5, arrow: 6, number: 7, title: 8, text: 9, muted: 10 } as const

export const EXTERNAL = -2

export type C4Paint = { roles: number[][]; hues: number[][]; scopes: number[][] }
export type C4Art = { text: string; paint: C4Paint }

type Rect = { x: number; y: number; w: number; h: number }
type Placed = Rect & { item: C4Item; children: Placed[]; label: string }
type Port = { x: number; y: number; bx: number; by: number; d: number }
type Step = { x: number; y: number }
type Route = { path: Step[]; start: Port; end: Port }

const GAP_X = 6
const GAP_Y = 3
const FRAME_PAD = 2
const FRAME_TOP = 3
const MARGIN_X = 4
const MARGIN_Y = 2
const FREE = 0
const SOLID = 1
const BORDER = 2
const CELLS = 120000
const HUG = 5
const POPS = 1000000

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const
const ARROWS = ['►', '◄', '▼', '▲']
const TEES = ['├', '┤', '┬', '┴']
const GLYPHS: Record<string, string> = { lr: '─', du: '│', dr: '┌', dl: '┐', ru: '└', lu: '┘', dlr: '┬', lru: '┴', dru: '├', dlu: '┤', dlru: '┼' }
const CORNERS: Record<string, string> = { person: '╭╮╰╯', db: '╭╮╰╯', queue: '╟╢╟╢', box: '┌┐└┘', frame: '┌┐└┘' }
const ASCII: Record<string, string> = { '─': '-', '│': '|', '►': '>', '◄': '<', '▼': 'v', '▲': '^', '…': '~' }

const shows = (cell: string) => cell === '' || width(cell) > 0

const linesOf = (e: C4Element) => [...e.name, e.type, ...e.descr]

const hueOf = (e: C4Element) => (e.external ? EXTERNAL : e.id)

const measure = (item: C4Item, room: number, gap: number): Placed => {
  if (!isFrame(item)) {
    const lines = linesOf(item)
    return { x: 0, y: 0, w: Math.max(...lines.map(width)) + 4, h: lines.length + 2, item, children: [], label: '' }
  }
  const children = item.children.map(child => measure(child, room - 2 * FRAME_PAD, gap))
  const inner = pack(children, room - 2 * FRAME_PAD, gap)
  for (const child of children) shift(child, FRAME_PAD, FRAME_TOP)
  const label = wrap(item.label, Math.max(1, inner.w, room - 2 * FRAME_PAD) - 2, 1)[0] ?? ''
  return { x: 0, y: 0, w: Math.max(inner.w, width(label) + 2) + 2 * FRAME_PAD, h: inner.h + FRAME_TOP + FRAME_PAD, item, children, label }
}

const shift = (p: Placed, dx: number, dy: number) => {
  p.x += dx
  p.y += dy
  for (const child of p.children) shift(child, dx, dy)
}

const pack = (blocks: Placed[], room: number, gap: number) => {
  let x = 0
  let y = 0
  let rowH = 0
  let w = 0
  for (const b of blocks) {
    if (x > 0 && x + b.w > room) {
      x = 0
      y += rowH + GAP_Y
      rowH = 0
    }
    shift(b, x - b.x, y - b.y)
    x += b.w + gap
    rowH = Math.max(rowH, b.h)
    w = Math.max(w, b.x + b.w)
  }
  return { w, h: y + rowH }
}

type Scratch = { best: Int32Array; back: Int32Array; seen: Int32Array; arrive: Uint8Array; hug: Uint8Array; round: number; pops: number }

class Canvas {
  scratch?: Scratch
  readonly chars: string[][]
  readonly roles: number[][]
  readonly hues: number[][]
  readonly scopes: number[][]
  readonly solid: Uint8Array[]
  readonly runH: Uint8Array[]
  readonly runV: Uint8Array[]
  readonly links: string[][]

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    const grid = <T,>(make: () => T): T[] => {
      const out: T[] = []
      for (let y = 0; y < h; y++) out.push(make())
      return out
    }
    this.chars = grid(() => new Array<string>(w).fill(' '))
    this.roles = grid(() => new Array<number>(w).fill(ROLE.blank))
    this.hues = grid(() => new Array<number>(w).fill(-1))
    this.scopes = grid(() => new Array<number>(w).fill(-1))
    this.solid = grid(() => new Uint8Array(w).fill(FREE))
    this.runH = grid(() => new Uint8Array(w))
    this.runV = grid(() => new Uint8Array(w))
    this.links = grid(() => new Array<string>(w).fill(''))
  }

  inside(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h
  }

  put(x: number, y: number, ch: string, role: number, hue = -1, scope = -1) {
    if (!this.inside(x, y)) return
    this.chars[y]![x] = ch
    this.roles[y]![x] = role
    this.hues[y]![x] = hue
    this.scopes[y]![x] = scope
  }

  text(x: number, y: number, text: string, role: number, hue = -1, scope = -1) {
    let at = x
    for (const cell of cells(text)) if (shows(cell)) this.put(at++, y, cell, role, hue, scope)
    return at
  }
}

const outline = (c: Canvas, r: Rect, corners: string, role: number, hue: number) => {
  for (let x = r.x; x < r.x + r.w; x++) {
    c.put(x, r.y, '─', role, hue)
    c.put(x, r.y + r.h - 1, '─', role, hue)
  }
  for (let y = r.y; y < r.y + r.h; y++) {
    c.put(r.x, y, '│', role, hue)
    c.put(r.x + r.w - 1, y, '│', role, hue)
  }
  const [tl, tr, bl, br] = [...corners]
  c.put(r.x, r.y, tl!, role, hue)
  c.put(r.x + r.w - 1, r.y, tr!, role, hue)
  c.put(r.x, r.y + r.h - 1, bl!, role, hue)
  c.put(r.x + r.w - 1, r.y + r.h - 1, br!, role, hue)
}

const centered = (c: Canvas, r: Rect, y: number, text: string, role: number, hue: number) => c.text(r.x + Math.floor((r.w - width(text)) / 2), y, text, role, hue)

const drawFrame = (c: Canvas, p: Placed, label: string) => {
  outline(c, p, CORNERS.frame!, ROLE.frame, -1)
  for (const y of [p.y, p.y + p.h - 1]) c.solid[y]!.fill(BORDER, p.x, p.x + p.w)
  for (let y = p.y; y < p.y + p.h; y++) {
    c.solid[y]![p.x] = BORDER
    c.solid[y]![p.x + p.w - 1] = BORDER
  }
  for (const q of cornersOf(p)) c.solid[q.y]![q.x] = SOLID
  const end = centered(c, p, p.y + 1, label, ROLE.frameLabel, -1)
  for (let x = end - width(label) - 1; x <= end; x++) c.solid[p.y + 1]![x] = SOLID
}

const cornersOf = (p: Rect): Step[] => {
  const [right, bottom] = [p.x + p.w - 1, p.y + p.h - 1]
  return [[p.x, p.y, 1, 1], [right, p.y, -1, 1], [p.x, bottom, 1, -1], [right, bottom, -1, -1]].flatMap(([x, y, dx, dy]) => [{ x: x!, y: y! }, { x: x! + dx!, y: y! }, { x: x!, y: y! + dy! }])
}

const drawElement = (c: Canvas, p: Placed, e: C4Element) => {
  for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) c.solid[y]![x] = SOLID
  outline(c, p, CORNERS[e.shape]!, ROLE.box, hueOf(e))
  linesOf(e).forEach((line, i) => centered(c, p, p.y + 1 + i, line, i < e.name.length ? ROLE.name : ROLE.box, hueOf(e)))
}

const draw = (c: Canvas, placed: Placed[], boxes: Map<number, Placed>) => {
  for (const p of placed) {
    if (isFrame(p.item)) {
      drawFrame(c, p, p.label)
      draw(c, p.children, boxes)
    } else {
      drawElement(c, p, p.item)
      boxes.set(p.item.id, p)
    }
  }
}

const free = (c: Canvas, x: number, y: number) => c.inside(x, y) && c.solid[y]![x] !== SOLID && !c.runH[y]![x] && !c.runV[y]![x]

const portsOf = (c: Canvas, b: Rect): Port[] => {
  const out: Port[] = []
  for (let x = b.x + 2; x < b.x + b.w - 2; x++) {
    out.push({ x, y: b.y - 1, bx: x, by: b.y, d: 3 }, { x, y: b.y + b.h, bx: x, by: b.y + b.h - 1, d: 2 })
  }
  for (let y = b.y + 1; y < b.y + b.h - 1; y++) {
    out.push({ x: b.x - 1, y, bx: b.x, by: y, d: 1 }, { x: b.x + b.w, y, bx: b.x + b.w - 1, by: y, d: 0 })
  }
  return out.filter(p => free(c, p.x, p.y))
}

class Heap {
  private readonly costs: number[] = []
  private readonly keys: number[] = []
  get size() {
    return this.keys.length
  }
  push(cost: number, key: number) {
    const { costs, keys } = this
    let i = keys.length
    costs.push(cost)
    keys.push(key)
    while (i > 0) {
      const up = (i - 1) >> 1
      if (costs[up]! <= cost) break
      costs[i] = costs[up]!
      keys[i] = keys[up]!
      i = up
    }
    costs[i] = cost
    keys[i] = key
  }
  pop(): number {
    const { costs, keys } = this
    const top = keys[0]!
    const cost = costs.pop()!
    const key = keys.pop()!
    if (keys.length) this.sink(cost, key)
    return top
  }
  private sink(cost: number, key: number) {
    const { costs, keys } = this
    let i = 0
    for (;;) {
      const l = 2 * i + 1
      if (l >= keys.length) break
      const m = l + 1 < keys.length && costs[l + 1]! < costs[l]! ? l + 1 : l
      if (costs[m]! >= cost) break
      costs[i] = costs[m]!
      keys[i] = keys[m]!
      i = m
    }
    costs[i] = cost
    keys[i] = key
  }
}

const reversed = (a: number, b: number) => DIRS[a]![0] === -DIRS[b]![0] && DIRS[a]![1] === -DIRS[b]![1]

const stepCost = (c: Canvas, x: number, y: number, nx: number, ny: number, d: number, nd: number, shared: number): number => {
  if (!c.inside(nx, ny) || c.solid[ny]![nx] === SOLID) return Infinity
  const border = c.solid[ny]![nx] === BORDER
  if (border && (nd !== d || c.solid[y]![x] === BORDER)) return Infinity
  const along = nd < 2 ? c.runH[ny]![nx] : c.runV[ny]![nx]
  const busy = c.runH[ny]![nx] || c.runV[ny]![nx]
  if (along && !shared) return Infinity
  if (busy && nd !== d) return Infinity
  return 1 + (nd !== d ? 4 : 0) + (busy ? 8 : 0) + (border ? 6 : hugCost(c, nx, ny, nd)) + (along ? shared : 0)
}

const hugCost = (c: Canvas, x: number, y: number, d: number) => {
  const hug = c.scratch!.hug[y * c.w + x]!
  return HUG * (d > 1 ? hug & 3 : hug >> 2)
}

const hugsOf = (c: Canvas): Uint8Array => {
  const hug = new Uint8Array(c.w * c.h)
  const at = (x: number, y: number) => Number(c.solid[y]?.[x] === BORDER)
  for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) hug[y * c.w + x] = at(x - 1, y) + at(x + 1, y) + ((at(x, y - 1) + at(x, y + 1)) << 2)
  return hug
}

const toward = (b: Rect, x: number, y: number) => Math.max(0, b.x - x, x - (b.x + b.w)) + Math.max(0, b.y - y, y - (b.y + b.h))

type Frontier = { c: Canvas; s: Scratch; to: Rect; shared: number; heap: Heap }

const scratchOf = (c: Canvas): Scratch => {
  const states = c.w * c.h * 4
  c.scratch ??= { best: new Int32Array(states), back: new Int32Array(states), seen: new Int32Array(states), arrive: new Uint8Array(c.w * c.h), hug: hugsOf(c), round: 0, pops: 0 }
  return c.scratch
}

const expand = ({ c, s, to, shared, heap }: Frontier, k: number, x: number, y: number, d: number) => {
  for (let nd = 0; nd < 4; nd++) {
    if (reversed(nd, d)) continue
    const nx = x + DIRS[nd]![0]
    const ny = y + DIRS[nd]![1]
    const step = stepCost(c, x, y, nx, ny, d, nd, shared)
    const cell = ny * c.w + nx
    if (step === Infinity || (s.arrive[cell] && s.arrive[cell] !== nd + 1)) continue
    const nk = cell * 4 + nd
    const next = s.best[k]! + step
    if (s.seen[nk]! > s.round || (s.seen[nk] === s.round && s.best[nk]! <= next)) continue
    s.seen[nk] = s.round
    s.best[nk] = next
    s.back[nk] = k
    heap.push(next + toward(to, nx, ny), nk)
  }
}

const explore = (c: Canvas, s: Scratch, starts: Port[], to: Rect, shared: number): number => {
  s.round += 2
  const heap = new Heap()
  starts.forEach((p, i) => {
    const k = (p.y * c.w + p.x) * 4 + p.d
    s.seen[k] = s.round
    s.best[k] = 0
    s.back[k] = -2 - i
    heap.push(toward(to, p.x, p.y), k)
  })
  const frontier: Frontier = { c, s, to, shared, heap }
  while (heap.size && s.pops++ < POPS) {
    const k = heap.pop()
    if (s.seen[k] !== s.round) continue
    s.seen[k] = s.round + 1
    const d = k & 3
    const cell = k >> 2
    if (s.arrive[cell] === d + 1) return k
    expand(frontier, k, cell % c.w, Math.floor(cell / c.w), d)
  }
  return -1
}

const search = (c: Canvas, from: Rect, to: Rect, shared: number): Route | null => {
  const s = scratchOf(c)
  const starts = portsOf(c, from)
  const goals = portsOf(c, to)
  if (s.pops >= POPS || !starts.length || !goals.length) return null
  for (const g of goals) s.arrive[g.y * c.w + g.x] = (g.d ^ 1) + 1
  const k = explore(c, s, starts, to, shared)
  for (const g of goals) s.arrive[g.y * c.w + g.x] = 0
  return k < 0 ? null : trace(c, s.back, starts, k, goals.find(g => g.y * c.w + g.x === k >> 2)!)
}

const trace = (c: Canvas, back: Int32Array, starts: Port[], k: number, end: Port): Route => {
  const path: Step[] = []
  for (let at = k; ; ) {
    const cell = at >> 2
    path.push({ x: cell % c.w, y: Math.floor(cell / c.w) })
    const prev = back[at]!
    if (prev < -1) return { path: path.reverse(), start: starts[-2 - prev]!, end }
    at = prev
  }
}

const side = (p: Step, q: Step) => (q.x > p.x ? 'r' : q.x < p.x ? 'l' : q.y > p.y ? 'd' : 'u')

const lay = (c: Canvas, route: Route) => {
  const { path, start, end } = route
  path.forEach((p, j) => {
    const before = j ? path[j - 1]! : { x: start.bx, y: start.by }
    const after = j < path.length - 1 ? path[j + 1]! : { x: end.bx, y: end.by }
    c.links[p.y]![p.x] += side(p, before) + side(p, after)
    if (!(before.x === p.x && after.x === p.x)) c.runH[p.y]![p.x] = 1
    if (!(before.y === p.y && after.y === p.y)) c.runV[p.y]![p.x] = 1
  })
  for (const end of [path[0]!, path.at(-1)!]) c.solid[end.y]![end.x] = SOLID
}

const glyphAt = (links: string) => GLYPHS[[...new Set(links)].sort().join('')] ?? (/[lr]/.test(links) ? '─' : '│')

type Wire = { from: number; to: number; both: boolean; rels: number[] }

const wiresOf = (rels: C4Rel[]): Wire[] => {
  const wires = new Map<string, Wire>()
  rels.forEach((rel, i) => {
    if (rel.from === rel.to) return
    const key = `${rel.from}>${rel.to}>${rel.both}`
    const wire = wires.get(key) ?? { from: rel.from, to: rel.to, both: rel.both, rels: [] }
    wire.rels.push(i)
    wires.set(key, wire)
  })
  return [...wires.values()]
}

const ink = (c: Canvas, routes: (Route | null)[]) => {
  routes.forEach((route, i) => {
    for (const p of route?.path ?? []) c.put(p.x, p.y, glyphAt(c.links[p.y]![p.x]!), ROLE.line, -1, i)
  })
}

const arrowAt = (c: Canvas, cell: Step, port: Port, i: number) => {
  const d = DIRS.findIndex(([dx, dy]) => dx === port.bx - cell.x && dy === port.by - cell.y)
  c.put(cell.x, cell.y, ARROWS[d]!, ROLE.arrow, -1, i)
}

const quiet = (c: Canvas, x: number, y: number, len: number) => {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= len; dx++) if (/[\d,►◄▼▲]/.test(c.chars[y + dy]?.[x + dx] ?? '')) return false
  return true
}

const along = (path: Step[], j: number, len: number) => {
  const run = path.slice(j - 1, j + len + 1)
  if (run.length < len + 2) return undefined
  if (run.every(q => q.y === path[j]!.y)) return 'h'
  return run.every(q => q.x === path[j]!.x) ? 'v' : undefined
}

const NUMERAL = /[\d,]/

const apart = (c: Canvas, x: number, y: number, len: number) => !NUMERAL.test(c.chars[y]![x - 1] ?? '') && !NUMERAL.test(c.chars[y]![x + len] ?? '')

const leftmost = (path: Step[], j: number, len: number) => Math.min(...path.slice(j, j + len).map(q => q.x))

const onLine = (c: Canvas, path: Step[], j: number, len: number, strict: boolean) => {
  const way = along(path, j, len)
  if (!way || j === 0 || (way === 'v' && len > 1)) return false
  const cells = path.slice(strict ? j - 1 : j, j + len + (strict ? 1 : 0))
  if (!cells.every(q => c.links[q.y]![q.x]!.length === 2 && c.solid[q.y]![q.x] !== BORDER)) return false
  const x = leftmost(path, j, len)
  return strict ? quiet(c, x, path[j]!.y, len) : apart(c, x, path[j]!.y, len)
}

const open = (c: Canvas, x: number, y: number, len: number) => {
  for (let k = 0; k < len; k++) if (!c.inside(x + k, y) || c.chars[y]![x + k] !== ' ' || c.solid[y]![x + k] !== FREE || c.runH[y]![x + k] || c.runV[y]![x + k]) return false
  return quiet(c, x, y, len)
}

const besideAt = (c: Canvas, path: Step[], j: number, len: number): Step | undefined => {
  const p = path[j]!
  const way = along(path, j, 1)
  const spots = way === 'v' ? [2, 1, 3].flatMap(gap => [{ x: p.x + gap, y: p.y }, { x: p.x - len - gap + 1, y: p.y }]) : way === 'h' ? [-1, 1].flatMap(dy => [0, -len, 1].map(dx => ({ x: p.x + dx, y: p.y + dy }))) : []
  return spots.find(q => open(c, q.x, q.y, len))
}

const around = (p: Step, len: number): Step[] => [1, 2].flatMap(gap => [{ x: p.x + gap, y: p.y }, { x: p.x - len - gap + 1, y: p.y }, { x: p.x, y: p.y - gap }, { x: p.x, y: p.y + gap }])

const middleOut = (length: number) => Array.from({ length }, (_, j) => j).sort((a, b) => Math.abs(a - length / 2) - Math.abs(b - length / 2))

const spotOf = (c: Canvas, path: Step[], len: number): Step | undefined => {
  const order = middleOut(path.length)
  for (const strict of [true, false]) {
    const at = order.find(j => onLine(c, path, j, len, strict))
    if (at !== undefined) return { x: leftmost(path, at, len), y: path[at]!.y }
  }
  for (const j of order) {
    const spot = besideAt(c, path, j, len)
    if (spot) return spot
  }
  return order.flatMap(j => around(path[j]!, len)).find(q => open(c, q.x, q.y, len))
}

const numbered = (c: Canvas, route: Route, label: string, i: number) => {
  const spot = spotOf(c, route.path, label.length)
  if (spot) c.text(spot.x, spot.y, label, ROLE.number, -1, i)
  return spot !== undefined
}

const finish = (c: Canvas, wires: Wire[], routes: (Route | null)[]): number[] => {
  routes.forEach((route, i) => {
    if (!route) return
    if (wires[i]!.both) arrowAt(c, route.path[0]!, route.start, i)
    else c.put(route.start.bx, route.start.by, TEES[route.start.d]!, ROLE.line, -1, i)
    arrowAt(c, route.path.at(-1)!, route.end, i)
  })
  return routes.flatMap((route, i) => (route && !numbered(c, route, labelOf(wires[i]!), i) ? [i] : []))
}

const routeAll = (c: Canvas, wires: Wire[], boxes: Map<number, Placed>): (Route | null)[] =>
  wires.map(wire => {
    const from = boxes.get(wire.from)!
    const to = boxes.get(wire.to)!
    const route = search(c, from, to, 0) ?? search(c, from, to, 30)
    if (route) lay(c, route)
    return route
  })

type Rows = { chars: string[][]; roles: number[][]; hues: number[][]; scopes: number[][] }

const cropped = (c: Canvas): Rows => {
  const used = (y: number) => c.chars[y]!.some(ch => ch !== ' ')
  const top = c.chars.findIndex((_, y) => used(y))
  const bottom = c.chars.findLastIndex((_, y) => used(y))
  const left = Math.min(...c.chars.map(row => row.findIndex(ch => ch !== ' ')).filter(x => x >= 0))
  const take = <T,>(grid: T[][]) => grid.slice(top, bottom + 1).map(row => row.slice(left))
  return { chars: take(c.chars), roles: take(c.roles), hues: take(c.hues), scopes: take(c.scopes) }
}

const emptyRow = (): Rows => ({ chars: [[]], roles: [[]], hues: [[]], scopes: [[]] })

const append = (line: Rows, text: string, role: number, hue: number, scope: number) => {
  for (const cell of cells(text)) {
    if (!shows(cell)) continue
    line.chars[0]!.push(cell)
    line.roles[0]!.push(role)
    line.hues[0]!.push(hue)
    line.scopes[0]!.push(scope)
  }
}

const textRow = (text: string, role: number, hue = -1, scope = -1): Rows => {
  const line = emptyRow()
  append(line, text, role, hue, scope)
  return line
}

const joinRows = (...parts: Rows[]): Rows => ({
  chars: parts.flatMap(p => p.chars),
  roles: parts.flatMap(p => p.roles),
  hues: parts.flatMap(p => p.hues),
  scopes: parts.flatMap(p => p.scopes),
})

type Word = { text: string; role: number; hue: number; gap: number }

const wordsOf = (text: string, role: number, hue: number, gap: number): Word[] => text.split(/\s+/).filter(Boolean).map((word, i) => ({ text: word, role, hue, gap: i ? 1 : gap }))

const chunks = (text: string, size: number): string[] => {
  const all = cells(text)
  const out: string[] = []
  for (let at = 0; at < all.length; at += size) out.push(all.slice(at, at + size).join(''))
  return out
}

const legendWords = (model: C4Model, rel: C4Rel, ascii: boolean, text: number): Word[] => {
  const from = model.elements[rel.from]!
  const to = model.elements[rel.to]!
  const arrow = ascii ? (rel.both ? '<->' : '->') : rel.both ? '↔' : '→'
  return [...wordsOf(from.name.join(' '), ROLE.name, hueOf(from), 0), { text: arrow, role: text, hue: -1, gap: 1 }, ...wordsOf(to.name.join(' '), ROLE.name, hueOf(to), 1), ...wordsOf(rel.label, text, -1, 2)]
}

const legendEntry = (model: C4Model, rel: C4Rel, i: number, room: number, scope: number, ascii: boolean): Rows => {
  const number = ` ${String(i + 1).padStart(String(model.rels.length).length)}  `
  const indent = width(number)
  const lines = [textRow(number, ROLE.number, -1, scope)]
  for (const word of legendWords(model, rel, ascii, scope < 0 ? ROLE.muted : ROLE.text)) {
    for (const piece of chunks(word.text, Math.max(8, room - indent))) {
      const line = lines.at(-1)!
      const used = line.chars[0]!.length
      if (used > indent && used + word.gap + width(piece) > room) lines.push(textRow(' '.repeat(indent), ROLE.text, -1, scope))
      const current = lines.at(-1)!
      if (current.chars[0]!.length > indent) append(current, ' '.repeat(word.gap), ROLE.text, -1, scope)
      append(current, piece, word.role, word.hue, scope)
    }
  }
  return joinRows(...lines)
}

const asciiRows = (rows: Rows): Rows => ({ ...rows, chars: rows.chars.map(r => r.map(ch => ASCII[ch] ?? (/[┌┐└┘├┤┬┴┼╭╮╰╯╟╢]/.test(ch) ? '+' : ch))) })

type Blank = () => { c: Canvas; boxes: Map<number, Placed> }

const inked = (blank: Blank, c: Canvas, wires: Wire[], routes: (Route | null)[]): { art: Rows; routes: (Route | null)[] } => {
  ink(c, routes)
  const lost = finish(c, wires, routes)
  if (!lost.length) return { art: cropped(c), routes }
  const kept = routes.map((route, i) => (lost.includes(i) ? null : route))
  const next = blank().c
  for (const route of kept) if (route) lay(next, route)
  return inked(blank, next, wires, kept)
}

type Layout = { placed: Placed[]; w: number; h: number }

const laid = (model: C4Model, room: number, gap: number): Layout => {
  const placed = model.items.map(item => measure(item, room, gap))
  return { placed, ...pack(placed, room, gap) }
}

const picture = (layout: Layout, wires: Wire[]) => {
  const w = layout.w + 2 * MARGIN_X
  const h = layout.h + 2 * MARGIN_Y
  if (w * h > CELLS) return null
  for (const p of layout.placed) shift(p, MARGIN_X, MARGIN_Y)
  const blank = () => {
    const c = new Canvas(w, h)
    const boxes = new Map<number, Placed>()
    draw(c, layout.placed, boxes)
    return { c, boxes }
  }
  const { c, boxes } = blank()
  return inked(blank, c, wires, routeAll(c, wires, boxes))
}

const widest = (rows: Rows) => Math.max(0, ...rows.chars.map(r => r.length))

const assemble = (model: C4Model, columns: number, layout: Layout, wires: Wire[], ascii: boolean): Rows | null => {
  const drawn = picture(layout, wires)
  if (!drawn) return null
  const { art, routes } = drawn
  const scopeOf = new Map(wires.flatMap((wire, w) => (routes[w] ? wire.rels.map(r => [r, w] as const) : [])))
  const legendRoom = Math.min(columns - 2, Math.max(widest(art), 60))
  const legend = model.rels.map((rel, i) => legendEntry(model, rel, i, legendRoom, scopeOf.get(i) ?? -1, ascii))
  const title = wrap(model.title ?? '', Math.max(1, columns - 2), Infinity).map(line => textRow(line, ROLE.title))
  const parts = [...title, art, ...(legend.length ? [emptyRow(), ...legend] : [])]
  return ascii ? asciiRows(joinRows(...parts)) : joinRows(...parts)
}

const labelOf = (wire: Wire) => wire.rels.map(r => r + 1).join(',')

export const c4Layout = (model: C4Model, columns: number, ascii: boolean): C4Art | null => {
  const wires = wiresOf(model.rels)
  const gap = Math.max(GAP_X, ...wires.map(wire => labelOf(wire).length + 4))
  const wide = laid(model, Math.max(20, columns - 2), gap)
  const layout = wide.w + 2 * MARGIN_X <= columns - 2 ? wide : laid(model, Math.max(20, columns - 2 - 2 * MARGIN_X), gap)
  const rows = assemble(model, columns, layout, layout.w <= columns - 2 ? wires : [], ascii)
  return rows && { text: rows.chars.map(r => r.join('').trimEnd()).join('\n'), paint: { roles: rows.roles, hues: rows.hues, scopes: rows.scopes } }
}
