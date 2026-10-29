import type { ElementTable, RenderElement, RenderNode, TextHoverProps } from 'claude-code'

import type { ChartArt } from './charts'
import { tableHtml, tableText } from './html'
import type { Block, Inline } from './markdown'
import { mathOf } from './latex'
import { CONTROL, displayText, inlineText, isUnclosed, isWebLink, nestedBlocks, texText } from './markdown'
import type { Flow } from './rtl'
import { LTR_BLANK, ROW_MARK, ROW_MARK_TEXT, WALL, codeVisual, commentTail, commentVisual, containsRtl, flow, hasRtl, heldCell, listMarker, opensLatin, terminalLine } from './rtl'
import type { Look, Run } from './runs'
import { PLAIN, drawRun, drawRuns, isBlank, joinRuns, lookOf, over, within } from './runs'
import type { Style, Theme } from './theme'
import type { PrismToken } from './vendor/prism.js'
import { languages, tokenize } from './vendor/prism.js'

const WIDE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{20000}-\u{3FFFD}\u20E3]|\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F/u
const segmenter = new Intl.Segmenter()

export const graphemes = (s: string): string[] => [...segmenter.segment(s)].map(g => g.segment)

const CLUSTER_UNITS = 32

const clusters = (s: string, count: number): string => {
  let n = 0
  for (const { index, segment } of segmenter.segment(s)) if (n++ === count || index + segment.length > count * CLUSTER_UNITS) return s.slice(0, index)
  return s
}

export const cells = (s: string): string[] => (/^[ -~]*$/.test(s) ? [...s] : graphemes(s).flatMap(g => (WIDE.test(g) ? [g, ''] : [g])))

const ZERO = /^[\p{M}\p{Default_Ignorable_Code_Point}]+$/u

export const width = (s: string): number =>
  /^[ -~]*$/.test(s) ? s.length
  : s.length === 1 ? (ZERO.test(s) ? 0 : WIDE.test(s) ? 2 : 1)
  : graphemes(s).reduce((w, g) => (ZERO.test(g) ? w : w + (WIDE.test(g) ? 2 : 1)), 0)

const shown = (cell: string) => {
  const code = cell.length === 1 ? cell.charCodeAt(0) : 0
  return (code >= 0x20 && code <= 0x7e) || (code >= 0x2500 && code <= 0x25ff) || !ZERO.test(cell)
}

export const cellsWidth = (row: string[]): number => {
  let w = 0
  for (let i = 0; i < row.length; i++) if (shown(row[i] || row[i - 1]!)) w++
  return w
}

const widestLine = (text: string): number => Math.max(...text.split('\n').map(width))

const wrapRanges = (text: string, w: number): [number, number][] => {
  const br = text.indexOf('\n')
  if (br >= 0) return [...wrapRanges(text.slice(0, br), w), ...wrapRanges(text.slice(br + 1), w).map(([a, b]): [number, number] => [a + br + 1, b + br + 1])]
  if (width(text) <= w) return [[0, text.length]]
  const out: [number, number][] = []
  let line: [number, number] | undefined
  let used = 0
  for (const word of text.matchAll(/\S+/g)) {
    let start = word.index
    const end = start + word[0].length
    let size = width(word[0])
    if (size > w) {
      if (line) out.push(line)
      line = undefined
      let cut = start
      let taken = 0
      for (const g of graphemes(text.slice(start, end))) {
        const step = width(g)
        if (cut > start && taken + step > w) {
          out.push([start, cut])
          start = cut
          size -= taken
          taken = 0
          if (size <= w) break
        }
        cut += g.length
        taken += step
      }
    }
    if (start === end) continue
    const joined = line ? used + width(text.slice(line[1], start)) + size : Infinity
    if (line && joined <= w) {
      line = [line[0], end]
      used = joined
    } else {
      if (line) out.push(line)
      line = [start, end]
      used = size
    }
  }
  if (line) out.push(line)
  return out.length ? out : [[0, 0]]
}

const sliceInline = (nodes: Inline[], from: number, to: number): Inline[] => {
  const out: Inline[] = []
  let at = 0
  for (const n of nodes) {
    const length = inlineText([n]).length
    const a = Math.max(from - at, 0)
    const b = Math.min(to - at, length)
    at += length
    if (a >= b) continue
    if ('children' in n) out.push({ ...n, children: sliceInline(n.children, a, b) })
    else out.push({ ...n, text: n.text.slice(a, b) })
  }
  return out
}

const hasLink = (nodes: Inline[]): boolean => nodes.some(n => n.kind === 'link' || ('children' in n && hasLink(n.children)))

const headerRuns = (nodes: Inline[]): Inline[] =>
  nodes.flatMap(n => (n.kind === 'footnote' ? [n] : 'children' in n ? headerRuns(n.children) : [{ kind: 'text' as const, text: n.text }]))
    .reduce<Inline[]>((out, n) => {
      const last = out[out.length - 1]
      return n.kind === 'text' && last?.kind === 'text' ? [...out.slice(0, -1), { kind: 'text', text: last.text + n.text }] : [...out, n]
    }, [])

const HTTP_LINKS_FROM = [2, 1, 289]
const EDITOR_LINKS_FROM = [2, 1, 294]
const CLICKABLE_MARKS_FROM = [2, 1, 295]

const releaseFrom = (from: readonly number[]) => (base?: string): boolean => {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(base ?? '')
  if (!m) return false
  const version = [Number(m[1]), Number(m[2]), Number(m[3])]
  const at = version.findIndex((n, i) => n !== from[i])
  return at === -1 || version[at]! > from[at]!
}

export const takesHttpLinks = releaseFrom(HTTP_LINKS_FROM)

export const takesEditorLinks = releaseFrom(EDITOR_LINKS_FROM)

export const takesClickableMarks = releaseFrom(CLICKABLE_MARKS_FROM)

export const fileRoot = (distro?: string): string => (distro ? `file://wsl.localhost/${encodeURIComponent(distro)}` : 'file://')

export type TerminalEnv = Partial<Record<'FORCE_HYPERLINK' | 'TERM_PROGRAM' | 'TERM_PROGRAM_VERSION' | 'TERM' | 'WT_SESSION' | 'LC_TERMINAL' | 'VTE_VERSION' | 'TERMINAL_EMULATOR', string>>

const HYPERLINK_TERMINALS = ['ghostty', 'Hyper', 'kitty', 'alacritty', 'iTerm.app', 'iTerm2', 'WarpTerminal', 'Orca']

const versionOf = (value = ''): number[] => {
  const short = /^(\d{1,2})(\d{2})$/.exec(value)
  return short ? [0, Number(short[1])] : value.split('.').map(n => Number.parseInt(n, 10))
}

const atLeast = (value: string | undefined, major: number, minor: number): boolean => {
  const [a = Number.NaN, b = Number.NaN] = versionOf(value)
  return a > major || (a === major && b >= minor)
}

const programLinks = (program: string, version: string | undefined): boolean =>
  HYPERLINK_TERMINALS.includes(program)
  || (program === 'WezTerm' && atLeast(version, 20200620, 0))
  || (program === 'vscode' && atLeast(version, 1, 72))
  || (program === 'tmux' && atLeast(version, 3, 4))

export const drawsHyperlinks = (env: TerminalEnv): boolean => {
  if (env.FORCE_HYPERLINK) return Number.parseInt(env.FORCE_HYPERLINK, 10) !== 0
  const term = env.TERM ?? ''
  const vte = env.VTE_VERSION
  return env.WT_SESSION !== undefined
    || programLinks(env.TERM_PROGRAM ?? '', env.TERM_PROGRAM_VERSION)
    || HYPERLINK_TERMINALS.includes(env.LC_TERMINAL ?? '')
    || (vte !== undefined && vte !== '0.50.0' && atLeast(vte, 0, 50))
    || term === 'alacritty' || term.includes('kitty')
    || env.TERMINAL_EMULATOR === 'JetBrains-JediTerm'
}

type Reach = Pick<Style, 'httpLinks' | 'editorLinks' | 'fileLinks' | 'pathLinks' | 'cwd' | 'home' | 'found'>

const LAUNCHERS = new Set([
  'app', 'command', 'tool', 'terminal', 'pkg', 'mpkg', 'mobileconfig', 'prefpane', 'workflow', 'action', 'fileloc', 'inetloc', 'webloc',
  'exe', 'com', 'scr', 'pif', 'cpl', 'msi', 'msp', 'msu', 'msix', 'msixbundle', 'appx', 'appxbundle', 'appinstaller', 'application', 'appref-ms', 'vsix',
  'bat', 'cmd', 'ps1', 'psc1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'wsc', 'hta', 'chm', 'msc', 'reg', 'xll', 'wsb', 'diagcab', 'ahk', 'au3',
  'lnk', 'url', 'scf', 'settingcontent-ms',
  'desktop', 'sh', 'bash', 'zsh', 'csh', 'ksh', 'run', 'appimage', 'deb', 'rpm', 'snap', 'flatpak', 'flatpakref',
  'jar', 'jnlp', 'py', 'pyw', 'pyz', 'pyzw', 'pyc', 'pl', 'rb', 'rbw',
])

const unescaped = (text: string): string => text.replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))

const extensionOf = (name: string): string => /\.([^.]*)$/.exec(name.replace(/[. ]+$/, ''))?.[1] ?? ''

