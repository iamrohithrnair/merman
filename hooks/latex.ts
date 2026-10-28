import type { Block } from './markdown'

type Picture = { png: string; width: number; height: number }

export type Formula = (Picture & { padded?: Picture }) | { error: true }

type Size = { width: number; height: number }
type Fit = { columns: number; rows: number }

export const LATEX_FONT_PX = 80
export const LATEX_DPR = 1
const PX_PER_ROW = LATEX_FONT_PX * LATEX_DPR
const CELL_RATIO = 0.5
const RATEX_MARGIN_PX = 10
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024

const ANSI16 = ['000000', 'cd0000', '00cd00', 'cdcd00', '0000ee', 'cd00cd', '00cdcd', 'e5e5e5', '7f7f7f', 'ff0000', '00ff00', 'ffff00', '5c5cff', 'ff00ff', '00ffff', 'ffffff']
const ANSI_NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']

const hex = (...rgb: number[]): string => `#${rgb.map(n => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')).join('')}`

const ansi256 = (n: number): string => {
  if (n < 16) return `#${ANSI16[n]}`
  const level = (v: number) => (v ? 55 + v * 40 : 0)
  if (n < 232) return hex(level(Math.floor((n - 16) / 36)), level(Math.floor((n - 16) / 6) % 6), level((n - 16) % 6))
  const gray = 8 + (n - 232) * 10
  return hex(gray, gray, gray)
}

export const ratexColor = (color: string): string => {
  const c = color.trim()
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(c)
  if (rgb) return hex(...rgb.slice(1).map(Number))
  const ansi = /^ansi256\((\d+)\)$/i.exec(c)
  if (ansi) return ansi256(Number(ansi[1]))
  const name = /^(black|red|green|yellow|blue|magenta|cyan|white|gray|grey)(bright)?$/i.exec(c)
  if (!name?.[2]) return c
  const base = name[1]!.toLowerCase()
  return `#${ANSI16[base === 'gray' || base === 'grey' ? 8 : ANSI_NAMES.indexOf(base) + 8]}`
}

const MAX_FORMULAS = 50
export const MAX_PICTURE_BYTES = 8 * 1024 * 1024

export const formulaBytes = (formula: Formula): number => ('png' in formula ? formula.png.length + (formula.padded?.png.length ?? 0) : 0)

export const keepFormulas = <T,>(store: Record<string, T>, fresh: readonly (readonly [string, T])[], wanted: ReadonlySet<string>, bytesOf: (value: T) => number = () => 0): Record<string, T> => {
  const added = new Set(fresh.map(([key]) => key))
  const entries = [...Object.entries(store).filter(([key]) => !added.has(key)), ...fresh]
  const dropped = new Set<string>()
  let count = entries.length
  let bytes = entries.reduce((sum, [, value]) => sum + bytesOf(value), 0)
  for (const [key, value] of entries) {
    if (count <= MAX_FORMULAS && bytes <= MAX_PICTURE_BYTES) break
    if (wanted.has(key) || added.has(key)) continue
    dropped.add(key)
    count--
    bytes -= bytesOf(value)
  }
  return Object.fromEntries(entries.filter(([key]) => !dropped.has(key)))
}

export const fitsImage = (base64: string): boolean => (base64.length * 3) / 4 <= MAX_IMAGE_BYTES

const naturalRows = (size: Size): number => size.height / PX_PER_ROW

export const padFor = (size: Size): { rows: number; fontSize: number; dpr: number } | null => {
  const natural = naturalRows(size)
  const below = Math.floor(natural)
  const above = Math.max(1, Math.ceil(natural))
  if ((below >= 1 && below / natural >= 0.9) || above / natural <= 1.05) return null
  const dpr = LATEX_DPR + (above * PX_PER_ROW - size.height) / (2 * RATEX_MARGIN_PX)
  return { rows: above, fontSize: PX_PER_ROW / dpr, dpr }
}

export const mathOf = (block: Block): string | null => {
  if (block.kind !== 'code' || block.lang.toLowerCase() !== 'math' || block.isOpen) return null
  const tex = block.lines.map(line => line.replace(/(^|[^\\])%.*$/, '$1')).join(' ').replace(/\s+/g, ' ').trim()
  return tex === '' || tex.startsWith('#') ? null : tex
}

export const pngSize = (base64: string): Size | null => {
  const head = atob(base64.slice(0, 32))
  if (!head.startsWith('\x89PNG')) return null
  const word = (at: number) => [0, 1, 2, 3].reduce((n, i) => n * 256 + head.charCodeAt(at + i), 0)
  return { width: word(16), height: word(20) }
}

const rowsOf = (size: Size): number => Math.min(255, Math.max(1, Math.round(naturalRows(size))))

const fitFormula = (size: Size, columns: number): Fit | null => {
  const aspect = size.width / size.height / CELL_RATIO
  const room = Math.min(255, columns - 2)
  let rows = rowsOf(size)
  while (rows > 1 && Math.round(aspect * rows) > room) rows--
  const width = Math.max(1, Math.round(aspect * rows))
  return width <= room ? { columns: width, rows } : null
}

export const pickFormula = (formula: Exclude<Formula, { error: true }>, columns: number): { picture: Picture; fit: Fit } | null => {
  if (formula.padded) {
    const fit = fitFormula(formula.padded, columns)
    if (fit && fit.rows === rowsOf(formula.padded)) return { picture: formula.padded, fit }
  }
  const fit = fitFormula(formula, columns)
  return fit ? { picture: formula, fit } : null
}

export const renderedOf = (stdout: string): Set<number> => new Set([...stdout.matchAll(/^OK\s+(\d+)\s/gm)].map(m => Number(m[1])))

const IMAGE_PX_PER_COLUMN = 10
const IMAGE_MAX_ROWS = 20

export const imageOf = (block: Block): { alt: string; src: string } | null => {
  if (block.kind !== 'paragraph') return null
  const [only, ...rest] = block.inline.filter(n => n.kind !== 'text' || n.text.trim())
  return only?.kind === 'image' && rest.length === 0 ? { alt: only.text, src: only.src } : null
}

const local = (path: string): { path: string } | null => (path.replace(/\\/g, '/').startsWith('//') ? null : { path })

const decoded = (text: string): string | null => {
  try {
    return decodeURIComponent(text)
  } catch {
    return null
  }
}

export const imageFile = (src: string, home: string): { png: string } | { path: string } | null => {
  const data = /^data:image\/png;base64,([A-Za-z0-9+/]{32,}=*)$/i.exec(src)
  if (data) return { png: data[1]! }
  if (/^file:\/\//i.test(src)) {
    const path = decoded(src.slice(7))?.replace(/^localhost(?=\/)/i, '')
    return path?.startsWith('/') ? local(path) : null
  }
  if (src.startsWith('~/')) return home ? { path: `${home}${src.slice(1)}` } : null
  return /^[a-z][a-z0-9+.-]*:/i.test(src) ? null : local(src)
}

export const fitImage = (size: Size, columns: number): Fit => {
  const aspect = size.width / size.height / CELL_RATIO
  const wide = Math.max(1, Math.min(255, columns - 2, Math.ceil(size.width / IMAGE_PX_PER_COLUMN)))
  const rows = Math.max(1, Math.min(IMAGE_MAX_ROWS, Math.round(wide / aspect)))
  return { columns: Math.max(1, Math.min(wide, Math.round(rows * aspect))), rows }
}
