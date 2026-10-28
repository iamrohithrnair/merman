import type { Inline } from './markdown'

type Dir = 'R' | 'L'
export type Flow = { base: Dir; lines: Inline[][] }
export type Shape = 'visual' | 'words' | 'logical' | 'mirror' | 'inverse' | 'engine'

export const TERMINALS = {
  warp: 'visual',
  ghostty: 'visual',
  wezterm: 'visual',
  vscode: 'visual',
  alacritty: 'visual',
  'windows-terminal': 'engine',
  'apple-terminal': 'logical',
  kitty: 'words',
  iterm: 'mirror',
  gnome: 'logical',
  konsole: 'logical',
} as const satisfies Record<string, Shape>

export type Terminal = keyof typeof TERMINALS

type Fmt = { wrap: ('strong' | 'emphasis' | 'strike')[]; leaf: 'text' | 'code' | 'math' | 'number' | 'path' | 'link' | 'dim' | 'footnote'; href?: string }
type Unit = { ch: string; fmt: Fmt }

const R = /[֐-׿؀-ٟ٪-ۯۺ-ݿࢠ-ࣿיִ-﷿ﹰ-﻿]/
const L = /[A-Za-z0-9À-ɏ٠-٩۰-۹]/
const LATIN = /[A-Za-zÀ-ɏ]/
const MARK = /\p{M}/u
const MIRROR: Record<string, string> = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<' }
const DIGIT = /[0-9\u0660-\u0669\u06F0-\u06F9]/
const TERMINATOR = /[#%\u2030\u00B0$\u20AC\u00A3\u00A5\u20AA]/
const COMMENT = /^(.*?)((?:^|\s)(?:#|\/\/)\s+)(.*)$/

const classify = (ch: string): Dir | null => (R.test(ch) ? 'R' : L.test(ch) ? 'L' : null)

const byDigit = (us: Unit[], i: number): boolean => TERMINATOR.test(us[i]!.ch) && (DIGIT.test(us[i - 1]?.ch ?? '') || DIGIT.test(us[i + 1]?.ch ?? ''))

const units = (text: string, fmt: Fmt): Unit[] => {
  const out: Unit[] = []
  for (const cp of text) {
    const last = out.at(-1)
    if (last && MARK.test(cp)) last.ch += cp
    else out.push({ ch: cp, fmt })
  }
  return out
}

const flatten = (nodes: Inline[], wrap: Fmt['wrap'] = []): Unit[] =>
  nodes.flatMap(n => {
    switch (n.kind) {
      case 'strong':
      case 'emphasis':
      case 'strike':
        return flatten(n.children, [...wrap, n.kind])
      case 'link':
        return units(n.text, { wrap, leaf: 'link', href: n.href })
      case 'image':
        return units(n.text, { wrap, leaf: 'text' })
      case 'path': {
        const [, body = n.text, dot = ''] = /^(.*\w)(\.)$/.exec(n.text) ?? []
        return [...units(body, { wrap, leaf: 'path', href: n.href }), ...units(dot, { wrap, leaf: 'text' })]
      }
      default:
        return units(n.text, { wrap, leaf: n.kind })
    }
  })

const sameFmt = (a: Fmt, b: Fmt) => a.leaf === b.leaf && a.href === b.href && a.wrap.length === b.wrap.length && a.wrap.every((k, i) => k === b.wrap[i])

const leafNode = ({ leaf, href }: Fmt, text: string): Inline =>
  leaf === 'link' ? { kind: 'link', text, href: href! } : leaf === 'path' && href ? { kind: 'path', text, href } : { kind: leaf, text }

const rebuild = (all: Unit[]): Inline[] => {
  const out: Inline[] = []
  let i = 0
  while (i < all.length) {
    const fmt = all[i]!.fmt
    let text = ''
    let j = i
    while (j < all.length && sameFmt(all[j]!.fmt, fmt)) text += all[j++]!.ch
    out.push(fmt.wrap.reduceRight<Inline>((inner, kind) => ({ kind, children: [inner] }), leafNode(fmt, text)))
    i = j
  }
  return out
}

const baseOf = (all: Unit[]): Dir => {
  const words = all.map(u => u.ch).join('').split(/\s+/)
  const rw = words.filter(w => R.test(w)).length
  const lw = words.filter(w => LATIN.test(w) && !R.test(w)).length
  if (rw !== lw) return rw > lw ? 'R' : 'L'
  return all.map(u => classify(u.ch)).find(Boolean) ?? 'R'
}

const turn = <U extends Unit>(us: U[]): U[] => us.map(u => ({ ...u, ch: MIRROR[u.ch] ?? u.ch })).reverse()

const reorder = <U extends Unit>(all: U[], base: Dir): U[] => {
  const strong = all.map((u, i) => {
    const own = classify(u.ch)
    if (own) return own
    if (u.fmt.leaf === 'code' || u.fmt.leaf === 'math' || u.fmt.leaf === 'path' || (u.fmt.leaf === 'link' && /^file:/i.test(u.fmt.href ?? ''))) return 'L'
    return byDigit(all, i) ? 'L' : null
  })
  const prev: (Dir | null)[] = []
  let seen: Dir | null = null
  strong.forEach((s, i) => {
    seen = s ?? seen
    prev[i] = seen
  })
  const next: (Dir | null)[] = []
  seen = null
  for (let i = strong.length - 1; i >= 0; i--) {
    seen = strong[i] ?? seen
    next[i] = seen
  }
  const dir = strong.map((s, i): Dir => s ?? ((prev[i] ?? base) === (next[i] ?? base) ? (prev[i] ?? base) : base))
  const runs: { d: Dir; u: U[] }[] = []
  all.forEach((u, i) => {
    const last = runs.at(-1)
    if (last && last.d === dir[i]) last.u.push(u)
    else runs.push({ d: dir[i]!, u: [u] })
  })
  const out = runs.map(r => (r.d === 'R' ? turn(r.u) : r.u))
  return (base === 'R' ? out.reverse() : out).flat()
}

const LRM = '\u200E'

const bidiClass = (ch: string): string =>
  ch === LRM ? 'L' : R.test(ch) ? 'R' : /[٠-٩]/.test(ch) ? 'AN' : /[0-9۰-۹]/.test(ch) ? 'EN' : /\p{L}/u.test(ch) ? 'L' : /[+-]/.test(ch) ? 'ES' : /[#$%°£€¥₪‰¢]/.test(ch) ? 'ET' : /[,.:/]/.test(ch) ? 'CS' : 'N'

const levelsOf = (all: Unit[], base: Dir): number[] => {
  const t = all.map(u => bidiClass(u.ch))
  t.forEach((c, i) => {
    if ((c === 'ES' || c === 'CS') && t[i - 1] === 'EN' && t[i + 1] === 'EN') t[i] = 'EN'
    else if (c === 'CS' && t[i - 1] === 'AN' && t[i + 1] === 'AN') t[i] = 'AN'
  })
  for (let i = 1; i < t.length; i++) if (t[i] === 'ET' && t[i - 1] === 'EN') t[i] = 'EN'
  for (let i = t.length - 2; i >= 0; i--) if (t[i] === 'ET' && t[i + 1] === 'EN') t[i] = 'EN'
  let strong: string = base
  const w = t.map(c => {
    if (c === 'L' || c === 'R') strong = c
    return c === 'EN' && strong === 'L' ? 'L' : c === 'ES' || c === 'ET' || c === 'CS' ? 'N' : c
  })
  const rtlSide = (c?: string) => (c ?? base) !== 'L'
  const ltr = base === 'L' ? 0 : 2
  const rtl = 1
  return w.map((c, i) => {
    if (c !== 'N') return c === 'L' ? ltr : c === 'R' ? rtl : 2
    let a = i
    while (w[a] === 'N') a--
    let b = i
    while (w[b] === 'N') b++
    const [before, after] = [rtlSide(w[a]), rtlSide(w[b])]
    return before === after ? (before ? rtl : ltr) : base === 'L' ? 0 : 1
  })
}

const terminalBidi = <U extends Unit>(all: U[], mirror = true): U[] => {
  const levels = levelsOf(all, 'L')
  let out = all.map((u, i) => ({ u: mirror && levels[i]! % 2 ? { ...u, ch: MIRROR[u.ch] ?? u.ch } : u, l: levels[i]! }))
  for (let l = 2; l >= 1; l--) {
    const done: typeof out = []
    let run: typeof out = []
    for (const x of out) {
      if (x.l >= l) run.push(x)
      else {
        done.push(...run.reverse(), x)
        run = []
      }
    }
    out = [...done, ...run.reverse()]
  }
  return out.map(x => x.u)
}

export const terminalLine = (nodes: Inline[]): Inline[] => rebuild(terminalBidi(flatten(nodes)))

const wrapUnits = (all: Unit[], max: number, measure: (s: string) => number): Unit[][] => {
  const tokens: Unit[][] = []
  all.forEach((u, i) => {
    if (i === 0 || (u.ch !== ' ' && all[i - 1]!.ch === ' ')) tokens.push([])
    tokens.at(-1)!.push(u)
  })
  const lines: Unit[][] = [[]]
  let used = 0
  const trim = (line: Unit[]) => {
    while (line.at(-1)?.ch === ' ') line.pop()
  }
  for (const token of tokens) {
    let core = token.length
    while (core > 0 && token[core - 1]!.ch === ' ') core--
    const w = token.slice(0, core).reduce((sum, u) => sum + measure(u.ch), 0)
    if (lines.at(-1)!.length && used + w > max) {
      trim(lines.at(-1)!)
      lines.push([])
      used = 0
    }
    lines.at(-1)!.push(...token)
    used += w + (token.length - core)
  }
  trim(lines.at(-1)!)
  return lines
}

const clusters = (text: string): string[] => units(text, { wrap: [], leaf: 'text' }).map(u => u.ch)

const RUN = new RegExp(`(?:${R.source}|\\p{M})+`, 'gu')

const shapeText = (text: string, shape: Shape): string =>
  !R.test(text) ? text : shape === 'words' ? text.replace(RUN, run => clusters(run).reverse().join('')) : shape === 'inverse' ? terminalBidi(units(text, { wrap: [], leaf: 'text' })).map(u => u.ch).join('') : text

const shapeNodes = (nodes: Inline[], shape: Shape): Inline[] =>
  nodes.map(n => {
    if ('children' in n) return { ...n, children: shapeNodes(n.children, shape) }
    return { ...n, text: shapeText(n.text, shape) }
  })

export const containsRtl = (nodes: Inline[]): boolean => nodes.some(n => ('children' in n ? containsRtl(n.children) : R.test(n.text)))

export const WALL = '׀'

export const ROW_MARK_TEXT = `${WALL} `

export const ROW_MARK: Inline = { kind: 'dim', text: ROW_MARK_TEXT }

const asWritten = (shape: Shape) => shape === 'logical' || shape === 'mirror' || shape === 'engine'

const ISOLATED: Fmt['leaf'][] = ['code', 'math', 'path']

const HELD_EDGES: Fmt['leaf'][] = [...ISOLATED, 'link']

const isolate = (all: Unit[]): Unit[] =>
  all.flatMap((u, i) => {
    if (!ISOLATED.includes(u.fmt.leaf)) return [u]
    const mark = { ch: LRM, fmt: u.fmt }
    const opens = i === 0 || !sameFmt(all[i - 1]!.fmt, u.fmt)
    const closes = i === all.length - 1 || !sameFmt(all[i + 1]!.fmt, u.fmt)
    return [...(opens ? [mark] : []), u, ...(closes ? [mark] : [])]
  })

const strongFrom = (line: Unit[], i: number, step: 1 | -1): Dir => {
  for (let j = i; j >= 0 && j < line.length; j += step) {
    const c = bidiClass(line[j]!.ch)
    if (c === 'L' || c === 'R') return c
  }
  return 'R'
}

const anchored = (span: Unit[], i: number): boolean =>
  classify(span[i]!.ch) !== null || byDigit(span, i)

const swapEdges = (span: Unit[]): Unit[] => {
  let a = 0
  while (a < span.length && !anchored(span, a)) a++
  let b = span.length
  while (b > a && !anchored(span, b - 1)) b--
  return [...turn(span.slice(b)), ...span.slice(a, b), ...turn(span.slice(0, a))]
}

const holdEdges = (line: Unit[]): Unit[] => {
  const out = [...line]
  for (let i = 0, j = 0; i < line.length; i = j) {
    j = i + 1
    if (!HELD_EDGES.includes(line[i]!.fmt.leaf)) continue
    while (j < line.length && sameFmt(line[j]!.fmt, line[i]!.fmt)) j++
    const span = line.slice(i, j)
    if (!span.some(u => classify(u.ch) === 'R') && strongFrom(line, i - 1, -1) !== 'L' && strongFrom(line, j, 1) !== 'L') out.splice(i, span.length, ...swapEdges(span))
  }
  return out
}

const forEngine = (line: Unit[], lead: boolean): Unit[] => {
  const first = isolate(line).map(u => bidiClass(u.ch)).find(c => c === 'L' || c === 'R')
  const base = lead || first === 'R' ? 'R' : 'L'
  const all = isolate(base === 'L' ? bindNumber(line) : line)
  const levels = levelsOf(all, base)
  return all.map((u, i) => (levels[i]! % 2 ? { ...u, ch: MIRROR[u.ch] ?? u.ch } : u))
}

const startsLatin = (line: Unit[]): boolean => line.map(u => bidiClass(u.ch)).find(c => c === 'L' || c === 'R') === 'L'

export const opensLatin = (text: string): boolean => startsLatin(units(text, { wrap: [], leaf: 'text' }))

const ordered = (line: Unit[], shape: Shape, base: Dir, lead: boolean): Unit[] =>
  shape === 'engine' ? forEngine(line, lead) : shape === 'mirror' ? holdEdges(line) : asWritten(shape) ? line : shape === 'inverse' ? terminalBidi(reorder(line, base)) : reorder(line, base)

export const flow = (nodes: Inline[], columns: number, measure: (s: string) => number, shape: Shape = 'visual', mark = true): Flow | null => {
  if (!containsRtl(nodes)) return null
  const all = flatten(nodes)
  const base = shape === 'mirror' ? 'R' : baseOf(all)
  const marked = mark && asWritten(shape) && base === 'R' && all.some(u => bidiClass(u.ch) === 'L')
  const logical = base === 'R' ? wrapUnits(all, columns - (marked ? measure(ROW_MARK_TEXT) : 0), measure) : [all]
  const lines = logical.map(line => {
    const lead = marked && startsLatin(line)
    const built = rebuild(ordered(line, shape, base, lead))
    return lead ? [ROW_MARK, ...built] : built
  })
  return { base, lines: shape === 'words' ? lines.map(line => shapeNodes(line, shape)) : lines }
}

const visualText = (text: string, command = false): string => {
  if (!R.test(text)) return text
  const all = units(text, { wrap: [], leaf: 'text' })
  return reorder(all, command && startsLatin(all) ? 'L' : baseOf(all)).map(u => u.ch).join('')
}

export const commentTail = (line: string, shape: Shape = 'visual'): { head: string; marker: string; tail: string } | null => {
  if (asWritten(shape) || !R.test(line)) return null
  const m = COMMENT.exec(line)
  return m && R.test(m[3]!) ? { head: m[1]!, marker: m[2]!, tail: shapeText(visualText(m[3]!), shape) } : null
}

export const commentVisual = (text: string, shape: Shape = 'visual'): string => {
  const c = commentTail(text, shape)
  return c ? c.head + c.marker + c.tail : text
}

export const codeVisual = (text: string, shape: Shape = 'visual', max = Infinity, measure: (s: string) => number = s => s.length, command = false): string =>
  asWritten(shape) || !R.test(text)
    ? text
    : text
        .split('\n')
        .flatMap(line => (measure(line) > max ? wrapUnits(units(line, { wrap: [], leaf: 'text' }), max, measure).map(row => row.map(u => u.ch).join('')) : [line]))
        .map(line => shapeText(visualText(line, command), shape))
        .join('\n')

export const hasRtl = (text: string): boolean => R.test(text)

export const LTR_BLANK = '⠀'

const bindNumber = <U extends Unit>(all: U[]): U[] =>
  all.map((u, i) => {
    if (u.ch !== ' ' || !R.test(all[i - 1]?.ch ?? '') || !DIGIT.test(all[i + 1]?.ch ?? '')) return u
    const next = all.slice(i + 1).find(n => bidiClass(n.ch) === 'L' || R.test(n.ch))
    return next && R.test(next.ch) ? u : { ...u, ch: LTR_BLANK }
  })

const WORD = /[\p{L}\p{M}\p{N}\p{P}]/u

const DRAWN = /[←-⇿─-◿]/u

const ASCII_DRAWN = /[-+|<>]/

const LETTER = /[\p{L}\p{N}]/u

const drawnChar = (ch: string, a: string, b: string) => DRAWN.test(ch) || (ASCII_DRAWN.test(ch) && !(LETTER.test(a) && LETTER.test(b)))

const drawnAt = (all: Cell[], i: number) => drawnChar(all[i]!.ch, all[i - 1]?.ch ?? '', all[i + 1]?.ch ?? '')

const inLabel = (chars: string[], c: number) => {
  const [a = '', b = ''] = [chars[c - 1], chars[c + 1]]
  return WORD.test(a) && WORD.test(b) && (R.test(a) || R.test(b))
}

const WORD_CHAR = /[\p{L}\p{M}\p{N}]/u

const LETTER_CHAR = /[\p{L}\p{M}]/u

const joins = (chars: string[], c: number) => {
  const [a = '', b = ''] = [chars[c - 1], chars[c + 1]]
  return chars[c] === ' ' && WORD_CHAR.test(a) && WORD_CHAR.test(b) && (LETTER_CHAR.test(a) || LETTER_CHAR.test(b))
}

const mixedSpaces = (chars: string[]): Set<number> => {
  const mixed = new Set<number>()
  let spaces: number[] = []
  let rtl = false
  const close = () => {
    if (rtl) for (const c of spaces) mixed.add(c)
    spaces = []
    rtl = false
  }
  chars.forEach((ch, i) => {
    if (joins(chars, i)) spaces.push(i)
    else if (ch === ' ' || drawnChar(ch, chars[i - 1] ?? '', chars[i + 1] ?? '')) close()
    else rtl ||= R.test(ch)
  })
  close()
  return mixed
}

type Cell = Unit & { at: number }

export type Held = { cells: string[]; from: number[] }

const PLAIN: Fmt = { wrap: [], leaf: 'text' }

const rightToLeft = <U extends Unit>(all: U[]): U[] => (baseOf(all) !== 'R' ? bindNumber(all) : all.some(u => bidiClass(u.ch) === 'L') ? terminalBidi(reorder(all, 'R')) : all)

export const heldCell = (nodes: Inline[]): Flow | null => {
  if (!containsRtl(nodes)) return null
  const all = flatten(nodes)
  return { base: baseOf(all), lines: [rebuild(rightToLeft(all))] }
}

const byWords = (label: (words: Cell[]) => Cell[]) => (all: Cell[]): Cell[] => {
  const out: Cell[] = []
  let words: Cell[] = []
  const flush = () => {
    out.push(...(words.some(u => R.test(u.ch)) ? label(words) : words))
    words = []
  }
  all.forEach((u, i) => {
    if (!drawnAt(all, i)) words.push(u)
    else {
      flush()
      out.push(u)
    }
  })
  flush()
  return out
}

const engineLabel = byWords(words => (baseOf(words) === 'R' ? terminalBidi(reorder(words, 'R'), false) : words))

const visualLabel = byWords(words => reorder(words, baseOf(words)))

const hold = (chars: string[], label: (all: Cell[]) => Cell[], blank: string[]): Held => {
  const held: Held = { cells: [], from: [] }
  let run: Cell[] = []
  const flush = () => {
    for (const u of label(run)) {
      held.cells.push(u.ch)
      held.from.push(u.at)
    }
    run = []
  }
  const mixed = mixedSpaces(chars)
  chars.forEach((ch, c) => {
    if (ch === ' ' && !inLabel(chars, c) && !mixed.has(c)) {
      flush()
      for (const b of blank) {
        held.cells.push(b)
        held.from.push(c)
      }
    } else if (MARK.test(ch) && run.length) run.at(-1)!.ch += ch
    else run.push({ ch, fmt: PLAIN, at: c })
  })
  flush()
  return held
}

export const asIs = (chars: string[]): Held => ({ cells: chars, from: chars.map((_, c) => c) })

export const holdText = (chars: string[]): Held => hold(chars, rightToLeft, [LTR_BLANK])

export const listMarker = (marker: string, shape: Shape): string => (shape === 'logical' ? marker : marker.replace(/^(\d+)([.)])$/, (_, n: string, p: string) => (MIRROR[p] ?? p) + n))

export const holdEngine = (chars: string[]): Held => (chars.some(ch => R.test(ch)) ? hold(chars, engineLabel, [LRM, ' ']) : asIs(chars))

export const holdVisual = (chars: string[]): Held => (chars.some(ch => R.test(ch)) ? hold(chars, visualLabel, [' ']) : asIs(chars))

export const holdRow = (chars: string[]): Held => (chars.some(ch => R.test(ch)) ? holdText(chars) : asIs(chars))

export const led = (chars: string[], held: Held): Held => {
  const blank = chars.some(ch => R.test(ch)) ? LTR_BLANK : ' '
  return { cells: [blank, blank, ...held.cells], from: [-1, -1, ...held.from] }
}
