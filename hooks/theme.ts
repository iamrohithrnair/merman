import type { PluginOptions } from 'claude-code'

import type { ClipboardBackend } from './clipboard'
import type { Block } from './markdown'
import type { PresetName } from './presets'
import { PRESET_BACKGROUNDS, PRESET_NAMES, PRESETS } from './presets'
import type { Shape, Terminal } from './rtl'
import { TERMINALS } from './rtl'

export const TOKENS = [
  'accent', 'heading', 'strong', 'emphasis', 'inlineCode', 'codeText', 'codeCommand', 'codeFlag', 'codeString', 'codeComment',
  'link', 'path', 'number', 'quote', 'rule', 'tableHeader', 'tableRule', 'bullet', 'diagram', 'diagramText', 'diffAdded', 'diffRemoved',
] as const

export type Theme = Partial<Record<(typeof TOKENS)[number], string>>

export type Clock = 'off' | '24h' | '12h'

export type Style = {
  theme: Theme
  background?: string
  headingStyle: 'bold' | 'underline' | 'uppercase' | 'banner'
  tableStyle: 'box' | 'rules' | 'grid' | 'minimal'
  taskStyle: 'checks' | 'ticks' | 'box' | 'progress'
  promptStyle: 'bubble' | 'wide' | 'bar' | 'chevron' | 'off'
  clock: Clock
  toolStyle: 'chat' | 'tree-dim' | 'tree-bold' | 'classic'
  toolOutput: 'full' | 'quiet'
  narration?: boolean
  inside?: 'quote' | 'alert'
  noteKey?: string
  pressPreview?: boolean
  diffStyle: 'card' | 'full' | 'marks' | 'bar'
  pieStyle: 'round' | 'bars'
  highlightNumbers: boolean
  highlightPaths: boolean
  mermaid: boolean
  mermaidAscii: boolean
  copyButtons: boolean
  copyButtonStyle: 'inline' | 'hover'
  htmlCopy: ClipboardBackend | null
  nativeCode?: boolean
  plainCode?: ReadonlySet<Block>
  gridFace?: boolean
  httpLinks: boolean
  editorLinks: boolean
  fileLinks: string | null
  pathLinks: boolean
  found?: ReadonlySet<string>
  diagramHints: boolean
  rtl: 'auto' | Terminal | 'off'
  reorder: boolean
  shape: Shape
  latex: boolean
  cwd: string
  home: string
}

const COLOR = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|ansi256\(\d{1,3}\)|(black|red|green|yellow|blue|magenta|cyan|white|gray|grey)(Bright)?)$/i

export const isColor = (value: unknown): value is string => typeof value === 'string' && COLOR.test(value.trim())

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback

export const RANDOM_THEMES: readonly string[] = PRESET_NAMES.filter(t => !/latte|light|dawn/.test(t) && t !== 'mono')

export const pickTheme = (value: unknown, random = Math.random): string => {
  const name = value === 'random' ? RANDOM_THEMES[Math.floor(random() * RANDOM_THEMES.length)] : value
  return (PRESET_NAMES as readonly unknown[]).includes(name) ? String(name) : 'catppuccin-mocha'
}

export const resolveStyle = (options: PluginOptions): Style => {
  const preset = (PRESET_NAMES as string[]).includes(String(options.theme)) ? (String(options.theme) as PresetName) : 'catppuccin-mocha'
  const base: Theme = PRESETS[preset]
  const fromFields = Object.fromEntries(
    TOKENS.filter(k => isColor(options[`${k}Color`])).map(k => [k, String(options[`${k}Color`]).trim()]),
  )

  const rtl = pick(options.rtl, ['auto', 'off', ...(Object.keys(TERMINALS) as Terminal[])], 'auto')

  return {
    theme: { ...base, ...fromFields },
    ...(PRESET_BACKGROUNDS[preset] ? { background: PRESET_BACKGROUNDS[preset] } : {}),
    headingStyle: pick(options.headingStyle, ['bold', 'underline', 'uppercase', 'banner'] as const, 'banner'),
    tableStyle: pick(options.tableStyle, ['box', 'rules', 'grid', 'minimal'] as const, 'box'),
    taskStyle: pick(options.taskStyle, ['checks', 'ticks', 'box', 'progress'] as const, 'checks'),
    promptStyle: pick(options.promptStyle, ['bubble', 'wide', 'bar', 'chevron', 'off'] as const, 'bubble'),
    clock: pick(options.clock, ['off', '24h', '12h'] as const, 'off'),
    toolStyle: pick(options.toolStyle, ['chat', 'tree-dim', 'tree-bold', 'classic'] as const, 'chat'),
    toolOutput: pick(options.toolOutput, ['full', 'quiet'] as const, 'full'),
    diffStyle: pick(options.diffStyle, ['card', 'full', 'marks', 'bar'] as const, 'card'),
    pieStyle: pick(options.pieStyle, ['round', 'bars'] as const, 'round'),
    highlightNumbers: options.highlightNumbers !== false,
    highlightPaths: options.highlightPaths !== false,
    mermaid: options.mermaid !== false,
    mermaidAscii: options.mermaidAscii === true,
    copyButtons: options.copyButtons !== false,
    copyButtonStyle: pick(options.copyButtonStyle, ['inline', 'hover'] as const, 'inline'),
    htmlCopy: null,
    httpLinks: false,
    editorLinks: false,
    fileLinks: null,
    pathLinks: false,
    diagramHints: options.diagramHints !== false && options.mermaid !== false,
    rtl,
    reorder: rtl !== 'auto' && rtl !== 'off',
    shape: rtl === 'auto' || rtl === 'off' ? 'visual' : TERMINALS[rtl],
    latex: options.latex === true,
    cwd: '',
    home: '',
  }
}
