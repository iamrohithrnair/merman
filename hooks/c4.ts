import { cells, width } from './render'

export type C4Shape = 'person' | 'db' | 'queue' | 'box'
export type C4Element = { id: number; name: string[]; type: string; descr: string[]; shape: C4Shape; external: boolean }
export type C4Frame = { label: string; children: C4Item[] }
export type C4Item = C4Element | C4Frame
export type C4Rel = { from: number; to: number; label: string; both: boolean }
export type C4Model = { title?: string; items: C4Item[]; rels: C4Rel[]; elements: C4Element[] }

type Args = Record<string, string | undefined>
type Open = { frame: C4Frame; alias: string }

type State = {
  title?: string
  ids: Map<string, number>
  elements: C4Element[]
  root: C4Item[]
  stack: Open[]
  pending?: Open
  rels: [Args, string][]
  broken: boolean
}

const KIND = /^c4(context|container|component|dynamic|deployment)$/i

export const isC4Kind = (kind: string) => KIND.test(kind)

export const isFrame = (item: C4Item): item is C4Frame => 'children' in item

const ELEMENT = /^(person|system|container|component)(db|queue)?(_ext)?$/i
const BOUNDARY = /^(boundary|enterprise_boundary|system_boundary|container_boundary|deployment_node|node|node_l|node_r)$/i
const REL = /^(rel|birel|relindex|rel_(u|up|d|down|l|left|r|right|back))$/i
const STATEMENT = /^(\w+)\s*\((.*)\)$/
const TYPED_BOUNDARY = /^(boundary|deployment_node|node|node_l|node_r)$/i

const SLOTS: Record<string, string[]> = {
  person: ['alias', 'label', 'descr'],
  system: ['alias', 'label', 'descr'],
  container: ['alias', 'label', 'techn', 'descr'],
  component: ['alias', 'label', 'techn', 'descr'],
  boundary: ['alias', 'label', 'type', 'descr'],
  scope: ['alias', 'label'],
  rel: ['from', 'to', 'label', 'techn', 'descr'],
  relindex: ['index', 'from', 'to', 'label', 'techn', 'descr'],
}

const TYPE: Record<string, string> = { person: 'Person', system: 'Software System', container: 'Container', component: 'Component' }

const NAME_WIDTH = 24
const DESCR_WIDTH = 28

const split = (text: string): string[] => {
  const out: string[] = []
  let at = ''
  let quoted = false
  for (const ch of text) {
    if (ch === '"') quoted = !quoted
    else if (ch === ',' && !quoted) {
      out.push(at.trim())
      at = ''
    } else at += ch
  }
  out.push(at.trim())
  return out
}

const argsOf = (text: string, slots: string[]): Args => {
  const args: Args = {}
  const positional: string[] = []
  for (const part of split(text)) {
    const named = /^\$(\w+)\s*=\s*(.*)$/.exec(part)
    const clean = (text: string) => text.replace(/<br\s*\/?>/gi, ' ').trim()
    if (named) args[named[1]!.toLowerCase()] = clean(named[2]!)
    else positional.push(clean(part))
  }
  slots.forEach((slot, i) => (args[slot] ??= positional[i]))
  for (const key of Object.keys(args)) if (!args[key]) delete args[key]
  return args
}

export const wrap = (text: string, size: number, lines: number): string[] => {
  const out: string[] = []
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const last = out.at(-1)
    if (last !== undefined && width(`${last} ${word}`) <= size) out[out.length - 1] = `${last} ${word}`
    else out.push(word)
  }
  if (out.length <= lines) return out
  const kept = out.slice(0, lines)
  const tail = cells(`${kept[lines - 1]} ${out[lines]}`).slice(0, size - 1).join('').trimEnd()
  kept[lines - 1] = `${tail}…`
  return kept
}

const typeOf = (kind: string, ext: boolean, techn?: string) => {
  const name = `${ext ? 'External ' : ''}${TYPE[kind]}`
  return techn && (kind === 'container' || kind === 'component') ? `${name}: ${techn}` : name
}

