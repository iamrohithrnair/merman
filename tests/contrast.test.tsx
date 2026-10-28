import { expect, test } from 'claude-code/testing'

import { PRESET_BACKGROUNDS, PRESETS } from '../hooks/presets'
import { BAND_STEP, contrast, diffTint, onTint, previewBand } from '../hooks/render'
import type { Theme } from '../hooks/theme'

const BACKGROUNDS: Record<string, string | undefined> = PRESET_BACKGROUNDS

const FLOOR: Record<string, number> = { rule: 1.05, tableRule: 1.05, diagram: 3, codeComment: 3 }

const UPSTREAM_PALETTE_BELOW_AA: Record<string, Record<string, number>> = {
  'catppuccin-latte': { heading: 2.31, tableHeader: 2.31, emphasis: 2.33, inlineCode: 2.46, codeCommand: 4.34, codeString: 2.95, codeComment: 2.3, link: 4.34, path: 2.77, number: 2.95, quote: 4.36, diffAdded: 3.02 },
  dracula: { quote: 3.02 },
  nord: { emphasis: 4.4, codeComment: 1.69, number: 4.4, diffRemoved: 3.05 },
  'tokyo-night': { codeComment: 2.76 },
  'gruvbox-dark': { diffRemoved: 4.28 },
  'gruvbox-light': { heading: 3.32, tableHeader: 3.32, inlineCode: 4.4, codeString: 4.28, path: 4.4, quote: 4.28, diffAdded: 4.28 },
  'rose-pine-dawn': { accent: 3.46, heading: 3.46, tableHeader: 2.05, emphasis: 2.6, inlineCode: 3.13, codeCommand: 3.13, codeFlag: 3.84, codeString: 2.05, codeComment: 2.72, link: 3.46, number: 2.6, quote: 4.02, bullet: 3.84, diffAdded: 3.13, diffRemoved: 3.84 },
  'one-dark': { heading: 4.38, codeFlag: 4.38, codeComment: 2.31, quote: 3.98, diffRemoved: 4.38 },
  'solarized-dark': { accent: 3.42, emphasis: 3.3, codeCommand: 4.07, codeFlag: 3.25, codeComment: 2.78, link: 4.07, quote: 3.37, bullet: 3.42, diffRemoved: 3.24 },
  'solarized-light': { accent: 4.05, heading: 2.97, tableHeader: 2.97, emphasis: 4.21, inlineCode: 2.92, codeCommand: 3.41, codeFlag: 4.27, codeString: 2.97, codeComment: 2.47, link: 3.41, path: 2.92, number: 2.97, quote: 2.93, bullet: 4.05, diffAdded: 3, diffRemoved: 4.28 },
}

const presets = () =>
  Object.entries(PRESETS as Record<string, Theme>).filter(([name]) => name !== 'mono').map(([name, theme]) => {
    const bg = BACKGROUNDS[name]
    if (!bg) throw new Error(`no background for ${name}`)
    return { name, theme, bg }
  })

test('every preset meets WCAG AA on its own background, except upstream palette colors that may only get better', async () => {
  const failures: string[] = []
  for (const { name, theme, bg } of presets()) {
    for (const [token, color] of Object.entries(theme)) {
      const ratio = contrast(color, bg)
      const kept = UPSTREAM_PALETTE_BELOW_AA[name]?.[token]
      const floor = FLOOR[token] ?? 4.5
      if (ratio < (kept ?? floor)) failures.push(`${name}.${token} ${ratio.toFixed(2)}`)
      if (kept !== undefined && ratio >= floor) failures.push(`${name}.${token} passes now, drop it from the list`)
    }
  }
  expect(failures).toEqual([])
})

test('diff text stays at WCAG AA on the added and removed tints of every preset', async () => {
  const failures: string[] = []
  for (const { name, theme } of presets()) {
    for (const color of [theme.diffAdded ?? theme.number, theme.diffRemoved ?? theme.codeFlag]) {
      const ratio = contrast(theme.codeText!, diffTint(theme.codeText, color)!)
      if (ratio < 4.5) failures.push(`${name} ${color} ${ratio.toFixed(2)}`)
    }
  }
  expect(failures).toEqual([])
})

test('the hover band under a new file\'s preview is a visible step from every preset\'s background, and its code text still reads at 4.5:1', async () => {
  const failures: string[] = []
  for (const { name, theme, bg } of presets()) {
    const band = previewBand(theme, bg)!
    const step = contrast(band, bg)
    if (step < BAND_STEP || step > BAND_STEP + 0.1) failures.push(`${name} band ${band} is ${step.toFixed(2)}:1 from ${bg}`)
    const ink = onTint(theme.codeText, band)!
    if (contrast(ink, band) < 4.5) failures.push(`${name} code text ${ink} on ${band} ${contrast(ink, band).toFixed(2)}`)
  }
  expect(failures).toEqual([])
})

test('the + and − diff marks of every preset reach 3:1 on its own background, upstream palette colors included', async () => {
  const failures: string[] = []
  for (const { name, theme, bg } of presets()) {
    for (const token of ['diffAdded', 'diffRemoved'] as const) {
      const ratio = contrast(theme[token]!, bg)
      if (ratio < 3) failures.push(`${name}.${token} ${ratio.toFixed(2)}`)
    }
  }
  expect(failures).toEqual([])
})