const launches = (href: string): boolean => {
  const path = unescaped(href.replace(/[?#].*$/, '')).toLowerCase().replace(/[/\\]+$/, '')
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  return /\.app[/\\]/.test(path) || name.split(/[:\u0000-\u001f]/).some(part => LAUNCHERS.has(extensionOf(part)))
}

const isHyperlink = (href: string, reach: Reach): boolean =>
  (reach.httpLinks ? /^https?:/i : /^(https:|http:\/\/localhost(:\d+)?([/?#]|$))/i).test(href)
  || (reach.editorLinks && /^(vscode(-insiders)?|cursor|windsurf|zed):\/\/file\//i.test(href))
  || (reach.fileLinks !== null && /^file:/i.test(href) && !launches(href))

const plainLink = (text: string, href: string): string => {
  const target = href.replace(/^mailto:/i, '')
  return text === target || `http://${text}` === target ? target : `${text} (${target})`
}

const LINK_MAX = 2048

const utf8Bytes = (cp: number): number => (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4)

const encodedLength = (href: string): number =>
  [...href].reduce((length, ch) => {
    const cp = ch.codePointAt(0)!
    return length + (cp > 0x20 && cp < 0x7f ? 1 : 3 * utf8Bytes(cp))
  }, 0)

const fileHref = (root: string, href: string): string => {
  const local = /^file:(?:\/\/(?:localhost)?)?(\/(?![a-z]:|\/)[^?#]*)(.*)$/i.exec(href)
  return local && root !== 'file://' ? `${root}${local[1]}${local[2]}` : href
}

const absolutePath = (reach: Reach, path: string): string | undefined => {
  const base = path.startsWith('~') ? reach.home : path.startsWith('.') ? reach.cwd : '/'
  if (!base) return undefined
  const parts: string[] = []
  for (const part of `${slashes(base)}/${path.replace(/^~/, '').replace(/(?<=[^/.])\.+$/, '')}`.split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '.' && part !== '') parts.push(part)
  }
  return `/${parts.join('/')}${path.endsWith('/') ? '/' : ''}`
}

const pathHref = (reach: Reach, path: string): string | undefined => {
  const target = absolutePath(reach, path)
  if (target === undefined || reach.fileLinks === null) return undefined
  const href = `${reach.fileLinks}${encodeURI(target).replace(/[?#]/g, encodeURIComponent)}`
  return href.length <= LINK_MAX && !launches(href) ? href : undefined
}

const toolHref = (reach: Reach, path: string): string | undefined => {
  if (!reach.pathLinks || reach.fileLinks === null) return undefined
  const forward = path.replace(/\\/g, '/')
  if (/^[a-z]:\//i.test(forward)) return pathHref({ ...reach, fileLinks: 'file://' }, forward)
  if (!forward.startsWith('//')) return pathHref(reach, /^[/~.]/.test(forward) ? forward : `./${forward}`)
  const href = `file:${encodeURI(forward).replace(/[?#]/g, encodeURIComponent)}`
  return href.length <= LINK_MAX && !launches(href) ? href : undefined
}

type LinkPiece = { text: string; path?: string }

const pieceText = (pieces: LinkPiece[]): string => pieces.map(p => p.text).join('')

const drawPieces = (el: ElementTable, style: Style, pieces: LinkPiece[]): string | (string | RenderElement)[] => {
  const hrefs = pieces.map(p => (p.path === undefined ? undefined : toolHref(style, p.path)))
  return hrefs.some(Boolean) ? pieces.map((p, i) => { const href = hrefs[i]; return href ? <el.Link key={`p${i}`} href={href} label={p.text} /> : p.text }) : pieceText(pieces)
}

const decoded = (text: string): string | undefined => {
  try {
    return decodeURIComponent(text)
  } catch {
    return undefined
  }
}

const linkPath = (root: string, href: string): string | undefined => {
  const local = root !== 'file://' && href.startsWith(`${root}/`) ? href.slice(root.length) : href.replace(/^file:(\/\/(localhost)?(?=\/))?/i, '')
  return decoded(local.replace(/[?#].*$/, ''))
}

const labelPath = (reach: Reach, root: string, label: string): string | undefined => {
  if (/^file:/i.test(label)) return linkPath(root, fileHref(root, label))
  if (/^([a-z]:[\\/]|\\\\)/i.test(label)) return label.replace(/\\/g, '/').replace(/^(?=[a-z]:)/i, '/')
  if (label.startsWith('/')) return label
  return /^(~|\.{1,2})\//.test(label) ? absolutePath(reach, label) : undefined
}

const withoutSlash = (path: string | undefined): string | undefined => path?.replace(/(?<=.)\/+$/, '')

const hidesFile = (reach: Reach, n: Extract<Inline, { kind: 'link' }>, href: string): boolean => {
  const label = n.text.trim().replace(/[.,;:!?]+$/, '')
  if (!/^file:/i.test(n.href) || label === n.href) return false
  const root = reach.fileLinks ?? 'file://'
  const shown = withoutSlash(labelPath(reach, root, label))
  return shown === undefined || shown !== withoutSlash(linkPath(root, href))
}

const drawnLink = (n: Extract<Inline, { kind: 'link' }>, reach: Reach): Inline => {
  const href = reach.fileLinks !== null && /^file:/i.test(n.href) ? fileHref(reach.fileLinks, n.href) : n.href
  if (!isHyperlink(n.href, reach) || encodedLength(href) > LINK_MAX || hidesFile(reach, n, href)) return { kind: 'text', text: plainLink(n.text, n.href) }
  return href === n.href ? n : { ...n, href }
}

const linksAsPath = (path: string): boolean => !path.startsWith('/') || /^\/[^/]+\/+[^/]/.test(path.replace(/\.+$/, ''))

const drawnPath = (n: Extract<Inline, { kind: 'path' }>, reach: Reach): Inline => {
  const href = reach.pathLinks && linksAsPath(n.text) ? pathHref(reach, n.text) : undefined
  return href === undefined ? n : { ...n, href }
}

const PART = String.raw`[\p{L}\p{N}_@+-]+`
const NAME = String.raw`\.?${PART}(?:\.${PART})*`
const LOOSE_PATH = new RegExp(String.raw`(?<![\p{L}\p{N}_/\\.:~@+-])(?:[A-Za-z]:[\\/](?:${NAME}[\\/])*(?:${NAME})?|${NAME}(?:\/${NAME})*\/(?:${NAME})?|${PART}(?:\.${PART})+)(?![\p{L}\p{N}_/\\@+-]|\.[\p{L}\p{N}])`, 'gu')

type Probe = { key: string; href: string }

const looseProbe = (reach: Reach, spelling: string): Probe | undefined => {
  const drive = /^[a-z]:[\\/]/i.test(spelling)
  if (!drive && !reach.cwd) return undefined
  const href = toolHref(reach, spelling)
  const key = drive ? spelling.replace(/\\/g, '/') : `${slashes(reach.cwd)}/${spelling}`
  return href === undefined ? undefined : { key: key.replace(/(?<=[^/:])\/+$/, ''), href }
}

const looseSpellings = (text: string): RegExpExecArray[] => [...text.matchAll(LOOSE_PATH)]

const foundProbe = (reach: Reach, spelling: string): Probe | undefined => {
  const probe = looseProbe(reach, spelling)
  return probe && reach.found?.has(probe.key) ? probe : undefined
}

const loosePaths = (n: Extract<Inline, { kind: 'text' }>, reach: Reach): Inline[] => {
  const out: Inline[] = []
  let at = 0
  for (const m of looseSpellings(n.text)) {
    const probe = foundProbe(reach, m[0])
    if (!probe) continue
    if (m.index > at) out.push({ kind: 'text', text: n.text.slice(at, m.index) })
    out.push({ kind: 'path', text: m[0], href: probe.href })
    at = m.index + m[0].length
  }
  if (at === 0) return [n]
  if (at < n.text.length) out.push({ kind: 'text', text: n.text.slice(at) })
  return out
}

const looseCode = (n: Extract<Inline, { kind: 'code' }>, reach: Reach): Inline => {
  const probe = isWholePath(n.text) ? foundProbe(reach, n.text) : undefined
  return probe ? { ...n, href: probe.href } : n
}

const isWholePath = (text: string): boolean => looseSpellings(text).some(m => m[0] === text)

const looseNode = (n: Inline, reach: Reach): Inline | Inline[] => {
  if (n.kind === 'text') return loosePaths(n, reach)
  return n.kind === 'code' ? looseCode(n, reach) : n
}

const linked = (node: Inline, reach: Reach): Inline => {
  const n: Inline = node.kind === 'image' && isWebLink(node.src) ? { kind: 'link', text: node.text, href: node.src } : node
  if (n.kind === 'link') return drawnLink(n, reach)
  if (n.kind === 'path') return drawnPath(n, reach)
  return 'children' in n ? { ...n, children: hyperlinks(n.children, reach) } : n
}

const hyperlinks = (nodes: Inline[], reach: Reach): Inline[] =>
  reach.found?.size ? nodes.flatMap(node => looseNode(linked(node, reach), reach)) : nodes.map(node => linked(node, reach))

const spellingsIn = (nodes: Inline[]): string[] =>
  nodes.flatMap(n => {
    if ('children' in n) return spellingsIn(n.children)
    if (n.kind === 'code') return isWholePath(n.text) ? [n.text] : []
    return n.kind === 'text' ? looseSpellings(n.text).map(m => m[0]) : []
  })

const inlinesOf = (block: Block): Inline[][] => {
  switch (block.kind) {
    case 'heading':
    case 'paragraph':
      return [block.inline]
    case 'list':
      return block.items.map(item => item.inline)
    case 'table':
      return [...block.header, ...block.rows.flat()]
    case 'notes':
      return block.notes.map(note => note.inline)
    default:
      return []
  }
}

const spelled = new WeakMap<Block, string[]>()

export const pathsToProbe = (blocks: Block[], reach: Reach): string[] => {
  if (!reach.pathLinks || reach.fileLinks === null) return []
  return nestedBlocks(blocks).flatMap(block => {
    const spellings = spelled.get(block) ?? inlinesOf(block).flatMap(spellingsIn)
    spelled.set(block, spellings)
    return spellings.flatMap(spelling => looseProbe(reach, spelling)?.key ?? [])
  })
}

const hyperlinkBlock = (block: Block, reach: Reach): Block => {
  const drawn = (nodes: Inline[]) => hyperlinks(nodes, reach)
  switch (block.kind) {
    case 'heading':
    case 'paragraph':
      return { ...block, inline: drawn(block.inline) }
    case 'list':
      return { ...block, items: block.items.map(item => ({ ...item, inline: drawn(item.inline) })) }
    case 'table':
      return { ...block, header: block.header.map(drawn), rows: block.rows.map(r => r.map(drawn)) }
    case 'notes':
      return { ...block, notes: block.notes.map(note => ({ ...note, inline: drawn(note.inline) })) }
    default:
      return block
  }
}

const hyperlinked = new WeakMap<Block, Record<string, { found?: ReadonlySet<string>; block: Block }>>()

const drawable = (block: Block, reach: Reach): Block => {
  const cached = hyperlinked.get(block) ?? {}
  hyperlinked.set(block, cached)
  const key = `${+reach.httpLinks}${+reach.editorLinks}${reach.fileLinks ?? ''}${reach.pathLinks ? `\0${reach.home}\0${reach.cwd}` : ''}`
  const found = reach.pathLinks ? reach.found : undefined
  const hit = cached[key]
  if (hit && hit.found === found) return hit.block
  const drawn = hyperlinkBlock(block, reach)
  cached[key] = { found, block: drawn }
  return drawn
}

const mostLines = (text: string, w: number): number => (text.match(/\S+/g)?.length ?? 0) + Math.ceil(width(text) / w)

const textRows = (text: string, w: number): number =>
  text.split('\n').reduce((sum, line) => sum + (width(line) <= w ? 1 : mostLines(line, Math.max(1, w))), 0)

const heightOf = (blocks: Block[], w: number): number => blocks.reduce((sum, block, b) => sum + (b ? 1 : 0) + blockHeight(block, w), 0)

const blockHeight = (block: Block, w: number): number => {
  switch (block.kind) {
    case 'heading':
      return 2 * textRows(displayText(block.inline), w - 4) + 2
    case 'paragraph':
      return textRows(displayText(block.inline), w)
    case 'list':
      return block.items.reduce((sum, item) => {
        const pad = item.depth * 2 + item.marker.length + 4
        return sum + textRows(displayText(item.inline), w - pad) + (item.blocks ? heightOf(item.blocks, w - pad) + 1 : 0)
      }, textRows(`${'━'.repeat(20)} ${block.items.length}/${block.items.length} done`, w))
    case 'code':
      return block.lines.reduce((sum, line) => sum + textRows(line, w - 8), 3)
    case 'table': {
      const { natural, words } = tableSize(block)
      const widths = columnWidths(natural, w - 4, 3, words)
      const tallest = (cells: Inline[][]) => Math.max(1, ...widths.map((cw, c) => textRows(displayText(cells[c] ?? []), cw)))
      return block.rows.reduce((sum, row) => sum + 1 + tallest(row), 4 + tallest(block.header))
    }
    case 'quote':
      return Math.max(1, heightOf(block.blocks, w - 2))
    case 'alert':
      return 3 + heightOf(block.blocks, w - 4)
    case 'rule':
      return 1
    case 'notes':
      return block.notes.reduce((sum, note) => sum + textRows(`${note.mark} ${displayText(note.inline)}`, w), 1)
  }
}

const wrapInline = (nodes: Inline[], w: number): Inline[][] => {
  const text = inlineText(nodes)
  return width(text) <= w && !text.includes('\n') ? [nodes] : wrapRanges(text, w).map(([a, b]) => sliceInline(nodes, a, b))
}

export const mirrored = (style: Style) => style.shape === 'mirror'

export const heldLtr = (style: Style) => (style.shape === 'engine' ? { dir: 'ltr' as const } : {})

const heldLabel = (style: Style, label: string, text: string): string => (mirrored(style) && hasRtl(text) ? label.replace(/ $/, LTR_BLANK) : label)

const heldRow = (el: ElementTable, style: Style, key: string, label: string, text: string, cell: RenderNode): RenderElement => (
  <el.Box key={key} flexDirection="row">
    <el.Text dimColor>{heldLabel(style, label, text)}</el.Text>
    {cell}
  </el.Box>
)

const flows = new Map<string, Flow | null>()
const flowOf = (style: Style, nodes: Inline[], columns: number, mark = !(style.inside && mirrored(style))) =>
  style.reorder && containsRtl(nodes) ? remember(flows, `${style.shape}\0${mark}\0${columns}\0${JSON.stringify(nodes)}`, () => flow(nodes, columns, width, style.shape, mark), 2000) : null

const cellFlow = (style: Style, nodes: Inline[], held: boolean, mark: boolean) =>
  held && style.reorder && containsRtl(nodes) ? remember(flows, `held\0${JSON.stringify(nodes)}`, () => heldCell(nodes), 2000) : flowOf(style, nodes, Infinity, mark)

const noteHover = (style: Style, note: number | undefined) =>
  note === undefined || style.noteKey === undefined ? {} : { hover: { scope: `fn:${style.noteKey}:${note}`, inverse: true } }

type InlineLooks = Record<'strong' | 'emphasis' | 'strike' | 'code' | 'link' | 'number' | 'path' | 'dim' | 'rule' | 'note', Look>

const themeLooks = new WeakMap<Theme, InlineLooks>()

const inlineLooks = (t: Theme): InlineLooks => {
  const hit = themeLooks.get(t)
  if (hit) return hit
  const looks = {
    strong: lookOf({ bold: true, color: t.strong }),
    emphasis: lookOf({ italic: true, color: t.emphasis }),
    strike: lookOf({ strikethrough: true, dimColor: true }),
    code: lookOf({ color: t.inlineCode }),
    link: lookOf({ color: t.link }),
    number: lookOf({ color: t.number }),
    path: lookOf({ color: t.path }),
    dim: lookOf({ dimColor: true }),
    rule: lookOf({ color: t.rule }),
    note: lookOf({ color: t.accent }),
  }
  themeLooks.set(t, looks)
  return looks
}

type Part = Run | RenderElement

const isRun = (part: Part): part is Run => 'look' in part

const drawParts = (el: ElementTable, parts: Part[]): RenderNode[] => parts.map(part => (isRun(part) ? drawRun(el.Text, part) : part))

const mergedParts = (parts: Part[], parent: Look): Part[] => {
  if (parts.every(isRun)) return joinRuns(parts, parent)
  const out: Part[] = []
  let runs: Run[] = []
  for (const part of parts) {
    if (isRun(part)) {
      runs.push(part)
      continue
    }
    out.push(...joinRuns(runs, parent), part)
    runs = []
  }
  return out.concat(joinRuns(runs, parent))
}

const nestedPart = (el: ElementTable, style: Style, looks: InlineLooks, look: Look, children: Inline[], parent: Look): Part | Part[] => {
  if (within(parent, look) === PLAIN) return inlineParts(el, style, looks, children, parent)
  const inner = over(parent, look)
  const parts = mergedParts(inlineParts(el, style, looks, children, inner), inner)
  const only = parts.length === 1 ? parts[0]! : undefined
  if (only && isRun(only)) return { text: only.text, look: within(parent, over(look, only.look)) }
  return h(el.Text, look, ...drawParts(el, parts)) as RenderElement
}

const linkedPart = (el: ElementTable, look: Look, text: string, href: string | undefined, parent: Look): Part => {
  if (href === undefined) return { text, look: within(parent, look) }
  const link = <el.Link href={href} label={text} />
  return within(parent, look) === PLAIN ? link : (h(el.Text, look, link) as RenderElement)
}

const notePart = (el: ElementTable, style: Style, look: Look, n: Extract<Inline, { kind: 'footnote' }>, parent: Look): Part => {
  const hover = noteHover(style, n.note)
  return hover.hover ? <el.Text {...look} hover={hover.hover}>{n.text}</el.Text> : { text: n.text, look: within(parent, look) }
}

const linkPart = (el: ElementTable, look: Look, n: Extract<Inline, { kind: 'link' }>): Part =>
  n.text === n.href ? (h(el.Text, look, <el.Link href={n.href} />) as RenderElement) : <el.Link href={n.href}>{h(el.Text, look, n.text)}</el.Link>

const inlinePart = (el: ElementTable, style: Style, looks: InlineLooks, n: Inline, parent: Look): Part | Part[] => {
  switch (n.kind) {
    case 'text':
      return { text: n.text, look: PLAIN }
    case 'strong':
      return nestedPart(el, style, looks, looks.strong, n.children, parent)
    case 'emphasis':
      return nestedPart(el, style, looks, looks.emphasis, n.children, parent)
    case 'strike':
      return nestedPart(el, style, looks, looks.strike, n.children, parent)
    case 'code':
      return linkedPart(el, looks.code, n.text, n.href, parent)
    case 'path':
      return linkedPart(el, looks.path, n.text, n.href, parent)
    case 'link':
      return linkPart(el, looks.link, n)
    case 'footnote':
      return notePart(el, style, looks.note, n, parent)
    case 'dim':
      return { text: n.text, look: within(parent, n === ROW_MARK ? looks.rule : looks.dim) }
    default:
      return { text: n.text, look: within(parent, looks[LEAF_LOOKS[n.kind]]) }
  }
}

const LEAF_LOOKS = { math: 'emphasis', number: 'number', image: 'link' } as const

const inlineParts = (el: ElementTable, style: Style, looks: InlineLooks, nodes: Inline[], parent: Look): Part[] => {
  const parts: Part[] = []
  for (const n of nodes) {
    const part = inlinePart(el, style, looks, n, parent)
    if (Array.isArray(part)) parts.push(...part)
    else parts.push(part)
  }
  return parts
}

const renderInline = (el: ElementTable, style: Style, nodes: Inline[], parent: Look = PLAIN): RenderNode[] => drawParts(el, mergedParts(inlineParts(el, style, inlineLooks(style.theme), nodes, parent), parent))

const textOf = (el: ElementTable, look: Look, children: RenderNode[]): RenderElement => {
  const only = children.length === 1 ? children[0] : undefined
  return look === PLAIN && typeof only === 'object' && only?.type === 'Text' ? only : (h(el.Text, look, ...children) as RenderElement)
}

const renderFlow = (el: ElementTable, style: Style, lines: Inline[][], key: string, props: TextLook = {}) => {
  const { Text } = el
  const look = lookOf(props)
  return lines.map((line, i) => <Text key={`${key}.${i}`} {...props}>{renderInline(el, style, line, look)}</Text>)
}

type Mark = { start: number; end: number; text: string; note: number }
type TextLook = { italic?: boolean; color?: string; bold?: boolean; dimColor?: boolean; strikethrough?: boolean }

const marksIn = (nodes: Inline[], at = 0): Mark[] => {
  const out: Mark[] = []
  for (const n of nodes) {
    const length = inlineText([n]).length
    if (n.kind === 'footnote' && n.note !== undefined) out.push({ start: at, end: at + length, text: n.text, note: n.note })
    else if ('children' in n) out.push(...marksIn(n.children, at))
    at += length
  }
  return out
}

const piecesOf = (text: string, a: number, b: number, columns: number, marks: Mark[]): (readonly [number, number])[] => {
  if (width(text.slice(a, b)) <= columns) return [[a, b]]
  const out: [number, number][] = []
  let start = a
  let at = a
  let taken = 0
  for (const g of graphemes(text.slice(a, b))) {
    const step = width(g)
    if (at > start && taken + step > columns) {
      const cut = marks.find(m => m.start < at && at < m.end)?.start ?? at
      if (cut > start) {
        out.push([start, cut])
        taken = width(text.slice(cut, at))
        start = cut
      }
    }
    at += g.length
    taken += step
  }
  out.push([start, b])
  return out
}

const pressInline = (el: ElementTable, style: Style, nodes: Inline[], columns: number, key: string, tip: Tip | undefined, look: TextLook = {}, box: { justifyContent?: 'flex-start' | 'flex-end' | 'center' } = {}): RenderElement | null => {
  const marks = tip ? marksIn(nodes).flatMap(m => {
    const press = tip(m.note)
    return press ? [{ ...m, press }] : []
  }) : []
  if (!marks.length) return null
  const { Box, Text, Button } = el
  const parent = lookOf(look)
  const run = (a: number, b: number) => <Text key={`${key}.t${a}`} {...look}>{renderInline(el, style, sliceInline(nodes, a, b), parent)}</Text>
  const text = inlineText(nodes)
  const words = [...text.matchAll(/\s*\S+\s*/g)].flatMap(m => piecesOf(text, m.index, m.index + m[0].length, Math.max(1, columns), marks))
  return (
    <Box key={key} flexDirection="row" flexWrap="wrap" {...box}>
      {words.map(([a, b]) => {
        const inside = marks.filter(m => m.start >= a && m.end <= b)
        if (!inside.length) return run(a, b)
        const parts: RenderElement[] = []
        let at = a
        for (const m of inside) {
          if (m.start > at) parts.push(run(at, m.start))
          parts.push(
            <Button key={`${key}.n${m.start}`} plain {...noteHover(style, m.note)} onPress={m.press}>
              <Text color={style.theme.accent} bold={look.bold}>{m.text}</Text>
            </Button>,
          )
          at = m.end
        }
        if (at < b) parts.push(run(at, b))
        return <Box key={`${key}.w${a}`} flexDirection="row" flexShrink={0}>{parts}</Box>
      })}
    </Box>
  )
}

export const PRISM_COLORS: Record<string, keyof Theme> = {
  comment: 'codeComment', prolog: 'codeComment', doctype: 'codeComment', cdata: 'codeComment',
  string: 'codeString', char: 'codeString', 'template-string': 'codeString', 'attr-value': 'codeString', url: 'codeString',
  number: 'number', boolean: 'number', constant: 'number', symbol: 'number', inserted: 'number',
  keyword: 'codeFlag', important: 'codeFlag', atrule: 'codeFlag', rule: 'codeFlag', deleted: 'codeFlag',
  function: 'codeCommand', 'class-name': 'codeCommand', builtin: 'codeCommand', key: 'codeCommand', selector: 'codeCommand',
  property: 'link', tag: 'link', 'attr-name': 'emphasis', variable: 'emphasis', regex: 'path',
}

type Segment = { text: string; color?: string; italic: boolean }

const shownCode = (text: string, style: Style, room?: number, command = false): string => (style.reorder ? codeVisual(text, style.shape, room, width, command) : text)

const flatten = (tokens: PrismToken[], style: Style, color?: string, italic = false): Segment[] =>
  tokens.flatMap(token => {
    if (typeof token === 'string') return [{ text: token, color, italic }]
    const names = [token.type, ...(Array.isArray(token.alias) ? token.alias : token.alias ? [token.alias] : [])]
    const slot = names.map(n => PRISM_COLORS[n]).find(Boolean)
    const inner = Array.isArray(token.content) ? token.content : [token.type === 'comment' && typeof token.content === 'string' && style.reorder ? commentVisual(token.content, style.shape) : token.content]
    return flatten(inner, style, slot ? style.theme[slot] : color, italic || token.type === 'comment')
  })

const weights = new WeakMap<Map<string, unknown>, number>()

export const remember = <T,>(cache: Map<string, T>, key: string, make: () => T, limit = 200, weigh?: (key: string) => number): T => {
  const hit = cache.get(key)
  if (hit !== undefined) {
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const value = make()
  cache.set(key, value)
  let total = weigh ? (weights.get(cache) ?? 0) + weigh(key) : cache.size
  for (const old of cache.keys()) {
    if (total <= limit || old === key) break
    total -= weigh?.(old) ?? 1
    cache.delete(old)
  }
  if (weigh) weights.set(cache, total)
  return value
}

export const chars = (key: string): number => key.length

const HIGHLIGHT_CHARS = 1 << 16

type Highlights = Map<string, Segment[][]>

const highlighted = new WeakMap<Theme, [finished: Highlights, open: Highlights]>()

const grammarFor = (lang: string) => {
  const name = lang.toLowerCase()
  const grammar = Object.hasOwn(languages, name) ? languages[name] : undefined
  return grammar !== null && typeof grammar === 'object' ? grammar : undefined
}

const shownSegment = (seg: Segment, piece: string, style: Style, room?: number): Segment => ({ ...seg, text: seg.italic ? piece : shownCode(piece, style, room) })

const tokenRows = (style: Style, code: string, grammar: object, room?: number): Segment[][] => {
  const out: Segment[][] = [[]]
  for (const seg of flatten(tokenize(code, grammar), style)) {
    seg.text.split('\n').forEach((piece, i) => {
      if (i > 0) out.push([])
      if (piece) out[out.length - 1]!.push(shownSegment(seg, piece, style, room))
    })
  }
  return out
}

const segmentRows = (style: Style, lines: string[], lang: string, room?: number): Segment[][] | null => {
  const grammar = grammarFor(lang)
  if (!grammar) return null
  const code = lines.join('\n')
  const [finished, open] = highlighted.get(style.theme) ?? [new Map(), new Map()]
  highlighted.set(style.theme, [finished, open])
  const key = `${style.reorder ? style.shape : ''}\0${room ?? ''}\0${lang}\0${code}`
  const make = () => tokenRows(style, code, grammar, room)
  return isUnclosed(lines) ? remember(open, key, make, 8) : remember(finished, key, make, HIGHLIGHT_CHARS, chars)
}

const segmentRuns = (theme: Theme, segments: Segment[]): Run[] => {
  const parent = lookOf({ color: theme.codeText })
  return joinRuns(segments.map(s => ({ text: s.text, look: within(parent, lookOf({ color: s.color, italic: s.italic })) })), parent)
}

export const highlightBlock = ({ Text }: ElementTable, style: Style, lines: string[], lang: string, key: string, room?: number, shown?: number): RenderElement[] | null => {
  const rows = segmentRows(style, lines, lang, room)
  if (!rows) return null
  return rows.slice(0, shown).map((row, r) => (
    <Text key={`${key}.${r}`} color={style.theme.codeText}>
      {row.length ? drawRuns(Text, segmentRuns(style.theme, row)) : ' '}
    </Text>
  ))
}

const gutterOf = (lines: string[], numbered: boolean) => (numbered ? String(lines.length).length + 2 : 0)

const heldSegments = (style: Style, lines: string[], lang: string): Segment[][] =>
  (isShellLang(lang) ? lines.map(line => shellLine(style, line)) : segmentRows(style, lines, lang)) ?? lines.map(text => (text ? [{ text, italic: false }] : []))

const heldCode = (el: ElementTable, style: Style, lines: string[], shown: number, lang: string, gutter: number, room: number, key: string): RenderElement[] =>
  heldSegments(style, lines, lang).slice(0, shown).flatMap((segs, i) =>
    visualRows(tabbed(wordPieces(segs, null)), room).map((part, k) => (
      <el.Box key={`${key}.h${i}.${k}`} flexDirection="row">
        {numberedLine(el, style, `  ${gutter ? (k ? ' '.repeat(gutter + 2) : `${String(i + 1).padStart(gutter)}  `) : ''}`, part, `${key}.h${i}.${k}`)}
      </el.Box>
    )))

const codeRows = (el: ElementTable, style: Style, lines: string[], shown: number, lang: string, numbered: boolean, room: number, key: string): RenderElement[] => {
  if (style.nativeCode) return [<el.Code key="code" source={lines.slice(0, shown).join('\n') || ' '} {...(lang ? { language: lang } : {})} {...(numbered ? { startLine: 1 } : {})} />]
  const rows = (isShellLang(lang) ? null : highlightBlock(el, style, lines, lang, key, room, shown)) ?? lines.slice(0, shown).map((line, i) => codeLine(el, style, line, lang, `${key}.${i}`, room))
  return style.shape === 'engine' ? rows.map((row, i) => <el.Text key={`${key}.ltr${i}`} {...heldLtr(style)}>{row}</el.Text>) : rows
}

const codeBody = (el: ElementTable, style: Style, rows: RenderElement[], gutter: number, held: boolean, more: RenderNode | null): RenderElement => {
  const { Box, Text } = el
  return (
    <Box flexDirection="column" paddingLeft={held ? 0 : 2}>
      {held || !gutter || style.nativeCode ? rows : rows.map((row, i) => row.type === 'Text' ? <Box key={`n${i}`} flexDirection="row"><Text color={style.theme.codeComment} dimColor>{`${String(i + 1).padStart(gutter)}  `}</Text>{row}</Box> : row)}
      {held && more ? <Box paddingLeft={2}>{more}</Box> : more}
    </Box>
  )
}

type CodeBlock = Extract<Block, { kind: 'code' }>

type CodeView = { shown: number; numbered: boolean; room: number; gutter: number; held: boolean; plain: boolean; toggle: ReturnType<Fold> | undefined }

const codeView = (style: Style, block: CodeBlock, b: number, columns: number, fold?: Fold): CodeView => {
  const lines = block.lines
  const toggle = lines.length > FOLD_AT ? fold?.(codeId(lines), lines.length - FOLD_SHOW, `fold${b}`) : undefined
  const numbered = lines.length >= NUMBER_AT && lines.length <= NUMBER_MAX
  const room = columns - 2 - gutterOf(lines, numbered)
  const held = !style.nativeCode && mirrored(style) && lines.some(line => hasRtl(line) && (!opensLatin(line) || width(line) > room))
  return { shown: toggle?.folded ? FOLD_SHOW : lines.length, numbered, room, gutter: numbered ? String(lines.length).length : 0, held, plain: !held && !style.nativeCode && style.plainCode?.has(block) === true, toggle }
}

const plainCode = (el: ElementTable, style: Style, block: CodeBlock, view: CodeView, key: string): RenderElement[] => {
  const shell = isShellLang(block.lang)
  const lead = (i: number) => (view.gutter ? `${String(i + 1).padStart(view.gutter)}  ` : '')
  const lines = block.lines.slice(0, view.shown).map((line, i) => `${i ? '\n' : ''}${lead(i)}${shownCode(line, style, view.room, shell) || ' '}`)
  return [<el.Text key={`${key}.plain`} color={style.theme.codeText} {...heldLtr(style)}>{lines}</el.Text>]
}

const viewRows = (el: ElementTable, style: Style, block: CodeBlock, view: CodeView, key: string): RenderElement[] => {
  if (view.plain) return plainCode(el, style, block, view, key)
  return view.held ? heldCode(el, style, block.lines, view.shown, block.lang, view.gutter, view.room, key) : codeRows(el, style, block.lines, view.shown, block.lang, view.numbered, view.room, key)
}

const saving = new WeakMap<Block, number>()

const viewBody = (el: ElementTable, style: Style, block: CodeBlock, view: CodeView, key: string): RenderElement => {
  const rows = viewRows(el, style, block, view, key)
  if (!view.plain) saving.set(block, view.held || style.nativeCode ? 0 : nodeCount(rows) - view.shown)
  return codeBody(el, style, rows, view.plain ? 0 : view.gutter, view.held, view.toggle?.element ?? null)
}

export const nodeCount = (node: unknown): number => {
  if (typeof node === 'string' || typeof node === 'number') return 1
  if (node === null || typeof node !== 'object') return 0
  if (!Array.isArray(node)) return 1 + nodeCount((node as { children?: unknown }).children)
  let n = 0
  for (let i = 0; i < node.length; i++) n += nodeCount(node[i])
  return n
}

export const NODE_BUDGET = 18000

const heaviestCode = (blocks: Block[], drawn: Drawn, excess: number): Set<Block> => {
  const shown = new Set(blocks.filter((_, b) => drawn.get(b)?.element))
  const saved = (block: Block) => (block.kind === 'code' && block.lang !== 'math' && !shown.has(block) ? (saving.get(block) ?? 0) : 0)
  const plain = new Set<Block>()
  for (const block of nestedBlocks(blocks).sort((a, b) => saved(b) - saved(a))) {
    if (excess <= 0 || saved(block) <= 0) break
    plain.add(block)
    excess -= saved(block)
  }
  return plain
}

const isShellLang = (lang: string) => lang === '' || /^(sh|bash|zsh|shell|console|fish|powershell|ps1)$/i.test(lang)

const BOX_DRAWING = /[\u2500-\u257F]/

const SHELL_COMMENT = /^\s*#/

export const codeLine = (el: ElementTable, style: Style, line: string, lang: string, key: string, room?: number): RenderElement => {
  const { Text } = el
  const t = style.theme
  const isShell = isShellLang(lang)
  if (BOX_DRAWING.test(line)) return <Text key={key} color={t.codeText}>{line}</Text>
  const comment = style.reorder ? commentTail(line, style.shape) : null
  if (comment) {
    return (
      <Text key={key} color={t.codeText}>
        {comment.head ? codeLine(el, style, comment.head, lang, `${key}.h`) : null}
        <Text color={t.codeComment}>{comment.marker + comment.tail}</Text>
      </Text>
    )
  }
  if (!isShell) return <Text key={key} color={t.codeText}>{shownCode(line, style, room) || ' '}</Text>
  if (SHELL_COMMENT.test(line)) return <Text key={key} color={t.codeComment}>{line}</Text>
  return <Text key={key} color={t.codeText}>{drawRuns(Text, segmentRuns(t, shellSegments(style, line, room)))}</Text>
}

const shellLine = (style: Style, line: string): Segment[] => {
  if (!line) return []
  if (BOX_DRAWING.test(line)) return [{ text: line, color: style.theme.codeText, italic: false }]
  if (SHELL_COMMENT.test(line)) return [{ text: line, color: style.theme.codeComment, italic: false }]
  return shellSegments(style, line)
}

const shellSegments = (style: Style, line: string, room?: number): Segment[] => {
  const t = style.theme
  let seenCommand = false
  const colorOf = (p: string): string | undefined => {
    if (/^\s+$/.test(p)) return undefined
    if (/^["']/.test(p)) return t.codeString
    if (/^--?[\w-]/.test(p)) return t.codeFlag
    if (!seenCommand && !/^[$>|&;]+$/.test(p)) {
      seenCommand = true
      return t.codeCommand
    }
    if (/^(\||&&|;|\|\|)$/.test(p)) seenCommand = false
    return undefined
  }
  return shownCode(line, style, room, true).split(/("[^"]*"|'[^']*'|\s+)/).filter(p => p !== '').map(text => ({ text, color: colorOf(text), italic: false }))
}

const longestWord = (text: string): number => Math.max(0, ...text.split(/\s+/).map(width))

export const columnWidths = (natural: number[], available: number, gap: number, words: number[] = []): number[] => {
  const room = Math.max(natural.length, available - gap * (natural.length - 1))
  const total = natural.reduce((a, b) => a + b, 0)
  if (total <= room) return natural
  const minimum = natural.map((w, c) => Math.min(w, Math.max(1, words[c] ?? 1)))
  const widths = natural.map(() => 0)
  let open = natural.map((_, c) => c)
  let left = room
  for (let fixed = [-1]; fixed.length; ) {
    const share = Math.floor(left / open.length)
    const claim = (c: number) => (natural[c]! <= share ? natural[c]! : minimum[c]!)
    const minimumsFit = open.reduce((a, c) => a + minimum[c]!, 0) <= left
    const needed = open.reduce((a, c) => a + claim(c), 0)
    fixed = open.filter(c => natural[c]! <= share)
    if (minimumsFit && (!fixed.length || needed > left)) fixed = open.filter(c => minimum[c]! > share)
    fixed.forEach(c => (widths[c] = claim(c), left -= widths[c]!))
    open = open.filter(c => !fixed.includes(c))
  }
  open.forEach((c, i) => (widths[c] = Math.max(1, Math.floor(left / open.length) + (i < left % open.length ? 1 : 0))))
  while (widths.reduce((a, b) => a + b, 0) > room) {
    const widest = widths.indexOf(Math.max(...widths))
    if (widths[widest]! <= 1) break
    widths[widest]!--
  }
  return widths
}

const tableCells = (block: Extract<Block, { kind: 'table' }>) => [...block.header, ...block.rows.flat()]

const mostlyRtl = (style: Style, lines: Inline[][]): boolean => lines.filter(line => flowOf(style, line, Infinity)?.base === 'R').length * 2 > lines.length

const isRtlTable = (style: Style, block: Extract<Block, { kind: 'table' }>): boolean => mostlyRtl(style, tableCells(block).filter(cell => displayText(cell).trim() !== ''))

const ART_WIDTH = 100

const tableSize = (block: Extract<Block, { kind: 'table' }>) => {
  const cells = [block.header, ...block.rows].map(r => block.header.map((_, c) => displayText(r[c] ?? [])))
  const column = (measure: (s: string) => number) => block.header.map((_, c) => Math.max(...cells.map(r => measure(r[c]!))))
  return { natural: column(widestLine), words: column(longestWord) }
}

const tableGrid = (block: Extract<Block, { kind: 'table' }>): string => {
  const cells = [block.header, ...block.rows].map(r => block.header.map((_, c) => displayText(r[c] ?? [])))
  const { natural, words } = tableSize(block)
  const widths = columnWidths(natural, ART_WIDTH - 4, 3, words)
  const pad = (text: string, c: number, align: 'left' | 'right' | 'center') => {
    const room = Math.max(0, widths[c]! - width(text))
    const left = align === 'right' ? room : align === 'center' ? Math.floor(room / 2) : 0
    return ' '.repeat(left) + text + ' '.repeat(room - left)
  }
  const line = (l: string, m: string, r: string) => l + widths.map(w => '─'.repeat(w + 2)).join(m) + r
  const row = (r: string[], header: boolean) => {
    const lines = r.map((text, c) => wrapRanges(text, widths[c]!).map(([a, b]) => text.slice(a, b)))
    return Array.from({ length: Math.max(...lines.map(l => l.length)) }, (_, i) =>
      `│ ${lines.map((l, c) => pad(l[i] ?? '', c, header ? 'center' : block.align[c] ?? 'left')).join(' │ ')} │`)
  }
  const art = [line('┌', '┬', '┐'), ...row(cells[0]!, true), ...cells.slice(1).flatMap(r => [line('├', '┼', '┤'), ...row(r, false)]), line('└', '┴', '┘')]
  return art.join('\n')
}

export const tableArt = (block: Extract<Block, { kind: 'table' }>): string => ['```', tableGrid(block), '```'].join('\n')

const artsOf = (drawn: string | undefined, block: Block): { art?: string | (() => string); grid?: string | (() => string) } =>
  drawn !== undefined ? { art: drawn, grid: drawn } : block.kind === 'table' ? { art: () => tableArt(block), grid: () => tableGrid(block) } : {}

const clip = ({ Box }: ElementTable, w: number, drawn: RenderElement, key?: string) => (
  <Box key={key} flexDirection="column" minWidth={w}>
    <Box height={0} flexGrow={1} overflow="hidden">
      {drawn}
    </Box>
  </Box>
)

type Line = Part[] | RenderElement

type Side = 'flex-start' | 'center' | 'flex-end'

const KNOWN_WIDTH = /^[ -~\u00A0-\u00AC\u00AE-\u02FF\u0370-\u0377\u037A-\u037F\u0384-\u038A\u038C\u038E-\u03A1\u03A3-\u0482\u048A-\u052F\u2010-\u2027\u2030-\u203B\u203D-\u2048\u204A-\u205E\u2070\u2071\u2074-\u208E\u2090-\u209C\u20A0-\u20C0\u2100-\u2121\u2123-\u2138\u213A-\u218B\u2190-\u2193\u2200-\u22FF\u2500-\u25A9\u25AC-\u25B5\u25B7-\u25BF\u25C1-\u25FA\u2713\u2717\u2718\u3001-\u3029\u3031-\u303C\u3041-\u3096\u309B-\u30FF\u3105-\u312F\u3131-\u3163\u3165-\u318E\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7A3\uFF01-\uFF9D]*$/

const hasNote = (nodes: Inline[]): boolean => nodes.some(n => n.kind === 'footnote' || ('children' in n && hasNote(n.children)))

const blank = (size: number): Run => ({ text: ' '.repeat(size), look: PLAIN })

const flatCell = (el: ElementTable, style: Style, content: Inline[], head: Look | undefined, w: number, side: Side): Part[] | undefined => {
  const text = inlineText(content)
  const pad = w - width(text)
  if (pad < 0 || !KNOWN_WIDTH.test(text) || hasNote(content)) return undefined
  const before = side === 'flex-end' ? pad : side === 'center' ? Math.floor(pad / 2) : 0
  const parts = head ? [{ text, look: head }] : mergedParts(inlineParts(el, style, inlineLooks(style.theme), content, PLAIN), PLAIN)
  return [blank(before), ...parts, blank(pad - before)]
}

const boxLine = (cells: Part[][], look: Look): Part[] =>
  [{ text: '│ ', look }, ...cells.flatMap((cell, i) => (i ? [{ text: ' │ ', look }, ...cell] : cell)), { text: ' │', look }]

const NEWLINE: Run = Object.freeze({ text: '\n', look: PLAIN })

const stacked = (lines: Part[][]): Part[] => {
  const out: Part[] = []
  for (const part of lines.flatMap((line, i) => (i ? [NEWLINE, ...line] : line))) {
    if (isRun(part) && !part.text) continue
    const last = out[out.length - 1]
    if (isRun(part) && last && isRun(last) && (last.look === part.look || part === NEWLINE)) out[out.length - 1] = { text: last.text + part.text, look: last.look }
    else out.push(part)
  }
  return out
}

const drawLines = (el: ElementTable, lines: Line[], key: string): RenderElement[] => {
  const out: RenderElement[] = []
  let open: Part[][] = []
  const close = () => {
    if (open.length) out.push(<el.Text key={`${key}.f${out.length}`}>{drawParts(el, stacked(open))}</el.Text>)
    open = []
  }
  for (const line of lines) {
    if (Array.isArray(line)) {
      open.push(line)
      continue
    }
    close()
    out.push(line)
  }
  close()
  return out
}

const tableWidth = (widths: number[], box: boolean, gap: number): number =>
  widths.reduce((a, b) => a + b, 0) + (box ? 3 * widths.length + 1 : gap * (widths.length - 1))

const tableEdges = (style: Style, block: Extract<Block, { kind: 'table' }>, rtl: boolean, mirror: boolean) => {
  const held = !rtl && mirrored(style) && tableCells(block).some(containsRtl)
  return {
    opening: mirror ? ROW_MARK_TEXT : held ? LTR_BLANK : '',
    wall: (text: string) => (mirror ? text.replace('│', WALL) : held ? text.replace(/ $/, LTR_BLANK) : text),
    held,
    marked: !mirror && !held,
  }
}

const renderTable = (el: ElementTable, style: Style, block: Extract<Block, { kind: 'table' }>, columns: number, key: string, rtl: boolean, tip?: Tip) => {
  const { Box, Text } = el
  const t = style.theme
  const box = style.tableStyle === 'box'
  const gap = box ? 0 : style.tableStyle === 'grid' ? 3 : 2
  const { natural, words } = tableSize(block)
  const widths = box ? columnWidths(natural, columns - 4, 3, words) : columnWidths(natural, columns, gap, words)
  const order = natural.map((_, c) => c)
  const mirror = rtl && mirrored(style)
  const flip = rtl && !mirror
  const { opening, wall, held, marked } = tableEdges(style, block, rtl, mirror)
  if (flip) order.reverse()
  const lead = (k: string) => (opening ? <Text key={`${k}.m`} color={t.rule}>{opening}</Text> : null)
  const columnGap = held ? 0 : gap
  const spacer = (k: string) => (held ? <Text key={k}>{LTR_BLANK + ' '.repeat(gap - 1)}</Text> : null)
  const ruleChar = style.tableStyle === 'grid' ? '━' : '─'
  const justify = (c: number): Side =>
    block.align[c] === 'right' ? 'flex-end' : block.align[c] === 'center' ? 'center' : 'flex-start'
  const ruleLook = lookOf({ color: t.tableRule, dimColor: !t.tableRule })
  const headLook = lookOf({ bold: true, color: t.tableHeader })
  const flat = !style.nativeCode && !rtl && !held && tableWidth(widths, box, gap) <= columns

  const rule = (k: string, heavy: boolean) => (
    <Box key={k} flexDirection="row" columnGap={columnGap}>
      {lead(k)}
      {order.map((c, i) => [
        i > 0 && spacer(`${k}.${c}g`),
        <Text key={`${k}.${c}`} color={t.tableRule} dimColor={!heavy && !t.tableRule}>
          {(heavy ? ruleChar : '─').repeat(widths[c]!)}
        </Text>,
      ])}
    </Box>
  )

  const bar = (k: string, text: string, lines = 1) => (
    <Text key={k} color={t.tableRule} dimColor={!t.tableRule}>{Array.from({ length: lines }, () => text).join('\n')}</Text>
  )
  const clipped = (lines: number) => (k: string, text: string) => clip(el, width(text), bar(`${k}.b`, text, lines), k)
  const edgeText = ([left, fill, mid, right]: string) => (mirror ? WALL : left) + order.map(c => fill!.repeat(widths[c]! + 2)).join(mid) + (mirror ? WALL : right)
  const edge = (k: string, chars: string): Line => (flat ? [{ text: edgeText(chars), look: ruleLook }] : bar(k, edgeText(chars)))

  const terminalRow = (cells: Inline[][], k: string, isHeader: boolean) => {
    const parts: Inline[] = box ? [{ kind: 'dim', text: '│ ' }] : []
    order.forEach((c, i) => {
      if (i > 0) parts.push(box ? { kind: 'dim', text: ' │ ' } : { kind: 'text', text: ' '.repeat(gap) })
      const cell = flowOf({ ...style, shape: 'visual' }, cells[c] ?? [], Infinity)
      const content = cell ? cell.lines[0]! : (cells[c] ?? [])
      const pad = Math.max(0, widths[c]! - width(inlineText(content)))
      const side = cell?.base === 'R' && block.align[c] !== 'center' ? 'flex-end' : justify(c)
      const before = side === 'flex-end' ? pad : side === 'center' ? Math.floor(pad / 2) : 0
      parts.push({ kind: 'text', text: ' '.repeat(before) }, ...(isHeader ? [{ kind: 'strong' as const, children: content }] : content), { kind: 'text', text: ' '.repeat(pad - before) })
    })
    if (box) parts.push({ kind: 'dim', text: ' │' })
    return <Text key={k}>{renderInline(el, style, terminalLine(parts))}</Text>
  }

  const row = (cells: Inline[][], k: string, isHeader: boolean, border: (k: string, text: string) => RenderElement = bar) => rtl && style.shape === 'inverse' ? terminalRow(cells, k, isHeader) : (
    <Box key={k} flexDirection="row" columnGap={columnGap} alignItems="stretch">
      {!box && lead(k)}
      {box && border(`${k}.l`, wall('│ '))}
      {order.map((c, i) => {
        const w = widths[c]!
        const cell = cellFlow(style, cells[c] ?? [], held, marked)
        const content = cell ? cell.lines[0]! : (cells[c] ?? [])
        const side = mirror ? (block.align[c] === 'center' ? 'center' : 'flex-start') : cell?.base === 'R' && block.align[c] !== 'center' ? 'flex-end' : justify(c)
        const runs = isHeader ? headerRuns(content) : content
        const cellBox = (
          <Box key={`${k}.${c}`} width={w} flexShrink={0} justifyContent={side}>
            {pressInline(el, style, runs, w, `${k}.${c}.p`, tip, isHeader ? { bold: true, color: t.tableHeader } : {}, { justifyContent: side })
              ?? (isHeader
                ? <Text bold color={t.tableHeader}>{runs.some(n => n.kind === 'footnote') ? renderInline(el, style, runs, lookOf({ bold: true, color: t.tableHeader })) : inlineText(runs)}</Text>
                : mirror && inlineText(content).trim() === '' ? <Text>{' '.repeat(w)}</Text>
                : textOf(el, PLAIN, renderInline(el, style, content)))}
          </Box>
        )
        return [i > 0 && (box ? border(`${k}.${c}s`, wall(' │ ')) : spacer(`${k}.${c}g`)), cellBox]
      })}
      {box && border(`${k}.r`, wall(' │'))}
    </Box>
  )

  const flatRow = (cells: Inline[][], isHeader: boolean): Part[] | undefined => {
    if (!flat || (!isHeader && cells.some(hasLink))) return undefined
    const drawn: Part[][] = []
    for (const c of order) {
      const cell = flatCell(el, style, cells[c] ?? [], isHeader ? headLook : undefined, widths[c]!, justify(c))
      if (!cell) return undefined
      drawn.push(cell)
    }
    return box ? boxLine(drawn, ruleLook) : drawn.flatMap((cell, i) => (i ? [blank(gap), ...cell] : cell))
  }

  const line = (cells: Inline[][], k: string, isHeader: boolean): Line => flatRow(cells, isHeader) ?? row(cells, k, isHeader)

  const wrappedRow = (cells: Inline[][], k: string, isHeader: boolean): Line[] => {
    if (!isHeader && cells.some(hasLink)) return [row(cells, k, isHeader, clipped(Math.max(1, ...widths.map((w, c) => mostLines(displayText(cells[c] ?? []), w)))))]
    const wrapped = widths.map((w, c) => {
      const content = cells[c] ?? []
      if (natural[c]! <= w && !inlineText(content).includes('\n')) return [content]
      return wrapInline(isHeader ? headerRuns(content) : content, w)
    })
    return Array.from({ length: Math.max(...wrapped.map(l => l.length)) }, (_, i) =>
      line(wrapped.map(l => l[i] ?? []), `${k}.${i}`, isHeader))
  }

  if (box) {
    const lines: Line[] = [edge(`${key}.t`, '┌─┬┐'), ...wrappedRow(block.header, `${key}.h`, true), edge(`${key}.hr`, '╞═╪╡')]
    block.rows.forEach((r, i) => {
      if (i > 0) lines.push(edge(`${key}.r${i}r`, '├─┼┤'))
      lines.push(...wrappedRow(r, `${key}.r${i}`, false))
    })
    lines.push(edge(`${key}.b`, '└─┴┘'))
    return <Box key={key} flexDirection="column" {...(flip ? { alignSelf: 'flex-end' as const } : {})}>{drawLines(el, lines, key)}</Box>
  }

  const body: Line[] = [line(block.header, `${key}.h`, true), rule(`${key}.hr`, true)]
  block.rows.forEach((r, i) => {
    body.push(line(r, `${key}.r${i}`, false))
    if (style.tableStyle !== 'minimal' && i < block.rows.length - 1) body.push(rule(`${key}.r${i}r`, false))
  })
  return <Box key={key} flexDirection="column" {...(flip ? { alignSelf: 'flex-end' as const } : {})}>{drawLines(el, body, key)}</Box>
}

const renderHeading = (el: ElementTable, style: Style, block: Extract<Block, { kind: 'heading' }>, key: string) => {
  const rtl = flowOf(style, block.inline, Infinity)
  if (!rtl) return drawHeading(el, style, block, block.inline, key)
  if (rtl.base === 'R' && mirrored(style) && style.headingStyle === 'banner' && block.level <= 2) return mirroredBanner(el, style, block.level, rtl.lines[0]!, key)
  const heading = drawHeading(el, style, block, rtl.lines[0]!, key)
  return rtl.base === 'R' && !mirrored(style) ? <el.Box key={key} alignSelf="flex-end">{heading}</el.Box> : heading
}

const mirroredBanner = (el: ElementTable, style: Style, level: number, inline: Inline[], key: string) => {
  const { Box, Text } = el
  const color = style.theme.heading
  const text = <Text key={`${key}.h`} bold underline={level === 2} color={color}>{level === 1 ? `${WALL} ` : ''}{renderInline(el, style, inline, lookOf({ bold: true, underline: level === 2, color }))}{level === 1 ? ` ${WALL}` : ''}</Text>
  if (level === 2) return text
  const edge = (k: string) => <Text key={k} color={color}>{WALL + '━'.repeat(width(inlineText(inline)) + 2) + WALL}</Text>
  return <Box key={key} flexDirection="column">{edge(`${key}.t`)}{text}{edge(`${key}.b`)}</Box>
}

const HEADING_RULE = 200

const drawHeading = (el: ElementTable, style: Style, block: Extract<Block, { kind: 'heading' }>, inline: Inline[], key: string) => {
  const { Box, Text } = el
  const t = style.theme
  const color = block.level <= 2 ? t.heading : t.accent ?? t.heading
  const label = inlineText(inline)
  const bold = lookOf({ bold: true, color })
  const minor = block.level === 3 ? color : t.strong
  switch (style.headingStyle) {
    case 'uppercase':
      return <Text key={key} bold color={color}>{block.level === 1 ? label.toUpperCase() : label}</Text>
    case 'underline':
      return <Text key={key} bold underline={block.level <= 2} color={color}>{label}</Text>
    case 'banner':
      if (block.level === 1) return <Box key={key} alignSelf="flex-start" borderStyle="bold" borderColor={color} paddingX={1}><Text bold color={color}>{renderInline(el, style, inline, bold)}</Text></Box>
      return block.level === 2
        ? <Box key={key} flexDirection="column" alignSelf="flex-start"><Text bold color={color}>{renderInline(el, style, inline, bold)}</Text>{style.gridFace ? <Box flexDirection="row"><Box width={0} flexGrow={1} height={1} overflow="hidden"><Text color={color}>{'━'.repeat(HEADING_RULE)}</Text></Box></Box> : <Text color={color}>{'━'.repeat(width(label))}</Text>}</Box>
        : <Text key={key} bold color={minor}>{renderInline(el, style, inline, lookOf({ bold: true, color: minor }))}</Text>
    default:
      return <Text key={key} bold color={color}>{renderInline(el, style, inline, bold)}</Text>
  }
}

const ALERT_COLOR = { note: 'blue', tip: 'green', important: 'magenta', warning: 'yellow', caution: 'red' } as const

const prose = (style: Style) => (style.inside === 'quote' ? { italic: true, color: style.theme.quote } : {})

const renderParagraph = (el: ElementTable, style: Style, block: Extract<Block, { kind: 'paragraph' }>, columns: number, key: string, tip?: Tip) => {
  const { Box, Text } = el
  const rtl = flowOf(style, block.inline, columns)
  if (rtl?.base === 'R') return <Box key={key} flexDirection="column" {...(mirrored(style) ? {} : { alignItems: 'flex-end' as const })}>{renderFlow(el, style, rtl.lines, key, prose(style))}</Box>
  const inline = rtl ? rtl.lines[0]! : block.inline
  return pressInline(el, style, inline, columns, key, tip, { ...(style.narration ? { bold: true } : {}), ...prose(style) }) ?? <Text key={key} bold={style.narration} {...prose(style)}>{renderInline(el, style, inline, lookOf({ bold: style.narration, ...prose(style) }))}</Text>
}

const leadInline = (blocks: Block[]): Inline[] => {
  const first = blocks[0]
  if (first?.kind === 'paragraph' || first?.kind === 'heading') return first.inline
  if (first?.kind === 'list') return first.items[0]?.inline ?? []
  return first?.kind === 'quote' || first?.kind === 'alert' ? leadInline(first.blocks) : []
}

const renderNested = (el: ElementTable, style: Style, blocks: Block[], columns: number, key: string, copy?: CopyButton, fold?: Fold, tip?: Tip) =>
  drawBlocks(el, style, blocks, columns, drawMath(el, style, blocks), copy && ((text, id, label, html) => copy(text, `${key}.${id}`, label, html)), fold && ((id, hidden, k) => fold(id, hidden, `${key}.${k}`)), tip)

const quoteBar = (el: ElementTable, text: string, color: string | undefined, lines: number) =>
  lines <= 1 ? <el.Text color={color}>{text}</el.Text> : clip(el, width(text), <el.Text color={color}>{Array.from({ length: lines }, () => text).join('\n')}</el.Text>)

const renderQuote = (el: ElementTable, style: Style, block: Extract<Block, { kind: 'quote' }>, columns: number, key: string, copy?: CopyButton, fold?: Fold, tip?: Tip) => {
  const { Box } = el
  const t = style.theme
  const inner = columns - 2
  const lines = heightOf(block.blocks, inner)
  const body = <Box flexDirection="column" rowGap={1}>{renderNested(el, { ...style, inside: 'quote' }, block.blocks, inner, key, copy, fold, tip)}</Box>
  if (!mirrored(style) && flowOf(style, leadInline(block.blocks), inner)?.base === 'R') {
    return (
      <Box key={key} flexDirection="row" justifyContent="flex-end" alignItems="stretch">
        {body}
        {quoteBar(el, ' │', t.accent, lines)}
      </Box>
    )
  }
  return (
    <Box key={key} flexDirection="row" alignItems="stretch">
      {quoteBar(el, mirrored(style) ? ROW_MARK_TEXT : '│ ', t.accent, lines)}
      {body}
    </Box>
  )
}

const renderAlert = (el: ElementTable, style: Style, block: Extract<Block, { kind: 'alert' }>, columns: number, key: string, copy?: CopyButton, fold?: Fold, tip?: Tip) => {
  const { Box, Text } = el
  const color = ALERT_COLOR[block.level]
  const inner = columns - 4
  const hebrew = flowOf(style, leadInline(block.blocks), inner)?.base === 'R'
  const label = block.level[0]!.toUpperCase() + block.level.slice(1)
  const body = block.blocks.length ? <Box flexDirection="column" rowGap={1}>{renderNested(el, { ...style, inside: 'alert' }, block.blocks, inner, key, copy, fold, tip)}</Box> : null
  if (hebrew && mirrored(style)) {
    const lines = 1 + (block.blocks.length ? 1 + heightOf(block.blocks, inner) : 0)
    const edge = (k: string) => <Text key={k} color={color}>{WALL + '─'.repeat(inner + 2) + WALL}</Text>
    return (
      <Box key={key} flexDirection="column" alignSelf="flex-start">
        {edge(`${key}.t`)}
        <Box flexDirection="row" alignItems="stretch">
          {quoteBar(el, ROW_MARK_TEXT, color, lines)}
          <Box flexDirection="column" width={inner}>
            <Text bold color={color}>{label}</Text>
            {body}
          </Box>
          {quoteBar(el, ` ${WALL}`, color, lines)}
        </Box>
        {edge(`${key}.b`)}
      </Box>
    )
  }
  return (
    <Box key={key} flexDirection="column" alignSelf={hebrew ? 'flex-end' : 'flex-start'} {...(hebrew ? { alignItems: 'flex-end' as const } : {})} borderStyle="round" borderColor={color} paddingX={1}>
      <Text bold color={color}>{label}</Text>
      {body}
    </Box>
  )
}

const listSide = (style: Style, block: Extract<Block, { kind: 'list' }>): 'R' | 'L' | undefined => {
  if (!style.reorder || !block.items.some(item => containsRtl(item.inline))) return undefined
  return mostlyRtl(style, block.items.map(item => item.inline)) ? 'R' : 'L'
}

const leftItem = (el: ElementTable, style: Style, depth: number, lead: string, color: string | undefined, inline: Inline[], room: number, k: string, look: TextLook, tip?: Tip) => {
  const { Box, Text } = el
  return (
    <Box key={k} flexDirection="row" paddingLeft={depth * 2}>
      <Text color={color}>{lead}</Text>
      {pressInline(el, style, inline, room, `${k}.i`, tip, look) ?? <Text {...look}>{renderInline(el, style, inline, lookOf(look))}</Text>}
    </Box>
  )
}

const leadSide = (style: Style, block: Block, room: number) => (block.kind === 'list' ? listSide(style, block) : flowOf(style, leadInline([block]), room)?.base)

const heldItem = (el: ElementTable, style: Style, item: Extract<Block, { kind: 'list' }>['items'][number], glyph: string, color: string | undefined, room: number, k: string, look: TextLook) => {
  const { Box, Text } = el
  const lines = mirrored(style) ? flowOf(style, item.inline, room - 1, false)!.lines.map(line => [{ kind: 'text' as const, text: LTR_BLANK }, ...line]) : flowOf(style, item.inline, room)!.lines
  return (
    <Box key={k} flexDirection="row" paddingLeft={item.depth * 2}>
      <Text color={color}>{mirrored(style) ? glyph : `${glyph} `}</Text>
      <Box flexDirection="column">{renderFlow(el, style, lines, k, look)}</Box>
    </Box>
  )
}

const listRow = (el: ElementTable, style: Style, item: Extract<Block, { kind: 'list' }>['items'][number], glyph: string, glyphColor: string | undefined, side: 'R' | 'L' | undefined, room: number, k: string, look: TextLook, tip?: Tip) => {
  const { Box, Text } = el
  const rtl = flowOf(style, item.inline, room)
  const right = side ? side === 'R' : rtl?.base === 'R'
  const lines = rtl?.lines ?? [mirrored(style) ? [ROW_MARK, ...item.inline] : item.inline]
  const drawn = () => (rtl ? null : pressInline(el, style, lines[0]!, room, `${k}.i`, tip, look, mirrored(style) ? {} : { justifyContent: 'flex-end' })) ?? renderFlow(el, style, lines, k, look)
  return right && mirrored(style) ? (
    <Box key={k} flexDirection="row">
      <Text color={glyphColor}>{`${' '.repeat(item.depth * 2)}${glyph} `}</Text>
      <Box flexDirection="column">{drawn()}</Box>
    </Box>
  ) : right ? (
    <Box key={k} flexDirection="row" justifyContent="flex-end" paddingRight={item.depth * 2}>
      <Box flexDirection="column" alignItems="flex-end">{drawn()}</Box>
      <Text color={glyphColor}>{` ${listMarker(glyph, style.shape)}`}</Text>
    </Box>
  ) : rtl?.base === 'R' ? (
    heldItem(el, style, item, glyph, glyphColor, room, k, look)
  ) : (
    leftItem(el, style, item.depth, `${glyph} `, glyphColor, rtl ? rtl.lines[0]! : item.inline, room, k, look, tip)
  )
}

const TASK_GLYPHS = { checks: ['[ ]', '[✓]'], ticks: ['○', '✓'], box: ['□', '✓'], progress: ['○', '✓'] } as const

const renderList = (el: ElementTable, style: Style, block: Extract<Block, { kind: 'list' }>, columns: number, key: string, copy?: CopyButton, fold?: Fold, tip?: Tip) => {
  const { Box, Text } = el
  const t = style.theme
  const tasks = block.items.filter(item => item.task !== undefined)
  const done = tasks.filter(item => item.task).length
  const filled = tasks.length ? Math.round((done / tasks.length) * 20) : 0
  const strike = style.taskStyle === 'checks' || style.taskStyle === 'box'
  const tick = style.taskStyle === 'ticks' || style.taskStyle === 'progress'
  const side = listSide(style, block)
  return (
    <Box key={key} flexDirection="column">
      {style.taskStyle === 'progress' && tasks.length > 0 && (
        <Text>
          <Text color={t.accent}>{'━'.repeat(filled)}</Text>
          <Text color={t.bullet} dimColor>{'─'.repeat(20 - filled)}</Text>
          <Text color={t.bullet}>{` ${done}/${tasks.length} done`}</Text>
        </Text>
      )}
      {block.items.map((item, i) => {
        const k = `${key}.${i}`
        const glyph = item.task !== undefined ? TASK_GLYPHS[style.taskStyle][item.task ? 1 : 0] : /\d/.test(item.marker) ? item.marker : item.depth ? '◦' : '•'
        const glyphColor = item.task && tick ? t.accent : t.bullet
        const pad = item.depth * 2 + glyph.length + 1
        const look = { ...(item.task === true ? { dimColor: true, strikethrough: strike } : {}), ...prose(style) }
        const row = listRow(el, style, item, glyph, glyphColor, side, columns - pad, k, look, tip)
        if (!item.blocks) return row
        return (
          <Box key={k} flexDirection="column">
            {row}
            <Box flexDirection="column" paddingLeft={pad}>{renderNested(el, style, item.blocks, columns - pad, k, copy, fold, tip)}</Box>
          </Box>
        )
      })}
    </Box>
  )
}

export type CopyButton = (text: string | (() => string), key: string, label?: string, rich?: (() => string) | 'png') => RenderElement | null
export type Drawn = Map<number, { element?: RenderElement; art?: string; note?: string; full?: ChartArt; lean?: () => RenderElement }>

const noteRow = ({ Text }: ElementTable, t: Theme, note?: string): RenderElement | null => (note ? <Text color={t.codeComment}>{note}</Text> : null)
export type FoldLook = { label?: string; face?: (folded: boolean) => RenderElement }
export type Fold = (id: string, hidden: number, key: string, look?: FoldLook) => { folded: boolean; element: RenderElement; faced: boolean; around?: (rows: RenderElement, hover: TextHoverProps) => RenderElement } | null
export type Tip = (note: number) => (() => void) | undefined

export const instanceKey = (id: string): string => {
  let h = 5381
  for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

export const noteTip = (blocks: Block[], toast: (text: string) => void): Tip | undefined => {
  const notes = blocks.find(block => block.kind === 'notes')
  if (notes?.kind !== 'notes') return undefined
  const text = new Map(notes.notes.map(note => [note.note, `${note.mark} ${inlineText(note.inline)}`]))
  return note => {
    const line = text.get(note)
    return line === undefined ? undefined : () => toast(line)
  }
}

const NUMBER_AT = 10
const NUMBER_MAX = 400
const FOLD_AT = 30
const FOLD_SHOW = 20

const codeId = (lines: string[]): string => {
  let h = 5381
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) h = (h * 33 + line.charCodeAt(i)) | 0
    h = (h * 33 + 10) | 0
  }
  return `${lines.length}:${(h >>> 0).toString(36)}`
}

const copySource = (style: Style, block: Block): string | undefined =>
  block.kind === 'code' ? block.lines.join('\n')
  : block.kind === 'table' ? block.raw
  : style.inside ? undefined
  : block.kind === 'list' ? block.raw
  : block.kind === 'quote' || block.kind === 'alert' ? block.raw.split('\n').map(line => line.replace(/^\s*>\s?/, '')).join('\n')
  : undefined

export const drawMath = (el: ElementTable, style: Style, blocks: Block[], drawn: Drawn = new Map()): Drawn => {
  for (const [i, block] of blocks.entries()) {
    const tex = drawn.has(i) ? null : mathOf(block)
    const text = tex === null ? null : texText(tex)
    if (text && !text.includes('\\')) drawn.set(i, { element: <el.Box key={`b${i}`} paddingLeft={2}><el.Text italic color={style.theme.emphasis}>{text}</el.Text></el.Box> })
  }
  return drawn
}

const opensWithCopy = (block: Block): boolean =>
  block.kind === 'quote' && (block.blocks[0]?.kind === 'code' || block.blocks[0]?.kind === 'table' || (block.blocks[0] !== undefined && opensWithCopy(block.blocks[0])))

const holdsOnlyEmptyCode = (block: Block): boolean =>
  block.kind === 'quote' && block.blocks.length === 1 && ((block.blocks[0]!.kind === 'code' && block.blocks[0]!.lines.length === 0) || holdsOnlyEmptyCode(block.blocks[0]!))

export const MARK = 2

export const markerRoom = (style: Style): number => (style.copyButtons && style.copyButtonStyle === 'hover' ? MARK : 0)

const codeLabel = (block: Extract<Block, { kind: 'code' }>): string => `── ${block.lang || 'code'}`

type Float = { needs: number; marker: RenderElement; element: RenderElement }

const buttonText = (button: RenderElement | null | undefined): string | undefined =>
  button?.type === 'Button' ? `[ ${button.props.label} ]` : button?.type === 'Text' ? (button.children ?? []).filter((c): c is string => typeof c === 'string').join('') : undefined

const keyOf = (button: RenderElement): string => String(('props' in button ? (button.props as { key?: unknown } | undefined)?.key : undefined) ?? '')

const markedRow = ({ Box }: ElementTable, key: string, element: RenderElement, float: Float, start: boolean) => (
  <Box key={key} flexDirection="column" {...(start ? { alignItems: 'flex-end' as const } : { alignSelf: 'flex-start' as const })}>
    <Box flexDirection="row" columnGap={1} minWidth={float.needs} {...(start ? { justifyContent: 'flex-end' as const } : {})}>
      {start ? float.marker : null}
      {element}
      {start ? null : float.marker}
      {float.element}
    </Box>
  </Box>
)

const leaner = (drawn: Drawn): Drawn => ([...drawn.values()].some(d => d.lean) ? new Map([...drawn].map(([i, d]) => [i, d.lean ? { ...d, element: d.lean() } : d])) : drawn)

export const renderBlocks = (el: ElementTable, style: Style, blocks: Block[], columns: number, drawn: Drawn = new Map(), copy?: CopyButton, fold?: Fold, tip?: Tip): RenderElement[] => {
  const out = drawBlocks(el, style, blocks, columns, drawn, copy, fold, tip)
  const total = style.plainCode ? 0 : nodeCount(out)
  if (total <= NODE_BUDGET) return out
  const lean = leaner(drawn)
  const fitted = lean === drawn ? out : drawBlocks(el, style, blocks, columns, lean, copy, fold, tip)
  const excess = (fitted === out ? total : nodeCount(fitted)) - NODE_BUDGET
  const plainCode = excess > 0 ? heaviestCode(blocks, lean, excess) : undefined
  return plainCode?.size ? drawBlocks(el, { ...style, plainCode }, blocks, columns, lean, copy, fold, tip) : fitted
}

const drawBlocks = (el: ElementTable, style: Style, blocks: Block[], columns: number, drawn: Drawn = new Map(), copy?: CopyButton, fold?: Fold, tip?: Tip): RenderElement[] => {
  const { Box, Text } = el
  const t = style.theme
  const hover = style.copyButtonStyle === 'hover'
  const reserved = (buttons: (RenderElement | null | undefined)[]): number =>
    buttons.reduce<number>((w, button) => {
      const shown = buttonText(button)
      return shown === undefined ? w : w + (w ? 1 : 0) + width(shown)
    }, 0)
  const fitted = (parts: (RenderElement | null | undefined)[]): RenderElement[] =>
    parts.reduce<RenderElement[]>((kept, part) => (part && (!kept.length || reserved([...kept, part]) <= columns) ? [...kept, part] : kept), [])
  const scopeOf = (button: RenderElement): string => `copy:${style.noteKey ?? ''}:${keyOf(button)}`
  const floating = (kept: RenderElement[], low = false, start = false): Float => {
    const scope = scopeOf(kept[0]!)
    return {
      needs: reserved(kept),
      marker: <Box flexShrink={0} alignSelf={low ? 'flex-end' : 'flex-start'} hover={{ scope }}><Text dimColor>⧉</Text></Box>,
      element: <Box position="absolute" {...(low ? { bottom: 0 } : { top: 0 })} {...(start ? { left: 0 } : { right: 0 })} display="none" hover={{ scope, display: 'flex' }}>{kept.flatMap((button, i) => (i ? [<Text key={`gap${i}`}> </Text>, button] : [button]))}</Box>,
    }
  }
  const shown = blocks.map(block => drawable(block, style))
  const rtlTables = shown.map(block => style.reorder && block.kind === 'table' && isRtlTable(style, block))
  const buttons = blocks.map((block, b) => {
    const text = hover && holdsOnlyEmptyCode(block) ? undefined : copySource(style, block)
    const isPlainCode = block.kind === 'code' && !drawn.get(b)?.element
    const { art, grid } = artsOf(drawn.get(b)?.art, block)
    const first = text === undefined || isPlainCode ? null : copy?.(text, `copy${b}`, block.kind === 'table' ? '⧉ md' : art === undefined ? undefined : '⧉ source')
    const second = first && art !== undefined ? copy?.(art, `art${b}`, '⧉ art') : null
    const html = first && block.kind === 'table' ? copy?.(() => tableText(block), `html${b}`, '⧉ html', () => tableHtml(block)) : null
    return { first, second, html, png: second && copy?.(grid!, `png${b}`, '▣ png', 'png') }
  })
  const codeHead = (label: string, button: RenderElement | null) => {
    if (!hover || !button) return null
    const float = floating([button])
    return { ...float, minWidth: Math.min(columns, width(label) + 1 + float.needs) }
  }
  const room = (b: number) => (hover && buttons[b]!.first ? columns - MARK : columns)
  const beside = (b: number) => (!buttons[b]!.first ? columns : hover ? columns - MARK : columns - reserved([buttons[b]!.first]) - 2)
  const rendered = shown.map((block, b) => {
    const key = `b${b}`
    switch (block.kind) {
      case 'heading':
        return renderHeading(el, style, block, key)
      case 'paragraph':
        return drawn.get(b)?.element ?? renderParagraph(el, style, block, columns, key, tip)
      case 'quote':
        return renderQuote(el, style, block, beside(b), key, copy, fold, tip)
      case 'alert':
        return renderAlert(el, style, block, beside(b), key, copy, fold, tip)
      case 'rule':
        return <Text key={key} color={t.rule} dimColor={!t.rule}>{'─'.repeat(Math.max(8, Math.min(columns, 80)))}</Text>
      case 'code': {
        const done = drawn.get(b)?.element
        if (done) return done
        const note = drawn.get(b)?.note
        const view = codeView(style, block, b, columns, fold)
        const button = copy?.(block.lines.join('\n'), `copy${b}`) ?? null
        const label = codeLabel(block)
        const head = codeHead(label, button)
        return (
          <Box key={key} flexDirection="column" alignSelf="flex-start" minWidth={head?.minWidth}>
            {noteRow(el, t, note)}
            <Box flexDirection="row" justifyContent="space-between" columnGap={head ? 1 : 4}>
              <Text color={t.codeComment}>{label}</Text>
              {head ? head.marker : button}
              {head?.element}
            </Box>
            {viewBody(el, style, block, view, key)}
          </Box>
        )
      }
      case 'list':
        return renderList(el, style, block, room(b), key, copy, fold, tip)
      case 'table':
        return renderTable(el, style, block, room(b), key, rtlTables[b]!, tip)
      case 'notes':
        return (
          <Box key={key} flexDirection="column">
            <Text dimColor>{'─'.repeat(Math.min(columns, 12))}</Text>
            {block.notes.map((note, i) => <Text key={`${key}.${i}`} dimColor {...noteHover(style, note.note)}>{note.mark} {renderInline(el, style, note.inline, lookOf({ dimColor: true }))}</Text>)}
          </Box>
        )
    }
  })
  const copied = rendered.map((element, b) => {
    const block = blocks[b]!
    const { first, second, html, png } = buttons[b]!
    if (!first) return element
    const { Box } = el
    const hebrew = style.reorder && hasRtl(block.raw)
    const rtl = hebrew && !mirrored(style)
    const mirror = hebrew && mirrored(style)
    if (hover) {
      const wide = rtl && (block.kind === 'list' || block.kind === 'quote' || block.kind === 'alert' || rtlTables[b])
      const start = !!wide && (!!rtlTables[b] || leadSide(style, block, room(b)) === 'R')
      return markedRow(el, `c${b}`, element, floating(fitted([first, second, html, png]), opensWithCopy(block), start), start)
    }
    const button = second ? (
      <el.Box key={`copies${b}`} flexDirection="row" columnGap={1}>
        {first}
        {second}
        {html}
        {png}
      </el.Box>
    ) : first
    return (block.kind === 'quote' || block.kind === 'alert') && !mirrored(style) ? (
      <Box key={`c${b}`} flexDirection="row" columnGap={2} {...(rtl ? { justifyContent: 'flex-end' as const } : {})}>
        {element}
        {opensWithCopy(block) ? <Box alignSelf="flex-end">{button}</Box> : button}
      </Box>
    ) : (
      <Box key={`c${b}`} flexDirection="column" {...(mirror ? { width: '100%' } : rtl && (block.kind === 'list' || rtlTables[b]) ? {} : { alignSelf: 'flex-start' as const })}>
        <Box justifyContent="flex-end">{button}</Box>
        {element}
      </Box>
    )
  })
  const isFigure = (b: number) => blocks[b]?.kind === 'table' || drawn.get(b)?.art !== undefined
  const out: RenderElement[] = []
  for (let b = 0; b < rendered.length; b++) {
    if (!isFigure(b) || !isFigure(b + 1)) {
      out.push(copied[b]!)
      continue
    }
    const start = b
    while (isFigure(b + 1)) b++
    out.push(
      <Box key={`row${start}`} flexDirection="row" flexWrap="wrap" columnGap={4} rowGap={1}>
        {copied.slice(start, b + 1).map((figure, i) => <Box key={`f${start + i}`} flexShrink={0}>{figure}</Box>)}
      </Box>,
    )
  }
  return out
}

export type ToolRow = { tool: string; input: unknown; isRunning: boolean; isErrored: boolean; isInterrupted: boolean }

const VERBS: Record<string, string> = {
  Bash: 'Ran', PowerShell: 'Ran', Read: 'Read', Write: 'Wrote', Edit: 'Edited', MultiEdit: 'Edited', NotebookEdit: 'Edited',
  Grep: 'Searched', Glob: 'Listed', WebFetch: 'Fetched', WebSearch: 'Searched the web for', Agent: 'Delegated', Task: 'Delegated',
}

const field = (input: unknown, ...keys: string[]): string | undefined => {
  if (input === null || typeof input !== 'object') return undefined
  for (const k of keys) {
    const v = (input as Record<string, unknown>)[k]
    if (typeof v === 'string' && v.trim() !== '') return v
  }
  return undefined
}

const TARGET_FIELDS = ['file_path', 'notebook_path', 'path', 'pattern', 'url', 'query', 'description']

const statusColor = (t: Theme, row: ToolRow) =>
  row.isErrored ? t.codeFlag : row.isInterrupted ? t.codeComment : row.isRunning ? t.accent : t.number

const toolDim = (style: Style) => style.toolStyle !== "classic"

const toolGutter = ({ Box, Text }: ElementTable, style: Style, color: string | undefined, running: boolean) =>
  style.toolStyle.startsWith("tree")
    ? <Box width={4} flexShrink={0}><Text color={color}>{'  ⎿ '}</Text></Box>
    : <Box width={2} flexShrink={0}><Text color={color}>{running ? '◌' : '●'}</Text></Box>

export const EXPAND_HINT = '(ctrl+o to expand)'

const toolLayout = (el: ElementTable, style: Style, columns: number, label: string, color: string | undefined, running: boolean, text: RenderElement, hint = '') => {
  const { Box, Text } = el
  const tip = hint ? <Box flexShrink={0}><Text dimColor>{` ${hint}`}</Text></Box> : null
  if (style.toolStyle !== "chat") return <Box flexDirection="row">{toolGutter(el, style, color, running)}{text}{tip}</Box>
  const w = Math.min(width(label) + (hint ? width(hint) + 1 : 0) + 2, Math.max(20, Math.floor(columns * 0.6)))
  return (
    <Box flexDirection="row" justifyContent="flex-end" width="100%">
      <Box width={w} flexDirection="row">{text}{tip}<Text color={color}>{running ? " ◌" : " ●"}</Text></Box>
    </Box>
  )
}

type Places = Pick<Style, 'cwd' | 'home'>

const slashes = (path: string): string => path.replace(/\\/g, '/').replace(/\/+$/, '')

const folded = (path: string): string => (/^[a-z]:(\/|$)/i.test(path) ? path.toLowerCase() : path)

export const shortPath = (style: Places, path: string): string => {
  const target = folded(slashes(path))
  for (const [root, home] of [[style.cwd, false], [style.home, true]] as const) {
    const base = folded(slashes(root))
    if (base !== '' && target.startsWith(`${base}/`)) return home ? `~${path.slice(base.length)}` : path.slice(base.length + 1)
  }
  return path
}

const compactPath = (path: string): string => {
  const parts = path.split('/')
  if (!path.startsWith('/') || parts.length <= 6) return path
  return [...parts.slice(0, 3), '…', ...parts.slice(-2)].join('/')
}

const sameDir = (a: string, b: string): boolean => a !== '' && folded(slashes(a)) === folded(slashes(b))

export const shortTarget = (places: Places, path: string): string => (sameDir(places.cwd, path) ? '.' : sameDir(places.home, path) ? '~' : compactPath(shortPath(places, path)))


const PATH_FIELDS = ['file_path', 'notebook_path', 'path']

const FILE_TOOLS = new Set(['Read', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Grep', 'Glob'])

const toolPath = (tool: string | undefined, path: string | undefined): string | undefined => (tool !== undefined && FILE_TOOLS.has(tool) ? path : undefined)

const targetOf = (style: Style, input: unknown, fields: string[]): { target?: string; path?: string } => {
  const target = field(input, ...fields)
  const path = target !== undefined && PATH_FIELDS.some(k => field(input, k) === target) ? target : undefined
  return { target: path === undefined ? target : shortPath(style, path), path }
}

const RESULT_LINES = 3

export const renderShellResult = (el: ElementTable, style: Style, output: unknown): RenderElement => {
  const { Box, Text } = el
  const out = output !== null && typeof output === 'object' ? (output as Record<string, unknown>) : {}
  const shown = [...lines(out.stdout), ...lines(out.stderr)]
  const head = shown.slice(0, RESULT_LINES).map(l => shortenPaths(l, style))
  return (
    <Box flexDirection="column">
      {head.length === 0 ? heldRow(el, style, 'l0', '  ⎿  ', '', <Text dimColor>(No output)</Text>) : head.map((l, i) => heldRow(el, style, `l${i}`, i ? '     ' : '  ⎿  ', l, <Text wrap="truncate-end">{l === '' ? ' ' : l}</Text>))}
      {shown.length > head.length ? heldRow(el, style, 'more', '     ', '', <Text dimColor>{`… +${shown.length - head.length} lines`}</Text>) : null}
    </Box>
  )
}

const DIFF_LINES = 20
const DIFF_MAX = 400
const DIFF_EXTRA = 5000

type DiffLine = { mark: '+' | '-' | ' ' | '\\'; num: number; text: string; hunk: number }

const HEX = /^#[0-9a-f]{6}$/i

const channels = (hex: string): number[] => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))

export const tint = (base: string | undefined, color: string | undefined, share: number): string | undefined => {
  if (!base || !color || !HEX.test(base) || !HEX.test(color)) return undefined
  const [b, c] = [channels(base), channels(color)]
  return `#${b.map((v, i) => Math.round(v * (1 - share) + c[i]! * share).toString(16).padStart(2, '0')).join('')}`
}

const luminance = (hex: string): number => {
  const [r, g, b] = channels(hex).map(v => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

export const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

const TEXT_CONTRAST = 4.5

export const fullHue = (hex: string): string => {
  const [r, g, b] = channels(hex).map(v => v / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const spread = max - Math.min(r, g, b)
  const lightness = (max + max - spread) / 2
  if (spread === 0 || spread / (1 - Math.abs(2 * lightness - 1)) < 0.1) return hex
  const sector = max === r ? ((g - b) / spread + 6) % 6 : max === g ? (b - r) / spread + 2 : (r - g) / spread + 4
  const x = 1 - Math.abs((sector % 2) - 1)
  const pure = [[1, x, 0], [x, 1, 0], [0, 1, x], [0, x, 1], [x, 0, 1], [1, 0, x]][Math.floor(sector)]!
  return `#${pure.map(v => Math.round(v! * 255).toString(16).padStart(2, '0')).join('')}`
}

export const diffTint = (text: string | undefined, color: string | undefined): string | undefined => {
  if (!text || !color || !HEX.test(text) || !HEX.test(color)) return undefined
  const dark = contrast(text, '#000000') >= contrast(text, '#ffffff')
  const base = dark ? '#000000' : '#ffffff'
  const hue = fullHue(color)
  let share = dark ? 0.3 : 0.2
  while (share > 0.05 && contrast(text, tint(base, hue, share)!) < TEXT_CONTRAST) share -= 0.01
  return tint(base, hue, share)
}

export const leftToEngine = (output: unknown, press: boolean): boolean => {
  if (output === null || typeof output !== 'object') return false
  const out = output as { type?: unknown; staged?: unknown }
  return out.staged === true || (out.type === 'create' && !press)
}

export const diffLines = (output: unknown): DiffLine[] | undefined => {
  if (output === null || typeof output !== 'object') return undefined
  const out = output as { structuredPatch?: unknown }
  if (!Array.isArray(out.structuredPatch) || out.structuredPatch.length === 0) return undefined
  const rows: DiffLine[] = []
  for (const [h, hunk] of (out.structuredPatch as { oldStart?: unknown; newStart?: unknown; lines?: unknown }[]).entries()) {
    if (typeof hunk?.oldStart !== 'number' || typeof hunk.newStart !== 'number' || !Array.isArray(hunk.lines)) return undefined
    rows.push(...hunkRows(hunk.lines, hunk.oldStart, hunk.newStart, h))
  }
  return rows
}

const hunkRows = (lines: unknown[], oldStart: number, newStart: number, hunk: number): DiffLine[] => {
  const rows: DiffLine[] = []
  let [o, n] = [oldStart, newStart]
  for (const l of lines) {
    if (typeof l !== 'string') continue
    const mark = (l[0] === '+' || l[0] === '-' || l[0] === '\\' ? l[0] : ' ') as DiffLine['mark']
    let num = 0
    if (mark === '-') num = o++
    else if (mark !== '\\') {
      if (mark === ' ') o++
      num = n++
    }
    rows.push({ mark, num, text: l.slice(1).replace(CONTROL, ''), hunk })
  }
  return rows
}

const realLines = (rows: DiffLine[]): number => rows.filter(r => r.mark !== '\\').length

const firstLines = (rows: DiffLine[], count: number): DiffLine[] => {
  let [end, seen] = [0, 0]
  while (end < rows.length && (rows[end]!.mark === '\\' || seen < count)) if (rows[end++]!.mark !== '\\') seen++
  return rows.slice(0, end)
}

const EXTENSIONS: Record<string, string> = {
  mts: 'typescript', cts: 'typescript', mjs: 'javascript', cjs: 'javascript', pyi: 'python', rs: 'rust',
  h: 'c', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp', jsonc: 'json', htm: 'html', tf: 'hcl',
}

export const pathLanguage = (path: string | undefined): string | undefined => {
  const name = path?.split(/[\\/]/).pop() ?? ''
  if (/^(Dockerfile|Containerfile)(\.|$)/i.test(name)) return 'dockerfile'
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
  if (Object.hasOwn(EXTENSIONS, ext)) return EXTENSIONS[ext]
  return ext && grammarFor(ext) ? ext : undefined
}

const lifted = new Map<string, string>()

export const onTint = (color: string | undefined, bg: string): string | undefined => {
  if (!color || !HEX.test(color) || !HEX.test(bg) || contrast(color, bg) >= TEXT_CONTRAST) return color
  return remember(lifted, `${color}${bg}`, () => {
    const toward = contrast(bg, '#ffffff') >= contrast(bg, '#000000') ? '#ffffff' : '#000000'
    let share = 0
    while (share < 1 && contrast(tint(color, toward, share)!, bg) < TEXT_CONTRAST) share = Math.min(1, share + 0.02)
    return tint(color, toward, share)!
  })
}

const fileSegments = (style: Style, path: string | undefined, lines: string[]): Segment[][] => {
  const lang = pathLanguage(path)
  return (lang === undefined ? null : segmentRows(style, lines, lang)) ?? lines.map(text => (text ? [{ text, italic: false }] : []))
}

const diffSegments = (style: Style, rows: DiffLine[], path: string | undefined): Segment[][] => {
  const out: Segment[][] = rows.map(r => ((r.mark === '-' || r.mark === '\\') && r.text ? [{ text: r.text, italic: false }] : []))
  let start = 0
  while (start < rows.length) {
    let end = start
    while (end < rows.length && rows[end]!.hunk === rows[start]!.hunk) end++
    const after = Array.from({ length: end - start }, (_, i) => start + i).filter(r => rows[r]!.mark === ' ' || rows[r]!.mark === '+')
    const now = fileSegments(style, path, after.map(r => rows[r]!.text))
    after.forEach((r, i) => (out[r] = now[i]!))
    start = end
  }
  return out
}

const WORD_SHARE = 0.3

export const wordTint = (text: string | undefined, color: string | undefined): string | undefined => {
  const row = diffTint(text, color)
  return row && tint(row, color, WORD_SHARE)
}

const WORD = /\w+|\s+|[^\w\s]/g
const WORD_CELLS = 40000
const WORD_CHANGE = 0.5

const solid = (unit: string): boolean => /\S/.test(unit)

const unitsOf = (segs: Segment[]): string[] => segs.flatMap(s => s.text.match(WORD) ?? [])

const keptUnits = (a: string[], b: string[]): [boolean[], boolean[]] => {
  const width = b.length + 1
  const lcs = new Uint16Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) lcs[i * width + j] = a[i] === b[j] ? lcs[(i + 1) * width + j + 1]! + 1 : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!)
  }
  const kept: [boolean[], boolean[]] = [a.map(() => false), b.map(() => false)]
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] === b[j]) kept[0][i++] = kept[1][j++] = true
    else if (lcs[(i + 1) * width + j]! >= lcs[i * width + j + 1]!) i++
    else j++
  }
  return kept
}

const changedUnits = (units: string[], kept: boolean[]): boolean[] => {
  const changed = units.map((u, i) => !kept[i] && solid(u))
  return units.map((_, i) => changed[i]! || (!kept[i] && changed[i - 1] === true && changed[i + 1] === true))
}

const weight = (units: string[], flags?: boolean[]): number => units.reduce((n, u, i) => (solid(u) && (!flags || flags[i]) ? n + u.length : n), 0)

const wordDiffs = new Map<string, [boolean[], boolean[]] | null>()

const wordDiff = (a: string[], b: string[]): [boolean[], boolean[]] | null => {
  if (a.length * b.length > WORD_CELLS) return null
  return remember(wordDiffs, `${a.join('\u0001')}\n${b.join('\u0001')}`, () => {
    const kept = keptUnits(a, b)
    const flags: [boolean[], boolean[]] = [changedUnits(a, kept[0]), changedUnits(b, kept[1])]
    const changed = weight(a, flags[0]) + weight(b, flags[1])
    return changed === 0 || changed > (weight(a) + weight(b)) * WORD_CHANGE ? null : flags
  })
}

const runOf = (rows: DiffLine[], from: number, mark: '+' | '-', hunk: number): [number[], number] => {
  const at: number[] = []
  let end = from
  for (; end < rows.length && rows[end]!.hunk === hunk && (rows[end]!.mark === mark || rows[end]!.mark === '\\'); end++) if (rows[end]!.mark === mark) at.push(end)
  return [at, end]
}

const wordFlags = (rows: DiffLine[], segments: Segment[][]): (boolean[] | null)[] => {
  const flags: (boolean[] | null)[] = rows.map(() => null)
  for (let i = 0; i < rows.length; ) {
    if (rows[i]!.mark !== '-') {
      i++
      continue
    }
    const [removed, mid] = runOf(rows, i, '-', rows[i]!.hunk)
    const [added, end] = runOf(rows, mid, '+', rows[i]!.hunk)
    for (let k = 0; k < Math.min(removed.length, added.length); k++) {
      const diff = wordDiff(unitsOf(segments[removed[k]!]!), unitsOf(segments[added[k]!]!))
      if (diff) [flags[removed[k]!], flags[added[k]!]] = diff
    }
    i = Math.max(end, i + 1)
  }
  return flags
}

type Piece = Segment & { word: boolean }

const alike = (a: Piece, b: Piece | undefined): boolean => b !== undefined && a.color === b.color && a.italic === b.italic && a.word === b.word

const merged = (pieces: Piece[]): Piece[] =>
  pieces.reduce<Piece[]>((acc, p, i) => {
    const last = acc[acc.length - 1]
    if (!last || last.word !== p.word) acc.push(p)
    else if (alike(last, p) || (isBlank(p.text) && !alike(p, pieces[i + 1]))) acc[acc.length - 1] = { ...last, text: last.text + p.text }
    else if (isBlank(last.text)) acc[acc.length - 1] = { ...p, text: last.text + p.text }
    else acc.push(p)
    return acc
  }, [])

const wordPieces = (segs: Segment[], flags: boolean[] | null): Piece[] => {
  let u = 0
  return merged(segs.flatMap(s => (flags ? (s.text.match(WORD) ?? []).map(text => ({ ...s, text, word: flags[u++]! })) : [{ ...s, word: false }])))
}

const TAB = 8

const tabbed = (pieces: Piece[]): Piece[] => {
  if (!pieces.some(p => p.text.includes('\t'))) return pieces
  let col = 0
  return pieces.map(p => {
    let text = ''
    for (const g of graphemes(p.text)) {
      const out = g === '\t' ? ' '.repeat(TAB - (col % TAB)) : g
      text += out
      col += width(out)
    }
    return { ...p, text }
  })
}

const cutAt = (blank: boolean, space: number, from: number, at: number): number => (blank || space <= from ? at : space)

const rowStarts = (text: string, room: number): number[] => {
  const starts = [0]
  let [used, at, space, seen] = [0, 0, -1, false]
  for (const g of /^[ -~]*$/.test(text) ? text : graphemes(text)) {
    const step = width(g)
    const from = starts[starts.length - 1]!
    const blank = /\s/.test(g)
    if (used + step > room && at > from) {
      const cut = cutAt(blank, space, from, at)
      starts.push(cut)
      used = width(text.slice(cut, at))
      seen = /\S/.test(text.slice(cut, at))
      space = -1
    }
    at += g.length
    used += step
    if (!blank) seen = true
    else if (seen) space = at
  }
  return starts
}

const splitRows = <P extends Piece>(pieces: P[], starts: number[]): P[][] => {
  const rows: P[][] = starts.map(() => [])
  let [at, r] = [0, 0]
  for (const p of pieces) {
    for (let from = 0; from < p.text.length; ) {
      while (r + 1 < starts.length && starts[r + 1]! <= at + from) r++
      const end = Math.min(p.text.length, (starts[r + 1] ?? Infinity) - at)
      rows[r]!.push({ ...p, text: p.text.slice(from, end) })
      from = end
    }
    at += p.text.length
  }
  return rows
}

const DIFF_ROOM = 8

const visualRows = <P extends Piece>(pieces: P[], room: number | undefined): P[][] => {
  const text = pieces.map(p => p.text).join('')
  return room === undefined || room < DIFF_ROOM || width(text) <= room ? [pieces] : splitRows(pieces, rowStarts(text, room))
}

const lift = (color: string | undefined, band: string | undefined) => {
  const lifted = band && color ? onTint(color, band) : undefined
  return lifted && lifted !== color ? { hover: { color: lifted } } : {}
}

const drawCode = ({ Text }: ElementTable, style: Style, pieces: Piece[], bg: string | undefined, word: string | undefined, key: string, band?: string): RenderNode[] | string => {
  if (!pieces.length) return ' '
  const code = style.theme.codeText
  return pieces.map((p, j) => {
    const lit = p.word && word !== undefined
    if (!lit && !p.italic && (!p.color || p.color === code)) return p.text
    const on = lit ? word : bg
    const color = on ? onTint(p.color ?? code, on) : p.color
    if (!lit && band) return <Text key={`${key}.${j}`} color={color} italic={p.italic} {...lift(p.color, band)}>{p.text}</Text>
    return h(Text, lookOf({ color, italic: p.italic, backgroundColor: lit ? word : undefined }), p.text) as RenderNode
  })
}

type Budget = { left: number }

const spend = (budget: Budget, cost: number): boolean => {
  if (cost > budget.left) return false
  budget.left -= cost
  return true
}

const filePieces = (style: Style, path: string | undefined, lines: string[]): Piece[][] => fileSegments(style, path, lines).map(segs => tabbed(wordPieces(segs, null)))

const onBand = (color: string | undefined, band: string | undefined) => {
  const lifted = band && color ? onTint(color, band) : undefined
  return lifted ? { hover: { color: lifted } } : {}
}

const muted = (style: Style, band: string | undefined) => onBand(style.theme.codeComment ?? style.theme.codeText, band)

const numberedLine = (el: ElementTable, style: Style, label: string, pieces: Piece[], key: string, band?: string): RenderElement[] => [
  <el.Text key={`${key}.g`} color={style.theme.codeComment} dimColor {...muted(style, band)}>{heldLabel(style, label, pieceText(pieces))}</el.Text>,
  <el.Text key={`${key}.c`} color={style.theme.codeText} {...lift(style.theme.codeText, band)}>{drawCode(el, style, pieces, undefined, undefined, `${key}.c`, band)}</el.Text>,
]

const partCost = (part: Piece[]): number => Math.max(1, part.reduce((m, p) => m + (p.color || p.italic || p.word ? 2 : 1), 0))

const lineCost = (parts: Piece[][], bar: boolean, note: boolean, row = 0): number =>
  parts.reduce((n, part) => n + (bar ? 8 : 6) + row + partCost(part), 0) - (note ? 0 : bar ? 9 : 7)

const plainParts = (text: string): Piece[][] => [text ? [{ text, italic: false, word: false }] : []]

type MarkColors = Record<DiffLine['mark'], string | undefined>

type DiffPaint = { look: Style['diffStyle']; gutter: number; marks: MarkColors; tints: MarkColors; words: MarkColors }

const UNTINTED: MarkColors = { '+': undefined, '-': undefined, ' ': undefined, '\\': undefined }

const markColors = (theme: Theme): MarkColors => ({ ...UNTINTED, '+': theme.diffAdded ?? theme.number, '-': theme.diffRemoved ?? theme.codeFlag, '\\': theme.codeText })

const diffPaint = (style: Style, gutter: number): DiffPaint => {
  const t = style.theme
  const marks = markColors(t)
  const tinted = style.diffStyle === 'card' || style.diffStyle === 'full'
  const lines = { ...UNTINTED, '+': diffTint(t.codeText, marks['+']), '-': diffTint(t.codeText, marks['-']) }
  return {
    look: style.diffStyle,
    gutter,
    marks,
    tints: tinted ? lines : UNTINTED,
    words: tinted ? { ...UNTINTED, '+': wordTint(t.codeText, marks['+']), '-': wordTint(t.codeText, marks['-']) } : lines,
  }
}

const codeRoom = (paint: DiffPaint, columns: number | undefined): number | undefined =>
  columns === undefined ? undefined : columns - 5 - (paint.look === 'card' ? 4 : 0) - (paint.look === 'bar' ? 2 : 0) - paint.gutter - 3

const barOf = (mark: DiffLine['mark']): string => (mark === ' ' || mark === '\\' ? '  ' : '▌ ')

const markOf = (mark: DiffLine['mark']): string => (mark === '\\' ? '  ' : `${mark} `)

const numberOf = (paint: DiffPaint, r: DiffLine, k: number): string => `${k || r.mark === '\\' ? ' '.repeat(paint.gutter) : String(r.num).padStart(paint.gutter)} `

const lineRows = (el: ElementTable, style: Style, paint: DiffPaint, r: DiffLine, i: number, parts: Piece[][]): RenderElement[] => {
  const bg = paint.tints[r.mark]
  return parts.map((part, k) => (
    <el.Box key={k ? `d${i}.${k}` : `d${i}`} flexDirection="row" {...(bg ? { backgroundColor: bg } : {})}>
      {lineText(el, style, paint, r, `d${i}.${k}`, k, part, 0, false)}
    </el.Box>
  ))
}

type ShapedLine = { r: DiffLine; i: number; parts: Piece[][]; gap: boolean }

type DiffShape = { paint: DiffPaint; room: number | undefined; lines: ShapedLine[] }

const diffShape = (style: Style, shown: DiffLine[], path: string | undefined, columns: number | undefined): DiffShape => {
  const paint = diffPaint(style, String(Math.max(0, ...shown.map(r => r.num))).length)
  const segments = diffSegments(style, shown, path)
  const flags = wordFlags(shown, segments)
  const room = codeRoom(paint, columns)
  return {
    paint,
    room,
    lines: shown.map((r, i) => ({ r, i, parts: visualRows(tabbed(wordPieces(segments[i]!, flags[i] ?? null)), room), gap: i > 0 && r.hunk !== shown[i - 1]!.hunk })),
  }
}

const gapRow = (el: ElementTable, paint: DiffPaint, key: string): RenderElement => <el.Text key={key} dimColor>{paint.look === 'bar' ? '  ...' : '...'}</el.Text>

const TEXT_ROW = 2

const afforded = (line: ShapedLine, paint: DiffPaint, budget: Budget, row: number): ShapedLine => {
  const gap = line.gap && spend(budget, 2)
  if (spend(budget, lineCost(line.parts, paint.look === 'bar', line.r.mark === '\\', row))) return { ...line, gap }
  return { ...line, gap, parts: line.r.mark === '\\' ? [] : plainParts(line.r.text) }
}

const diffBody = (el: ElementTable, style: Style, shown: DiffLine[], path: string | undefined, columns: number | undefined, budget: Budget): RenderElement[] => {
  const { paint, lines } = diffShape(style, shown, path, columns)
  return lines.map(line => afforded(line, paint, budget, 0)).flatMap(({ r, i, parts, gap }) => [...(gap ? [gapRow(el, paint, `gap${i}`)] : []), ...lineRows(el, style, paint, r, i, parts)])
}

const lineText = (el: ElementTable, style: Style, paint: DiffPaint, r: DiffLine, key: string, k: number, part: Piece[], pad: number, fill = true): RenderNode[] => {
  const { Text } = el
  const bg = paint.tints[r.mark]
  const on = bg && fill ? { backgroundColor: bg } : {}
  const code = style.theme.codeText
  return [
    ...(paint.look === 'bar' ? [<Text key={`${key}.b`} color={paint.marks[r.mark]} {...on}>{barOf(r.mark)}</Text>] : []),
    <Text key={`${key}.n`} dimColor {...on}>{heldLabel(style, numberOf(paint, r, k), r.text)}</Text>,
    <Text key={`${key}.m`} color={paint.marks[r.mark]} dimColor={r.mark === ' '} {...on}>{markOf(r.mark)}</Text>,
    <Text key={`${key}.c`} color={bg ? onTint(code, bg) : code} {...on}>{drawCode(el, style, part, bg, paint.words[r.mark], key)}</Text>,
    ...(bg && pad > 0 ? [<Text key={`${key}.p`} {...on}>{' '.repeat(pad)}</Text>] : []),
  ]
}

const diffText = (el: ElementTable, style: Style, shown: DiffLine[], path: string | undefined, columns: number | undefined, budget: Budget): RenderElement => {
  const { paint, room, lines } = diffShape(style, shown, path, columns)
  const kept = lines.map(line => afforded(line, paint, budget, TEXT_ROW))
  const lead = (paint.look === 'bar' ? 2 : 0) + paint.gutter + 3
  const used = (part: Piece[]) => lead + (part.length ? width(part.map(p => p.text).join('')) : 1)
  const fits = room !== undefined && room >= DIFF_ROOM
  const span = !fits ? 0 : paint.look === 'full' ? lead + room : Math.max(0, ...kept.flatMap(l => l.parts.map(used)))
  const rows = kept.flatMap(({ r, i, parts, gap }) => [
    ...(gap ? [[gapRow(el, paint, `t${i}.g`)]] : []),
    ...parts.map((part, k) => lineText(el, style, paint, r, `t${i}.${k}`, k, part, span - used(part))),
  ])
  return <el.Text key="rows">{rows.flatMap((row, n) => (n ? ['\n', ...row] : row))}</el.Text>
}

const diffBox = (el: ElementTable, style: Style, rows: DiffLine[], fold: Fold, id: string, key: string, path: string | undefined, budget: Budget, columns: number | undefined, title?: string): RenderElement => {
  const { Box, Text } = el
  const t = style.theme
  const added = rows.filter(r => r.mark === '+').length
  const removed = rows.filter(r => r.mark === '-').length
  const total = realLines(rows)
  const toggle = total > DIFF_LINES ? fold?.(id, total - DIFF_LINES, `fold${key}`) : null
  const shown = firstLines(rows, toggle?.folded === false ? DIFF_MAX : DIFF_LINES)
  const hidden = total - realLines(shown)
  const marks = markColors(t)
  const frame = style.diffStyle === 'card' ? { borderStyle: 'round', borderColor: t.rule, paddingX: 1 } : {}
  const head = (
    <Text key="head">
      {title === undefined ? null : <Text color={t.path}>{style.pressPreview === true && toggle?.around ? `${title} ` : drawPieces(el, style, [{ text: title, path }, { text: ' ' }])}</Text>}
      <Text color={marks['+']} dimColor={added === 0}>{`+${added}`}</Text>
      <Text> </Text>
      <Text color={marks['-']} dimColor={removed === 0}>{`−${removed}`}</Text>
    </Text>
  )
  const press = style.pressPreview === true ? toggle?.around : undefined
  return (
    <Box key={`card${key}`} flexDirection="column" flexShrink={1} {...frame}>
      {press ? press(<Text key="all">{head}{'\n'}{diffText(el, style, shown, path, columns, budget)}</Text>, { inverse: false }) : [head, ...diffBody(el, style, shown, path, columns, budget)]}
      {hidden > 0 && toggle?.folded !== true ? <Text dimColor>{`… +${hidden} lines`}</Text> : null}
      {toggle?.element ?? null}
    </Box>
  )
}

const diffRow = (el: ElementTable, style: Style, cards: RenderElement[], below: boolean): RenderElement => (
  <el.Box flexDirection="row">
    <el.Text dimColor>{below ? '     ' : '  ⎿  '}</el.Text>
    <el.Box flexDirection="column" flexShrink={1} {...(style.diffStyle === 'full' ? { flexGrow: 1 } : { alignItems: 'flex-start' as const })}>{cards}</el.Box>
  </el.Box>
)

const editedIntoBeing = (output: unknown, rows: DiffLine[]): WholeFile | undefined => {
  const out = output as { filePath?: unknown; oldString?: unknown; originalFile?: unknown }
  const fresh = out.oldString === '' && (out.originalFile === null || out.originalFile === '') && rows.every(r => r.mark === '+' || r.mark === '\\')
  return fresh && typeof out.filePath === 'string' ? { kind: 'created', path: out.filePath, lines: rows.filter(r => r.mark === '+').map(r => r.text) } : undefined
}

const written = (output: unknown): WholeFile | undefined => {
  const out = output as { type?: unknown; filePath?: unknown; content?: unknown }
  return out.type === 'create' && typeof out.filePath === 'string' && typeof out.content === 'string' ? { kind: 'created', path: out.filePath, lines: lines(out.content) } : undefined
}

export type DiffCard = { write: WholeFile } | { rows: DiffLine[]; made?: WholeFile; path?: string }

export const diffCard = (output: unknown): DiffCard | undefined => {
  const write = written(output)
  if (write) return { write }
  const rows = diffLines(output)
  if (rows === undefined) return undefined
  const path = (output as { filePath?: unknown }).filePath
  return { rows, made: editedIntoBeing(output, rows), path: typeof path === 'string' ? path : undefined }
}

export const drawDiffCard = (el: ElementTable, style: Style, card: DiffCard, fold: Fold, id: string, columns?: number): RenderElement => {
  const budget = { left: DIFF_EXTRA }
  if ('write' in card) return diffRow(el, style, [wholeFileCard(el, style, card.write, fold, id, '', budget, columns, false)], false)
  return diffRow(el, style, [card.made ? wholeFileCard(el, style, card.made, fold, id, '', budget, columns) : diffBox(el, style, card.rows, fold, id, '', card.path, budget, columns)], false)
}

export const renderDiffCard = (el: ElementTable, style: Style, output: unknown, fold: Fold, id: string, columns?: number): RenderElement | undefined => {
  const card = diffCard(output)
  return card && drawDiffCard(el, style, card, fold, id, columns)
}

type WholeFile = { kind: 'created' | 'deleted'; path: string; lines: string[] }

export type FileChange = { kind: 'modified'; path: string; rows: DiffLine[] } | WholeFile | { kind: 'renamed'; path: string; to: string }

export type BashEdits = { files: FileChange[]; more: number; shared: boolean }

export const EDIT_NOTES = {
  first: 'every file that changed while this ran, by this command or anything else: a view of the changes, not an audit of the command',
  shared: 'another command ran in this repository at the same time, so changes by either may show under either one',
  tree: 'a git step in this command can move the working tree, so these may be its changes rather than edits',
} as const

export const bashEdits = (output: unknown): BashEdits | undefined => {
  if (output === null || typeof output !== 'object') return undefined
  const diff = (output as { bashEditDiff?: unknown }).bashEditDiff
  if (diff === null || typeof diff !== 'object') return undefined
  const { files, moreFiles, shared } = diff as { files?: unknown; moreFiles?: unknown; shared?: unknown }
  if (!Array.isArray(files) || files.length === 0) return undefined
  const changed = files.map(fileChange)
  if (!changed.every((f): f is FileChange => f !== undefined)) return undefined
  return { files: renamed(changed), more: typeof moreFiles === 'number' && moreFiles > 0 ? moreFiles : 0, shared: shared === true }
}

const fileChange = (entry: unknown): FileChange | undefined => {
  const file = entry as { filePath?: unknown; hunks?: unknown; created?: unknown; deleted?: unknown } | null
  const kind = file?.created === true ? 'created' : file?.deleted === true ? 'deleted' : 'modified'
  const rows = kind !== 'modified' && Array.isArray(file?.hunks) && file.hunks.length === 0 ? [] : diffLines({ structuredPatch: file?.hunks })
  if (typeof file?.filePath !== 'string' || rows === undefined) return undefined
  if (kind === 'modified') return { kind, path: file.filePath, rows }
  const mark = kind === 'created' ? '+' : '-'
  return { kind, path: file.filePath, lines: rows.filter(r => r.mark === mark).map(r => r.text) }
}

const pairable = (file: FileChange): file is WholeFile => (file.kind === 'created' || file.kind === 'deleted') && file.lines.length > 0

const sameLines = (a: string[], b: string[]): boolean => a.length === b.length && a.every((line, i) => line === b[i])

const renamed = (files: FileChange[]): FileChange[] => {
  const paired = new Set<FileChange>()
  const out: FileChange[] = []
  for (const file of files) {
    if (paired.has(file)) continue
    const twin = pairable(file) ? files.find((other): other is WholeFile => !paired.has(other) && pairable(other) && other.kind !== file.kind && sameLines(other.lines, file.lines)) : undefined
    if (!twin) {
      out.push(file)
      continue
    }
    paired.add(file).add(twin)
    const [from, to] = file.kind === 'deleted' ? [file, twin] : [twin, file]
    out.push({ kind: 'renamed', path: from.path, to: to.path })
  }
  return out
}

export const withoutBashEdits = (output: unknown): unknown => {
  if (output === null || typeof output !== 'object') return output
  const { bashEditDiff: _, ...rest } = output as Record<string, unknown>
  return rest
}

export const hasShellOutput = (output: unknown): boolean => {
  const out = output !== null && typeof output === 'object' ? (output as Record<string, unknown>) : {}
  return lines(out.stdout).length + lines(out.stderr).length > 0
}

const PREVIEW_LINES = 10

const lineCount = (n: number): string => (n === 0 ? 'empty' : `${n} ${n === 1 ? 'line' : 'lines'}`)

const BAND_SHARE = 0.12
const BAND_FLOOR = 0.06
export const BAND_STEP = 1.2
const BAND_MOST = 0.4

const previewInks = (theme: Theme): string[] =>
  [theme.codeText, ...Object.values(PRISM_COLORS).map(k => theme[k])].filter((c): c is string => c !== undefined && HEX.test(c))

const stepped = (share: number, by: number): number => Math.round((share + by) * 100) / 100

const bandFrom = (background: string, text: string): string => {
  let share = 0.02
  while (share < BAND_MOST && contrast(tint(background, text, share)!, background) < BAND_STEP) share = stepped(share, 0.01)
  return tint(background, text, share)!
}

export const previewBand = (theme: Theme, background?: string): string | undefined => {
  const text = theme.codeText
  if (!text || !HEX.test(text)) return undefined
  if (background && HEX.test(background)) return bandFrom(background, text)
  const base = contrast(text, '#000000') >= contrast(text, '#ffffff') ? '#000000' : '#ffffff'
  const inks = previewInks(theme).filter(c => contrast(c, base) >= TEXT_CONTRAST)
  let share = BAND_SHARE
  while (share > BAND_FLOOR && inks.some(c => contrast(c, tint(base, text, share)!) < TEXT_CONTRAST)) share = stepped(share, -0.01)
  return tint(base, text, share)
}

const PREVIEW_ROW = 4
const PLAIN_LINE = 7

const previewRows = (pieces: Piece[], text: string, room: number | undefined, budget: Budget): Piece[][] => {
  const rich = visualRows(pieces, room)
  if (spend(budget, Math.max(0, rich.reduce((n, part) => n + PREVIEW_ROW + partCost(part), 0) - PLAIN_LINE))) return rich
  return [tabbed(plainParts(text)[0]!)]
}

const previewText = (el: ElementTable, style: Style, path: string, shown: string[], key: string, band: string | undefined, columns: number | undefined, budget: Budget): RenderNode[] => {
  const gutter = String(shown.length).length
  const room = columns === undefined ? undefined : columns - 5 - gutter - 2
  return filePieces(style, path, shown).flatMap((pieces, i) =>
    previewRows(pieces, shown[i]!, room, budget).flatMap((part, k) => [
      ...(i || k ? ['\n'] : []),
      ...numberedLine(el, style, k ? ' '.repeat(gutter + 2) : `${String(i + 1).padStart(gutter)}  `, part, `${key}.${i}.${k}`, band),
    ]))
}

const wholeHead = (el: ElementTable, style: Style, file: WholeFile, band?: string): RenderElement => (
  <el.Text key="head">
    {band ? <el.Text {...onBand(style.theme.codeText, band)}>{'Created '}</el.Text> : file.kind === 'created' ? 'Created ' : 'Deleted '}
    <el.Text color={style.theme.path} {...lift(style.theme.path, band)}>{shortPath(style, file.path)}</el.Text>
    <el.Text dimColor {...muted(style, band)}>{` (${lineCount(file.lines.length)})`}</el.Text>
  </el.Text>
)

type RowsOf = { marked: boolean; press: boolean; band: string | undefined; columns: number | undefined; budget: Budget }

const wholeRows = (el: ElementTable, style: Style, file: WholeFile, shown: number, { marked, press, band, columns, budget }: RowsOf): RenderElement | null => {
  const lines = file.lines.slice(0, shown)
  if (lines.length === 0) return null
  if (!marked) return <el.Text key="rows">{previewText(el, style, file.path, lines, 'rows', band, columns, budget)}</el.Text>
  const diff = lines.map((text, i): DiffLine => ({ mark: file.kind === 'created' ? '+' : '-', num: i + 1, text, hunk: 0 }))
  return press ? diffText(el, style, diff, file.path, columns, budget) : <el.Box key="rows" flexDirection="column">{diffBody(el, style, diff, file.path, columns, budget)}</el.Box>
}

type Toggle = ReturnType<Fold>

const wholeToggle = (fold: Fold, file: WholeFile, head: RenderElement, id: string, key: string): Toggle => {
  const n = file.lines.length
  if (file.kind === 'created') return n > PREVIEW_LINES ? fold(id, n - PREVIEW_LINES, `fold${key}`) : null
  return n > 0 ? fold(id, n, `fold${key}`, { label: `show ${lineCount(n)}`, face: () => head }) : null
}

const wholeBody = (el: ElementTable, style: Style, file: WholeFile, head: RenderElement, rows: RenderElement | null, toggle: Toggle, band: string | undefined): (RenderElement | null)[] | RenderElement => {
  const press = style.pressPreview === true ? toggle?.around : undefined
  const hover = { inverse: false, ...(band ? { backgroundColor: band } : {}) }
  if (press && file.kind === 'created') return press(<el.Text key="all">{wholeHead(el, style, file, band)}{rows ? ['\n', rows] : null}</el.Text>, hover)
  return [toggle?.faced ? toggle.element : head, rows && press ? press(rows, hover) : rows]
}

const wholeFileCard = (el: ElementTable, style: Style, file: WholeFile, fold: Fold, id: string, key: string, budget: Budget, columns: number | undefined, marked = true): RenderElement => {
  const n = file.lines.length
  const created = file.kind === 'created'
  const head = wholeHead(el, style, file)
  const toggle = wholeToggle(fold, file, head, id, key)
  const shown = Math.min(n, toggle?.folded === false ? DIFF_MAX : created ? PREVIEW_LINES : 0)
  const press = style.pressPreview === true && toggle?.around !== undefined
  const band = press && !marked ? previewBand(style.theme, style.background) : undefined
  const rows = wholeRows(el, style, file, shown, { marked, press, band, columns, budget })
  const rest = n > shown && (toggle ? !toggle.folded : created)
  return (
    <el.Box key={`file${key}`} flexDirection="column">
      {wholeBody(el, style, file, head, rows, toggle, band)}
      {rest ? <el.Text key="rest" dimColor>{`… +${n - shown} lines`}</el.Text> : null}
      {toggle && !toggle.faced ? toggle.element : null}
    </el.Box>
  )
}

const renamedLine = (el: ElementTable, style: Style, from: string, to: string, key: string): RenderElement => (
  <el.Text key={`file${key}`}>
    {'Renamed '}
    <el.Text color={style.theme.path}>{shortPath(style, from)}</el.Text>
    {' → '}
    <el.Text color={style.theme.path}>{shortPath(style, to)}</el.Text>
  </el.Text>
)

export const renderBashEdits = (el: ElementTable, style: Style, edits: BashEdits, fold: Fold, id: string, below = false, notes: readonly string[] = [], columns?: number): RenderElement => {
  const budget = { left: DIFF_EXTRA }
  const cards = edits.files.map((file, i) =>
    file.kind === 'modified' ? diffBox(el, style, file.rows, fold, `${id}:${i}`, String(i), file.path, budget, columns, shortPath(style, file.path))
    : file.kind === 'renamed' ? renamedLine(el, style, file.path, file.to, String(i))
    : wholeFileCard(el, style, file, fold, `${id}:${i}`, String(i), budget, columns))
  const more = edits.more ? [<el.Text key="more" dimColor>{`… +${edits.more} more ${edits.more === 1 ? 'file' : 'files'}`}</el.Text>] : []
  const said = notes.map((note, i) => <el.Text key={`note${i}`} dimColor>{`(${note})`}</el.Text>)
  return diffRow(el, style, [...cards, ...more, ...said], below)
}

const TREE_MOVERS = new Set(['checkout', 'switch', 'stash', 'pull', 'merge', 'rebase', 'reset', 'restore', 'clean', 'cherry-pick', 'revert'])

const gitSubcommand = (args: string[]): string | undefined => {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (!arg.startsWith('-')) return arg
    if (arg === '-C' || arg === '-c') i++
  }
  return undefined
}

export const editNotes = (edits: BashEdits, first: boolean, command?: string): string[] => [
  ...(first ? [EDIT_NOTES.first] : []),
  ...(edits.shared ? [EDIT_NOTES.shared] : []),
  ...(command !== undefined && movesTree(command) ? [EDIT_NOTES.tree] : []),
]

export const movesTree = (command: string): boolean =>
  parseShell(command).segments.some(({ words }) => {
    const argv = commandWords(words)
    const [name, ...rest] = argv[0] === 'sudo' ? argv.slice(1) : argv
    return name?.split('/').pop() === 'git' && TREE_MOVERS.has(gitSubcommand(rest) ?? '')
  })

const NOISE_LINES = /^((Error:\s*)?Exit code \d+|at\s+(\S+\s+\()?\S+:\d+(:\d+)?\)?|Node\.js v\d.*|exit status \d+|\.\.\. \d+ more)$/i

const REFUSAL = /^(Error:\s*)?(The user doesn't want to proceed|Permission (for|to) .*\bdenied|The server-side auto mode classifier|\S+ hook error:)/i

export const refusalReason = (output: unknown): string | undefined => {
  if (typeof output !== 'string' || /^(Error:\s*)?Exit code \d+/m.test(output) || !REFUSAL.test(output)) return undefined
  return output.replace(/\s+/g, ' ').trim()
}

export const rememberCall = (calls: Set<string>, id: string, limit = 2000): void => {
  calls.delete(id)
  calls.add(id)
  if (calls.size > limit) calls.delete(calls.values().next().value!)
}

export const errorReason = (output: unknown): string | undefined => {
  const out = output !== null && typeof output === 'object' ? (output as Record<string, unknown>) : {}
  const text = typeof output === 'string' ? output : typeof out.stderr === 'string' && out.stderr.trim() ? out.stderr : out.stdout
  if (typeof text !== 'string') return undefined
  return text.split('\n').map(l => l.trim()).filter(l => l !== '' && !NOISE_LINES.test(l)).at(-1)
}

export const renderFailure = (el: ElementTable, style: Style, output: unknown, key?: string): RenderElement | undefined => {
  const refusal = refusalReason(output)
  const reason = refusal ?? errorReason(output)
  if (reason === undefined) return undefined
  const chat = style.toolStyle === 'chat'
  const shown = refusal ?? shortenPaths(reason, style)
  return (
    <el.Box key={key} flexDirection="row" width="100%" justifyContent={chat ? 'flex-end' : 'flex-start'}>
      <el.Text color={style.theme.codeFlag} wrap={refusal === undefined ? 'truncate-middle' : 'wrap'}>{`${chat ? '' : heldLabel(style, '  ⎿ ', shown)}${shown}`}</el.Text>
    </el.Box>
  )
}

const shellLabel = (call: ToolRow, style: Style): string => {
  const command = field(call.input, 'command') ?? ''
  const plain = call.tool === 'Bash' ? describeShell(command, style) : undefined
  if (plain) return plain
  const description = field(call.input, 'description')
  if (description === undefined) return `Ran ${shortenPaths(command.split('\n')[0]!, style)}`
  const programs = call.tool === 'Bash' ? programsOf(command) : []
  return programs.length ? `${description} · ${programs.join(', ')}` : description
}

const callPieces = (call: ToolRow, style: Style): LinkPiece[] => {
  if (call.tool === 'Bash' || call.tool === 'PowerShell') return [{ text: shellLabel(call, style) }]
  if (call.tool === 'Grep') {
    const pattern = field(call.input, 'pattern')
    const path = field(call.input, 'path')
    if (pattern !== undefined) return path === undefined ? [{ text: `Searched . for "${pattern}"` }] : [{ text: 'Searched ' }, { text: shortTarget(style, path), path }, { text: ` for "${pattern}"` }]
  }
  const verb = call.tool === 'Skill' ? 'Loaded skill' : VERBS[call.tool] ?? call.tool.replace(/^mcp__([^_]+)__/, '$1 ')
  const target = field(call.input, 'skill', ...TARGET_FIELDS)
  const args = call.tool === 'Skill' ? field(call.input, 'args') : undefined
  if (target === undefined) return [{ text: verb }]
  const path = toolPath(call.tool, PATH_FIELDS.some(k => field(call.input, k) === target) ? target : undefined)
  return [{ text: `${verb} ` }, { text: shortTarget(style, target), path }, ...(args ? [{ text: ` ${args}` }] : [])]
}

const quietToolRow = (el: ElementTable, style: Style, row: ToolRow, columns: number): RenderElement => {
  const t = style.theme
  const dot = statusColor(t, row)
  const pieces = callPieces(row, style)
  const label = `${pieceText(pieces)}${row.isInterrupted ? ' interrupted' : row.isErrored ? ' failed' : ''}`
  return toolLayout(el, style, columns, label, dot, row.isRunning, (
    <el.Text wrap="truncate-end" dimColor={toolDim(style)}>
      {drawPieces(el, style, pieces)}
      {row.isInterrupted ? <el.Text dimColor> interrupted</el.Text> : row.isErrored ? <el.Text color={t.codeFlag}> failed</el.Text> : null}
    </el.Text>
  ))
}

export const renderToolRow = (el: ElementTable, style: Style, row: ToolRow, columns = 100): RenderElement => {
  if (style.toolOutput === 'quiet') return quietToolRow(el, style, row, columns)
  const { Text } = el
  const t = style.theme
  const isShell = row.tool === 'Bash' || row.tool === 'PowerShell'
  const verb = VERBS[row.tool] ?? row.tool.replace(/^mcp__([^_]+)__/, '$1 ')
  const found: { target?: string; path?: string } = isShell ? { target: field(row.input, 'command')?.split('\n')[0] } : targetOf(style, row.input, TARGET_FIELDS)
  const target = found.target
  const dot = statusColor(t, row)
  const isPath = target !== undefined && (found.path !== undefined || /^(~|\.{0,2}\/|[A-Za-z]:\\)/.test(target))

  const label = `${verb}${target === undefined ? "" : ` ${target}`}${row.isInterrupted ? " interrupted" : row.isErrored ? " failed" : ""}`
  return toolLayout(el, style, columns, label, dot, row.isRunning, (
      <Text wrap="truncate-end" dimColor={toolDim(style)}>
        <Text bold={!toolDim(style)} dimColor={toolDim(style)}>{verb}</Text>
        {target === undefined ? null : <Text> </Text>}
        {target === undefined ? null : isShell ? codeLine(el, style, target, 'bash', 'cmd') : <Text color={isPath ? t.path : t.inlineCode} dimColor={toolDim(style)}>{drawPieces(el, style, [{ text: target, path: toolPath(row.tool, found.path) }])}</Text>}
        {row.isInterrupted ? <Text dimColor> interrupted</Text> : row.isErrored ? <Text color={t.codeFlag}> failed</Text> : null}
      </Text>
  ))
}

const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'WebFetch', 'WebSearch', 'Skill'])

const READ_COMMANDS = new Set([
  'awk', 'basename', 'cat', 'cd', 'column', 'cut', 'diff', 'dirname', 'du', 'echo', 'file', 'find', 'grep', 'head', 'jq', 'less',
  'ls', 'nl', 'pdftotext', 'printf', 'pwd', 'readlink', 'realpath', 'rg', 'sed', 'sort', 'stat', 'tail', 'test', 'tr', 'tree',
  'true', 'uniq', 'wc', 'which',
])

const READ_SUBCOMMANDS: Record<string, RegExp> = {
  git: /^(log|show|diff|status|blame|grep|ls-files|rev-parse|branch --show-current)\b/,
  gh: /^((pr|issue|run|release) (view|list|diff|checks)|search)\b/,
}

const flagValue = (args: string[], i: number, flag: string): string => {
  const arg = args[i]!
  return arg === flag ? (args[i + 1] ?? '') : arg.slice(flag.length).replace(/^=/, '')
}

const ghApiReadsOnly = (rest: string[]): boolean =>
  !rest.some((a, i) => {
    if (/^(-[fF]|--field|--raw-field|--input)/.test(a)) return true
    if (!/^(-X|--method)/.test(a)) return false
    return !/^GET$/i.test(flagValue(rest, i, a.startsWith('--') ? '--method' : '-X'))
  })

type ShellPart = { words: string[]; piped: boolean }

const HEREDOC = /<<(?!<)-?\s*(['"]?)([A-Za-z_][\w-]*)\1/g

const dropHeredocBodies = (command: string): string => {
  const lines = command.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    out.push(line)
    for (const [, , end] of line.matchAll(HEREDOC)) {
      while (i + 1 < lines.length && lines[i + 1]!.trim() !== end) i++
      i++
    }
  }
  return out.join('\n')
}

const parseShell = (source: string): { segments: ShellPart[]; redirects: boolean } => {
  const command = dropHeredocBodies(source)
  const segments: ShellPart[] = [{ words: [], piped: false }]
  let word = ''
  let quote = ''
  let started = false
  let redirects = false
  const current = () => segments[segments.length - 1]!
  const endWord = () => {
    if (started) current().words.push(word)
    word = ''
    started = false
  }
  const endSegment = (piped: boolean) => {
    endWord()
    if (current().words.length) segments.push({ words: [], piped })
    else current().piped = piped
  }
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!
    if (quote) {
      if (ch === quote) quote = ''
      else if (ch === '\\' && quote === '"' && /[$`"\\\n]/.test(command[i + 1] ?? '')) word += command[++i]
      else word += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      started = true
    } else if (ch === '\\' && command[i + 1] === '\n') {
      i++
    } else if (ch === '\\' && i + 1 < command.length) {
      word += command[++i]
      started = true
    } else if (ch === '\n' || ch === ';') {
      endSegment(false)
    } else if (ch === '&' && command[i + 1] === '&') {
      i++
      endSegment(false)
    } else if (ch === '&' && command[i + 1] !== '>' && command[i - 1] !== '|' && command[i - 1] !== '>') {
      endSegment(false)
    } else if (ch === '|') {
      const or = command[i + 1] === '|'
      if (or) i++
      endSegment(!or)
    } else if (ch === '>' || ch === '<') {
      const harmless = ch === '>' && /^(&\d|\s*\/dev\/null)/.exec(command.slice(i + 1))
      if (harmless) i += harmless[0].length
      else redirects = true
      if (/^(\d|&)$/.test(word)) {
        word = ''
        started = false
      }
      endWord()
    } else if (/\s/.test(ch)) {
      endWord()
    } else {
      word += ch
      started = true
    }
  }
  endWord()
  return { segments: segments.filter(s => s.words.length), redirects }
}

const isAssignment = (word: string) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)

const LEADING_KEYWORDS = new Set(['do', 'then', 'else', 'elif', 'if', 'while', 'until', '!', '{', '(', 'time'])
const HEADER_KEYWORDS = new Set(['for', 'select', 'done', 'fi', 'esac', '}', ')'])

const commandWords = (words: string[]) => {
  let i = 0
  while (i < words.length && (isAssignment(words[i]!) || LEADING_KEYWORDS.has(words[i]!))) i++
  return HEADER_KEYWORDS.has(words[i] ?? '') ? [] : words.slice(i)
}

const readsOnly = ({ words }: ShellPart): boolean => {
  const [name, ...rest] = commandWords(words)
  if (name === undefined) return true
  const args = rest.join(' ')
  if (name === 'gh' && rest[0] === 'api') return ghApiReadsOnly(rest.slice(1))
  if (Object.hasOwn(READ_SUBCOMMANDS, name)) return READ_SUBCOMMANDS[name]!.test(args) && !(name === 'git' && rest.some(a => /^--output\b/.test(a)))
  if (!READ_COMMANDS.has(name)) return false
  if (name === 'sed') {
    const [script, ...files] = rest.filter(a => a !== '-n')
    return script !== undefined && /^\d+(,\d+)?p$/.test(script) && files.every(f => !f.startsWith('-'))
  }
  if (name === 'find') return !rest.some(a => /^-(delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)$/.test(a))
  if (name === 'awk') return !rest.some(a => /^(-f|--file|-i|--include|-E|--exec|-l|--load)/.test(a)) && !/system\s*\(|getline|@(include|load)|[|>]/.test(args)
  if (name === 'sort') return !rest.some(a => /^(-[A-Za-z]*o|--output)/.test(a))
  if (name === 'uniq') return operandsOf(name, rest).length < 2
  if (name === 'tree') return !rest.some(a => /^(-o|--output)/.test(a))
  if (name === 'rg') return !rest.some(a => /^--pre/.test(a))
  if (name === 'pdftotext') return rest.at(-1) === '-'
  return true
}

export const isReadOnlyCall = (tool: string, input: unknown): boolean => {
  if (READ_TOOLS.has(tool)) return true
  if (tool !== 'Bash' && tool !== 'PowerShell') return false
  const command = field(input, 'command')
  if (command === undefined) return false
  if (/\$\(|`|<<|\btee\b/.test(command)) return false
  const shell = parseShell(command)
  return !shell.redirects && shell.segments.every(readsOnly)
}

const TRIVIAL_PROGRAMS = new Set(['cd', 'echo', 'export', 'printf', 'pwd', 'set', 'test', 'true'])

export const programsOf = (command: string): string[] => {
  const names: string[] = []
  for (const part of parseShell(command).segments) {
    const name = commandWords(part.words)[0]?.split('/').pop()
    if (name && !TRIVIAL_PROGRAMS.has(name) && !names.includes(name)) names.push(name)
  }
  return names.length > 3 ? [...names.slice(0, 3), '…'] : names
}

export const shortenPaths = (text: string, places: Places): string => {
  const prefix = (path: string) => new RegExp(`(?<![\\w.~:/-])${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`, 'g')
  let out = text
  if (places.cwd) out = out.replace(prefix(places.cwd), '')
  if (places.home) out = out.replace(prefix(places.home), '~/')
  return out.replace(/(?<![\w.~:/-])\/[^\s'"`;|&<>()]+/g, compactPath)
}

const VALUE_FLAGS: Record<string, Set<string>> = {
  grep: new Set(['-A', '-B', '-C', '-m', '-e', '-f', '--max-count', '--include', '--exclude', '--exclude-dir']),
  rg: new Set(['-A', '-B', '-C', '-m', '-e', '-f', '-g', '-t', '--type', '--glob', '--max-count', '--max-depth']),
  tree: new Set(['-L', '-P', '-I']),
  uniq: new Set(['-f', '-s', '-w']),
}

const operandsOf = (name: string, args: string[]): string[] => {
  const valued = VALUE_FLAGS[name]
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (valued?.has(a)) i++
    else if (!a.startsWith('-')) out.push(a)
  }
  return out
}

const describeCommand = (name: string, args: string[], places: Places): string | undefined => {
  const files = (list: string[]) => list.map(f => shortTarget(places, f)).join(', ')
  const ops = operandsOf(name, args)
  if (TRIVIAL_PROGRAMS.has(name)) return ''
  if (name === 'sed') {
    const range = args.find(a => /^\d+(,\d+)?p$/.test(a))
    const targets = ops.filter(a => a !== range)
    if (!range || !targets.length) return undefined
    const [from, to] = range.slice(0, -1).split(',')
    return `Read ${files(targets)} lines ${from}${to ? `–${to}` : ''}`
  }
  if (name === 'cat' || name === 'less' || name === 'nl') return ops.length ? `Read ${files(ops)}` : undefined
  if (name === 'pdftotext') return ops.length ? `Read ${files(ops.slice(0, 1))}` : undefined
  if (name === 'head' || name === 'tail') {
    const targets = ops.filter(a => !/^\d+$/.test(a))
    return targets.length ? `Read ${name === 'head' ? 'start' : 'end'} of ${files(targets)}` : undefined
  }
  if (name === 'grep' || name === 'rg') {
    const e = args.indexOf('-e')
    const pattern = e >= 0 ? args[e + 1] : ops[0]
    const paths = e >= 0 ? ops : ops.slice(1)
    return pattern === undefined ? undefined : `Searched ${paths.length ? files(paths) : '.'} for "${pattern}"`
  }
  if (name === 'ls' || name === 'tree') return `Listed ${ops.length ? files(ops) : '.'}`
  if (name === 'find') return `Listed ${args[0] && !args[0].startsWith('-') ? files([args[0]]) : '.'}`
  if (name === 'wc') return ops.length ? `Counted ${files(ops)}` : undefined
  return undefined
}

export const describeShell = (command: string, places: Places = { cwd: '', home: '' }): string | undefined => {
  if (!isReadOnlyCall('Bash', { command })) return undefined
  const vars = new Map<string, string>()
  const expand = (w: string) => w.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (m, v: string) => vars.get(v) ?? m)
  const parts: string[] = []
  for (const segment of parseShell(command).segments) {
    const words = commandWords(segment.words)
    if (!words.length) {
      for (const w of segment.words.filter(isAssignment)) vars.set(w.slice(0, w.indexOf('=')), expand(w.slice(w.indexOf('=') + 1)))
      continue
    }
    if (segment.piped) continue
    const [name, ...args] = words.map(expand)
    if (args.some(a => /\$\{?[A-Za-z_]/.test(a))) return undefined
    const text = describeCommand(name!, args, places)
    if (text === undefined) return undefined
    if (text) parts.push(text)
  }
  return parts.length ? parts.join(' · ') : undefined
}

const OUTPUT_LINES = 120

const lines = (value: unknown): string[] => (typeof value === 'string' && value !== '' ? value.replace(CONTROL, '').replace(/\n$/, '').split('\n') : [])

const BOX_INDENT = 2

const SHELL_FRAME = BOX_INDENT + 4

const COMMAND_LEAD = 2

type HeldPiece = Piece & { bold?: boolean }

type OutputLine = { text: string; color?: string }

const trimLead = ([first, ...rest]: HeldPiece[]): HeldPiece[] => {
  if (!first) return rest
  const text = first.text.trimStart()
  return text ? [{ ...first, text }, ...rest] : rest
}

const wrappedRows = (pieces: HeldPiece[], room: number | undefined): HeldPiece[][] => {
  const rows = visualRows(pieces, room)
  if (rows.length === 1) return rows
  return visualRows(tabbed(pieces), room).flatMap((part, k) => (k ? [trimLead(part)].filter(p => p.length) : [part]))
}

const outputLineRows = (style: Style, text: string, room: number | undefined): string[] =>
  mirrored(style) && hasRtl(text) ? wrappedRows([{ text, italic: false, word: false }], room).map(pieceText) : [text]

const outputRows = (style: Style, shown: OutputLine[], room: number | undefined): { rows: OutputLine[]; hidden: number } => {
  const rows: OutputLine[] = []
  let whole = 0
  for (const l of shown) {
    const left = OUTPUT_LINES - rows.length
    if (left <= 0) break
    const head = room !== undefined && mirrored(style) && hasRtl(l.text) ? clusters(l.text, left * room) : l.text
    const split = outputLineRows(style, head, room)
    rows.push(...split.slice(0, left).map(text => ({ text, color: l.color })))
    if (split.length > left || head.length < l.text.length) break
    whole++
  }
  return { rows, hidden: shown.length - whole }
}

const commandRows = (style: Style, line: string, head: string, tail: string, room: number | undefined): HeldPiece[][] | null => {
  if (!mirrored(style) || !hasRtl(line) || SHELL_COMMENT.test(line) || BOX_DRAWING.test(line)) return null
  const mark = (text: string): HeldPiece[] => (text ? [{ text, italic: false, word: false, bold: true }] : [])
  const code = wordPieces(shellSegments(style, line).map(seg => ({ ...seg, color: seg.color ?? style.theme.codeText })), null)
  return wrappedRows([...mark(head), ...code, ...mark(tail)], room)
}

const commandLine = (el: ElementTable, style: Style, row: ToolRow, line: string, i: number, last: boolean, room: number | undefined): RenderElement[] => {
  const { Box, Text } = el
  const held = commandRows(style, line, i === 0 ? `${row.tool}(` : '', last ? ')' : '', room)
  const cells = held?.map(part => ({ text: pieceText(part), cell: part.map((p, j) => <Text key={`${j}`} bold={p.bold} color={p.color}>{p.text}</Text>) })) ?? [
    { text: line, cell: [i === 0 ? <Text key="h" bold>{`${row.tool}(`}</Text> : null, codeLine(el, style, line, 'bash', `cmd${i}`), last ? <Text key="t" bold>)</Text> : null] },
  ]
  return cells.map(({ text, cell }, k) => (
    <Box key={`c${i}.${k}`} flexDirection="row">
      <Box width={COMMAND_LEAD} flexShrink={0}>{i === 0 && k === 0 ? <Text color={statusColor(style.theme, row)}>{row.isRunning ? '◌' : '●'}</Text> : <Text>{heldLabel(style, '  ', text)}</Text>}</Box>
      <Text>{cell}</Text>
    </Box>
  ))
}

export const renderExpandedShell = (el: ElementTable, style: Style, row: ToolRow & { output?: unknown }, columns?: number): RenderElement => {
  const { Box, Text } = el
  const t = style.theme
  const command = (field(row.input, 'command') ?? '').replace(CONTROL, '').split('\n')
  const out = row.output !== null && typeof row.output === 'object' ? (row.output as Record<string, unknown>) : {}
  const shown: OutputLine[] = [...lines(out.stdout).map(text => ({ text })), ...lines(out.stderr).map(text => ({ text, color: t.codeFlag }))]
  const { rows, hidden } = outputRows(style, shown, columns === undefined ? undefined : columns - SHELL_FRAME)
  return (
    <Box flexDirection="column">
      {command.flatMap((line, i) => commandLine(el, style, row, line, i, i === command.length - 1, columns === undefined ? undefined : columns - COMMAND_LEAD))}
      {row.isRunning ? null : (
        <Box paddingLeft={BOX_INDENT}>
          <Box flexDirection="column" alignSelf="flex-start" borderStyle="round" borderColor={t.codeComment} paddingRight={1}>
            {rows.length === 0 ? heldRow(el, style, 'o0', ' ', '', <Text dimColor>(No output)</Text>) : rows.map((r, i) => heldRow(el, style, `o${i}`, ' ', r.text, <Text color={r.color}>{r.text === '' ? ' ' : r.text}</Text>))}
            {hidden ? heldRow(el, style, 'more', ' ', '', <Text dimColor>{`\u2026 +${hidden} lines`}</Text>) : null}
          </Box>
        </Box>
      )}
    </Box>
  )
}

const GROUPS: [RegExp, string, string][] = [
  [/^(Bash|PowerShell)$/, 'ran', 'command'],
  [/^Read$/, 'read', 'file'],
  [/^(Write|Edit|MultiEdit|NotebookEdit)$/, 'edited', 'file'],
  [/^(Grep|Glob)$/, 'searched', 'pattern'],
  [/^(WebFetch|WebSearch)$/, 'fetched', 'page'],
  [/^(Agent|Task)$/, 'delegated', 'task'],
]

const SILENT_TOOLS = new Set(['ToolSearch', 'TodoWrite', 'TaskCreate', 'TaskGet', 'TaskUpdate', 'TaskList', 'REPL'])

export const countedCalls = <T extends { tool: string; tool_use_id?: string }>(calls: readonly T[]): T[] => {
  const seen = new Set<string>()
  return calls.filter(call => {
    if (SILENT_TOOLS.has(call.tool)) return false
    if (call.tool_use_id === undefined) return true
    if (seen.has(call.tool_use_id)) return false
    seen.add(call.tool_use_id)
    return true
  })
}

export const groupSummary = (calls: readonly { tool: string }[]): string => {
  const counts = new Map<string, number>()
  for (const call of calls) {
    const [, verb, noun] = GROUPS.find(([re]) => re.test(call.tool)) ?? [, 'used', call.tool.replace(/^mcp__([^_]+)__/, '$1 ')]
    const label = `${verb} ${noun}`
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  const parts = [...counts].map(([label, n]) => {
    const [verb, ...noun] = label.split(' ')
    const name = noun.join(' ')
    return `${verb} ${n} ${n === 1 ? name : name.endsWith('h') ? `${name}es` : `${name}s`}`
  })
  const text = parts.join(', ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const quietToolGroup = (el: ElementTable, style: Style, calls: readonly (ToolRow & { output?: unknown })[], isActive: boolean, columns: number, hint: string): RenderElement => {
  const t = style.theme
  const failed = calls.filter(c => c.isErrored)
  const running = isActive && calls.some(c => c.isRunning)
  const dot = failed.length ? t.codeFlag : running ? t.accent : t.number
  const labels = calls.map(c => callPieces(c, style)).filter((l, i, all) => pieceText(l) !== (i ? pieceText(all[i - 1]!) : undefined))
  const label = labels.map(pieceText).join(' · ')
  const reasons = failed.map((c, i) => renderFailure(el, style, c.output, `r${i}`)).filter((r): r is RenderElement => r !== undefined)
  const isShell = (c: ToolRow) => c.tool === 'Bash' || c.tool === 'PowerShell'
  const results = calls.flatMap((c, i) => (c.isErrored || c.output === undefined || !isShell(c) || isReadOnlyCall(c.tool, c.input) ? [] : [<el.Box key={`o${i}`}>{renderShellResult(el, style, c.output)}</el.Box>]))
  const row = toolLayout(el, style, columns, label, dot, running, (
    <el.Text wrap="truncate-end" dimColor={toolDim(style)}>{drawPieces(el, style, labels.flatMap((l, i) => (i ? [{ text: ' · ' }, ...l] : l)))}</el.Text>
  ), hint)
  if (!reasons.length && !results.length) return row
  return (
    <el.Box flexDirection="column">
      {row}
      {reasons}
      {results}
    </el.Box>
  )
}

export const renderToolGroup = (el: ElementTable, style: Style, calls: readonly (ToolRow & { output?: unknown })[], isActive: boolean, columns = 100, hint = ''): RenderElement => {
  if (style.toolOutput === 'quiet') return quietToolGroup(el, style, calls, isActive, columns, hint)
  const { Text } = el
  const t = style.theme
  const failed = calls.filter(c => c.isErrored).length
  const running = isActive && calls.some(c => c.isRunning)
  const dot = failed ? t.codeFlag : running ? t.accent : t.number
  const last = calls[calls.length - 1]
  const lastFound = last ? targetOf(style, last.input, ['command', ...TARGET_FIELDS]) : {}
  const lastTarget = lastFound.target?.split('\n')[0]
  const summary = groupSummary(calls)
  const label = `${summary}${failed ? ` · ${failed} failed` : ""}${lastTarget ? ` · last: ${lastTarget}` : ""}`
  return toolLayout(el, style, columns, label, dot, running, (
      <Text wrap="truncate-end" dimColor={toolDim(style)}>
        <Text bold={!toolDim(style)} dimColor={toolDim(style)}>{summary}</Text>
        {failed ? <Text color={t.codeFlag}>{` · ${failed} failed`}</Text> : null}
        {lastTarget ? <Text dimColor>{drawPieces(el, style, [{ text: ' · last: ' }, { text: lastTarget, path: toolPath(last?.tool, lastFound.path) }])}</Text> : null}
      </Text>
  ), hint)
}

export const pasteLang = (body: string): string => {
  const s = body.trim()
  if (/^[[{]/.test(s)) {
    try {
      JSON.parse(s)
      return 'json'
    } catch {}
  }
  if (/^@@ /m.test(s) && /^(diff |--- |\+\+\+ )/m.test(s)) return 'diff'
  return /^<[a-z!?]/i.test(s) && />$/.test(s) ? 'markup' : ''
}

const PASTE = /<pasted_content id="([^"]*)">\n?([\s\S]*?)\n?<\/pasted_content id="\1">/g

export type DrawPaste = (body: string, key: string) => RenderElement

const boxedPrompt = (style: Style) => style.promptStyle === 'bubble' || style.promptStyle === 'wide'

const widePrompt = (style: Style, hebrew: boolean) => style.promptStyle === 'wide' || (hebrew && mirrored(style))

export const renderUserPrompt = (el: ElementTable, style: Style, typed: string, columns: number, time?: string, paste?: DrawPaste): RenderElement => {
  const { Box, Text } = el
  const pastes: string[] = []
  const text = typed.replace(PASTE, (_, _id, body: string) => `\0${pastes.push(body) - 1}\0`)
  const own = (line: string) => paste && /^\0\d+\0$/.test(line) ? pastes[Number(line.slice(1, -1))]! : undefined
  const told = (line: string) => line.replace(/\0(\d+)\0/g, (_, n) => `[Pasted text +${pastes[Number(n)]!.split('\n').length} lines]`)
  const t = style.theme
  const color = style.promptStyle === 'chevron' ? t.accent : t.heading
  const rows = text.split('\n')
  const lines = rows.map(line => (own(line) === undefined ? flowOf(style, [{ kind: 'text', text: told(line) }], columns - 4 - (time === undefined ? 0 : time.length + 1)) : null))
  const hebrew = lines.some(l => l?.base === 'R')
  const rtl = hebrew && !mirrored(style)
  const body = (
    <Box flexDirection="column" {...(rtl ? { alignItems: 'flex-end' as const } : {})}>
      {rows.map((line, i) => {
        const pasted = own(line)
        if (pasted !== undefined) return paste!(pasted, `paste${i}`)
        const flow = lines[i]
        return flow ? renderFlow(el, style, flow.lines, `p${i}`, { color, bold: style.promptStyle === 'chevron' }) : <Text key={`p${i}`} color={color} bold={style.promptStyle === 'chevron'}>{told(line)}</Text>
      })}
    </Box>
  )
  const stamp = time === undefined ? null : <Text color={t.codeComment}>{rtl ? ` ${time}` : `${time} `}</Text>
  const content = stamp === null ? body : <Box flexDirection="row">{rtl ? body : stamp}{rtl ? stamp : body}</Box>
  if (boxedPrompt(style)) {
    return <Box borderStyle="round" borderColor={t.accent} paddingX={1} alignSelf={rtl ? 'flex-end' : 'flex-start'} {...(widePrompt(style, hebrew) ? { width: '100%' } : {})}>{content}</Box>
  }
  const mark = <Text color={t.accent} bold>{style.promptStyle === 'bar' ? (rtl ? ' ▐' : '▌ ') : rtl ? ' ‹' : '› '}</Text>
  return <Box flexDirection="row" {...(rtl ? { justifyContent: 'flex-end' as const } : {})}>{rtl ? content : mark}{rtl ? mark : content}</Box>
}
