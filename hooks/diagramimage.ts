import { isC4Kind } from './c4'
import type { Block } from './markdown'
import { ansiNameHex, ratexColor } from './latex'
import { diagramPalette, kindOf } from './mermaid'
import type { Style } from './theme'

export type DiagramPicture = { png: string; width: number; height: number }

export type DiagramImage = DiagramPicture | { error: true }

type Fit = { columns: number; rows: number }

export const DIAGRAM_SCALE = 2
const CSS_PX_PER_COLUMN = 9
const CELL_RATIO = 0.5
const MAX_DIAGRAM_ROWS = 40
const MAX_DIAGRAM_COLUMNS = 255

export const DIAGRAM_PROBE = 'flowchart LR\n  a --> b'

const WIDTH_STEP = 20
const GANTT_DATES = '%b %e'
const BROWSER_MARGIN_PX = 16
const OFFLINE_ARGS = ['--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>', '--host-resolver-rules=MAP * ~NOTFOUND']

export const layoutWidth = (columns: number): number => {
  const room = Math.min(MAX_DIAGRAM_COLUMNS, columns - 2)
  return Math.max(WIDTH_STEP, Math.floor(room / WIDTH_STEP) * WIDTH_STEP) * CSS_PX_PER_COLUMN
}

export const sizedConfig = (config: string, width: number): string => JSON.stringify({ ...JSON.parse(config), gantt: { useWidth: width, axisFormat: GANTT_DATES }, xyChart: { width } })

export const browserConfig = (width: number): string => JSON.stringify({ args: OFFLINE_ARGS, defaultViewport: { width: width + BROWSER_MARGIN_PX, height: 600 } })

export const diagramSourceOf = (block: Block): string | null => {
  if (block.kind !== 'code' || block.isOpen || block.lang.toLowerCase() !== 'mermaid') return null
  const source = block.lines.join('\n').trim()
  return source === '' || isC4Kind(kindOf(source)) ? null : source
}

export const diagramBytes = (image: DiagramImage): number => ('png' in image ? image.png.length : 0)

const fullHex = (color: string): string | null => {
  const c = ansiNameHex(ratexColor(color)).trim()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c)
  if (short) return `#${short.slice(1).map(d => d + d).join('')}`.toLowerCase()
  return /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : null
}

const channels = (hex: string): number[] => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16))

const mix = (base: string, over: string, amount: number): string =>
  `#${channels(base).map((b, i) => Math.round(b + (channels(over)[i]! - b) * amount).toString(16).padStart(2, '0')).join('')}`

