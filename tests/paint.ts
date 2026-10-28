export type Paint = {
  color?: string
  backgroundColor?: string
  href?: string
  bold?: true
  italic?: true
  underline?: true
  strikethrough?: true
  dimColor?: true
  inverse?: true
}

export type PaintRun = { text: string; paint: Paint }

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

type Cell = { ch: string; paint: Paint }

type Line = { cells: Cell[]; base: Paint }

const FLAGS = ['bold', 'italic', 'underline', 'strikethrough', 'dimColor', 'inverse'] as const

const BLANK = /\s/

const inner = (paint: Paint, props: Record<string, unknown>): Paint => {
  const out: Paint = { ...paint }
  if (typeof props.color === 'string') out.color = props.color
  if (typeof props.backgroundColor === 'string') out.backgroundColor = props.backgroundColor
  for (const flag of FLAGS) if (props[flag] === true) out[flag] = true
  return out
}

const textCells = (node: unknown, paint: Paint, out: Cell[]): void => {
  if (typeof node === 'string' || typeof node === 'number') {
    const text = String(node)
    for (let i = 0; i < text.length; i++) out.push({ ch: text[i]!, paint })
    return
  }
  if (Array.isArray(node)) {
    for (const child of node) textCells(child, paint, out)
    return
  }
  if (node === null || typeof node !== 'object') return
  const { type, props = {}, children = [] } = node as Node
  if (type === 'Link') {
    const linked = { ...paint, href: String(props.href) }
    textCells(children.length ? children : String(props.label ?? props.href), linked, out)
    return
  }
  textCells(children, type === 'Text' ? inner(paint, props) : paint, out)
}

const linesOf = (node: unknown, paint: Paint, out: Line[]): Line[] => {
  if (Array.isArray(node)) {
    for (const child of node) linesOf(child, paint, out)
    return out
  }
  if (node === null || typeof node !== 'object') return out
  const { type, props = {}, children = [] } = node as Node
  if (type === 'Text' || type === 'Link') {
    const cells: Cell[] = []
    textCells(node, paint, cells)
    out.push({ cells, base: type === 'Text' ? inner(paint, props) : paint })
    return out
  }
  return linesOf(children, typeof props.backgroundColor === 'string' ? { ...paint, backgroundColor: props.backgroundColor } : paint, out)
}

const canonical = (paint: Paint): string => JSON.stringify(Object.entries(paint).sort(([a], [b]) => a.localeCompare(b)))

const same = (a: Paint, b: Paint): boolean => a === b || canonical(a) === canonical(b)

const textOf = (line: Line): string => line.cells.map(c => c.ch).join('')

const spans = (text: string, needle: string | RegExp): [number, number][] => {
  if (typeof needle === 'string') {
    const out: [number, number][] = []
    for (let at = text.indexOf(needle); needle && at >= 0; at = text.indexOf(needle, at + needle.length)) out.push([at, at + needle.length])
    return out
  }
  const global = new RegExp(needle.source, needle.flags.includes('g') ? needle.flags : `${needle.flags}g`)
  return [...text.matchAll(global)].filter(m => m[0] !== '').map(m => [m.index, m.index + m[0].length])
}

const runsOfLine = (cells: Cell[], spaced: boolean): PaintRun[] => {
  const runs: PaintRun[] = []
  let open: PaintRun | undefined
  let gap = ''
  for (const cell of cells) {
    if (BLANK.test(cell.ch)) {
      if (spaced && open) gap += cell.ch
      else open = undefined
      continue
    }
    if (open && same(open.paint, cell.paint)) open.text += gap + cell.ch
    else runs.push((open = { text: cell.ch, paint: cell.paint }))
    gap = ''
  }
  return runs
}

export const paintsIn = (tree: unknown, needle: string | RegExp): Paint[] =>
  linesOf(tree, {}, []).flatMap(line =>
    spans(textOf(line), needle).flatMap(([a, b]) => {
      const solid = line.cells.slice(a, b).filter(c => !BLANK.test(c.ch))
      const first = solid[0]?.paint
      return first && solid.every(c => same(c.paint, first)) ? [first] : []
    }))

export const runsIn = (tree: unknown): PaintRun[] => linesOf(tree, {}, []).flatMap(line => runsOfLine(line.cells, false))

export const shownLinesIn = (tree: unknown): string[] => linesOf(tree, {}, []).flatMap(line => textOf(line).split('\n'))

const textLine = (node: unknown, text: RegExp, paint: Paint): Line | undefined => {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = textLine(child, text, paint)
      if (found) return found
    }
    return undefined
  }
  if (node === null || typeof node !== 'object') return undefined
  const { type, props = {}, children = [] } = node as Node
  const own = type === 'Text' ? inner(paint, props) : typeof props.backgroundColor === 'string' ? { ...paint, backgroundColor: props.backgroundColor } : paint
  if (type === 'Text') {
    const cells: Cell[] = []
    textCells(node, paint, cells)
    if (text.test(cells.map(c => c.ch).join(''))) return { cells, base: own }
  }
  return textLine(children, text, own)
}

export const tokensIn = (tree: unknown, text: RegExp): PaintRun[] => {
  const line = textLine(tree, text, {})
  return line ? runsOfLine(line.cells, true).filter(run => !same(run.paint, line.base)) : []
}

type Drawing = { drawn: () => Promise<unknown> }

export const paintsOf = async (ui: Drawing, needle: string | RegExp): Promise<Paint[]> => paintsIn(await ui.drawn(), needle)

export const paintOf = async (ui: Drawing, needle: string | RegExp): Promise<Paint | undefined> => (await paintsOf(ui, needle))[0]

export const runsOf = async (ui: Drawing, text?: RegExp): Promise<PaintRun[]> => runsIn(await ui.drawn()).filter(run => !text || text.test(run.text))

export const shownLines = async (ui: Drawing): Promise<string[]> => shownLinesIn(await ui.drawn())

export const tokensOf = async (ui: Drawing, line: RegExp): Promise<PaintRun[]> => tokensIn(await ui.drawn(), line)