const into = (state: State): C4Item[] => state.stack.at(-1)?.frame.children ?? state.root

const addElement = (state: State, macro: RegExpExecArray, body: string) => {
  const kind = macro[1]!.toLowerCase()
  const args = argsOf(body, SLOTS[kind]!)
  if (!args.alias) return
  const element: C4Element = {
    id: state.elements.length,
    name: wrap(args.label ?? args.alias, NAME_WIDTH, 3),
    type: `[${typeOf(kind, Boolean(macro[3]), args.techn)}]`,
    descr: wrap(args.descr ?? '', DESCR_WIDTH, 2),
    shape: kind === 'person' ? 'person' : ((macro[2]?.toLowerCase() as C4Shape | undefined) ?? 'box'),
    external: Boolean(macro[3]),
  }
  state.ids.set(args.alias, element.id)
  state.elements.push(element)
  into(state).push(element)
}

const addBoundary = (state: State, name: string, body: string) => {
  const args = argsOf(body, SLOTS[TYPED_BOUNDARY.test(name) ? 'boundary' : 'scope']!)
  const label = args.label ?? args.alias ?? ''
  const frame: C4Frame = { label: args.type ? `${label} [${args.type}]` : label, children: [] }
  into(state).push(frame)
  state.pending = { frame, alias: args.alias ?? '' }
}

const PIECE = /"[^"]*"|[{}]|%%.*$|[^"{}%]+|%/g

export const statements = (line: string): string[] => {
  const out: string[] = []
  let at = ''
  for (const [piece] of line.matchAll(PIECE)) {
    if (piece.startsWith('%%')) break
    if (piece !== '{' && piece !== '}') {
      at += piece
      continue
    }
    out.push(at.trim(), piece)
    at = ''
  }
  out.push(at.trim())
  return out.filter(Boolean)
}

const readLine = (state: State, line: string) => {
  if (line === '{' && state.pending) {
    state.stack.push(state.pending)
    state.pending = undefined
    return
  }
  state.pending = undefined
  if (line === '}') {
    if (!state.stack.pop()) state.broken = true
    return
  }
  const title = /^title\s+(.+)$/i.exec(line)
  if (title) {
    state.title = title[1]!.trim()
    return
  }
  const statement = STATEMENT.exec(line)
  if (!statement) return
  const [, name, body] = statement as unknown as [string, string, string]
  const element = ELEMENT.exec(name)
  if (element) addElement(state, element, body)
  else if (BOUNDARY.test(name)) addBoundary(state, name, body)
  else if (REL.test(name)) state.rels.push([argsOf(body, SLOTS[name.toLowerCase() === 'relindex' ? 'relindex' : 'rel']!), name.toLowerCase()])
}

const relOf = (state: State, [args, name]: [Args, string]): C4Rel | null => {
  const from = state.ids.get(args.from ?? '')
  const to = state.ids.get(args.to ?? '')
  if (from === undefined || to === undefined) return null
  const label = [args.label, args.techn ? `[${args.techn}]` : undefined].filter(Boolean).join(' ')
  const back = name === 'rel_back'
  return { from: back ? to : from, to: back ? from : to, label, both: name === 'birel' }
}

const pruned = (items: C4Item[]): C4Item[] =>
  items.flatMap((item): C4Item[] => {
    if (!isFrame(item)) return [item]
    const children = pruned(item.children)
    return children.length ? [{ ...item, children }] : []
  })

export const c4Model = (source: string): C4Model | null => {
  const lines = source.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('%%'))
  const kind = lines.shift() ?? ''
  if (!isC4Kind(kind)) return null
  const state: State = { ids: new Map(), elements: [], root: [], stack: [], rels: [], broken: false }
  for (const line of lines) for (const piece of statements(line)) readLine(state, piece)
  if (state.broken || state.stack.length || !state.elements.length) return null
  const rels = state.rels.map(rel => relOf(state, rel))
  if (rels.some(rel => rel === null)) return null
  return { title: state.title, items: pruned(state.root), rels: rels as C4Rel[], elements: state.elements }
}