const luminance = (hex: string): number => {
  const [r, g, b] = channels(hex).map(v => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

const colorOr = (value: string | undefined, fallback: string): string => (value && fullHex(value)) || fallback

type Colors = { bg: string; text: string; line: string; heading: string; muted: string; rule: string; palette: string[]; dark: boolean; behind: string; ink: string }

const colorsOf = (style: Style): Colors => {
  const t = style.theme
  const text = colorOr(t.diagramText ?? t.codeText, '#808080')
  const known = style.background === undefined ? null : fullHex(style.background)
  const bg = known ?? text
  const dark = known ? luminance(known) < luminance(text) : luminance(text) > 0.4
  const line = colorOr(t.diagram ?? t.accent, text)
  const palette = diagramPalette(t).map(c => fullHex(c)).filter((c): c is string => c !== null)
  return { bg, text, line, heading: colorOr(t.heading, text), muted: colorOr(t.quote ?? t.codeComment, text), rule: colorOr(t.tableRule ?? t.rule, line), palette: palette.length ? palette : [line], dark, behind: known ?? 'transparent', ink: known ?? (dark ? '#000000' : '#ffffff') }
}

const scaleVariables = (c: Colors): Record<string, string> => {
  const vars: Record<string, string> = {}
  for (let i = 0; i < 12; i++) {
    const hue = c.palette[i % c.palette.length]!
    vars[`pie${i + 1}`] = hue
    vars[`cScale${i}`] = mix(c.bg, hue, 0.35)
    vars[`cScaleLabel${i}`] = c.text
    vars[`cScalePeer${i}`] = hue
    vars[`git${i % 8}`] = hue
  }
  return vars
}

const nodeVariables = (c: Colors): Record<string, string> => {
  const fill = mix(c.bg, c.line, 0.18)
  const second = mix(c.bg, c.palette[1 % c.palette.length]!, 0.18)
  const third = mix(c.bg, c.palette[2 % c.palette.length]!, 0.12)
  return {
    background: c.ink, primaryColor: fill, primaryTextColor: c.text, primaryBorderColor: c.line,
    secondaryColor: second, secondaryTextColor: c.text, secondaryBorderColor: c.palette[1 % c.palette.length]!,
    tertiaryColor: third, tertiaryTextColor: c.text, tertiaryBorderColor: c.rule,
    mainBkg: fill, nodeBorder: c.line, nodeTextColor: c.text, textColor: c.text, titleColor: c.heading,
    lineColor: c.line, defaultLinkColor: c.line, arrowheadColor: c.line,
    edgeLabelBackground: c.behind, labelBackground: c.behind,
    clusterBkg: mix(c.bg, c.line, 0.06), clusterBorder: c.rule,
    noteBkgColor: mix(c.bg, c.heading, 0.16), noteTextColor: c.text, noteBorderColor: c.heading,
  }
}

const sequenceVariables = (c: Colors): Record<string, string> => ({
  actorBkg: mix(c.bg, c.line, 0.18), actorBorder: c.line, actorTextColor: c.text, actorLineColor: c.rule,
  signalColor: c.text, signalTextColor: c.text, labelBoxBkgColor: mix(c.bg, c.line, 0.18), labelBoxBorderColor: c.line,
  labelTextColor: c.text, loopTextColor: c.text, activationBkgColor: mix(c.bg, c.line, 0.3), activationBorderColor: c.line,
  sequenceNumberColor: c.ink,
})

const chartVariables = (c: Colors): Record<string, string> => ({
  pieOpacity: '1', pieStrokeColor: c.behind, pieOuterStrokeColor: c.rule, pieSectionTextColor: c.ink, pieTitleTextColor: c.heading, pieLegendTextColor: c.text,
  sectionBkgColor: mix(c.bg, c.line, 0.08), altSectionBkgColor: c.behind, sectionBkgColor2: mix(c.bg, c.palette[1 % c.palette.length]!, 0.08),
  taskBkgColor: mix(c.bg, c.line, 0.45), taskBorderColor: c.line, taskTextColor: c.text, taskTextLightColor: c.text, taskTextOutsideColor: c.text, taskTextDarkColor: c.text,
  activeTaskBkgColor: mix(c.bg, c.palette[1 % c.palette.length]!, 0.45), activeTaskBorderColor: c.palette[1 % c.palette.length]!,
  doneTaskBkgColor: mix(c.bg, c.muted, 0.35), doneTaskBorderColor: c.muted, critBkgColor: mix(c.bg, c.palette[2 % c.palette.length]!, 0.45), critBorderColor: c.palette[2 % c.palette.length]!,
  gridColor: c.rule, todayLineColor: c.heading,
  classText: c.text, relationColor: c.line, relationLabelColor: c.text, relationLabelBackground: c.behind,
  attributeBackgroundColorOdd: mix(c.bg, c.line, 0.06), attributeBackgroundColorEven: c.behind,
  personBorder: c.line, personBkg: mix(c.bg, c.line, 0.18),
})

export const diagramConfig = (style: Style): string => {
  const c = colorsOf(style)
  const xyChart = {
    backgroundColor: 'transparent', titleColor: c.heading, xAxisLabelColor: c.text, xAxisTitleColor: c.text, xAxisTickColor: c.rule, xAxisLineColor: c.rule,
    yAxisLabelColor: c.text, yAxisTitleColor: c.text, yAxisTickColor: c.rule, yAxisLineColor: c.rule, plotColorPalette: c.palette.join(', '),
  }
  const themeVariables = { darkMode: c.dark, fontFamily: 'sans-serif', ...nodeVariables(c), ...sequenceVariables(c), ...chartVariables(c), ...scaleVariables(c), xyChart }
  return JSON.stringify({ theme: 'base', themeVariables })
}

export const fitDiagram = (size: { width: number; height: number }, columns: number): Fit | null => {
  if (size.width <= 0 || size.height <= 0) return null
  const room = Math.min(MAX_DIAGRAM_COLUMNS, columns - 2)
  const aspect = (size.height / size.width) * CELL_RATIO
  let wide = Math.max(1, Math.min(room, Math.ceil(size.width / DIAGRAM_SCALE / CSS_PX_PER_COLUMN)))
  if (wide * aspect > MAX_DIAGRAM_ROWS) wide = Math.max(1, Math.floor(MAX_DIAGRAM_ROWS / aspect))
  const rows = Math.max(1, Math.min(MAX_DIAGRAM_ROWS, Math.round(wide * aspect)))
  return room >= 1 ? { columns: wide, rows } : null
}
