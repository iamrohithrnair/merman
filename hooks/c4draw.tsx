import type { ElementTable, RenderElement } from 'claude-code'

import type { C4Paint } from './c4layout'
import { EXTERNAL, ROLE } from './c4layout'
import type { Theme } from './theme'

const roleColor = (t: Theme, palette: string[], role: number, hue: number): string | undefined => {
  if (role === ROLE.box || role === ROLE.name) return hue === EXTERNAL ? t.codeComment : palette[hue % palette.length]
  if (role === ROLE.frame || role === ROLE.line) return t.diagram
  if (role === ROLE.arrow) return t.accent
  if (role === ROLE.number) return t.number
  if (role === ROLE.blank) return undefined
  if (role === ROLE.muted) return t.codeComment
  return t.diagramText
}

const rowColors = (t: Theme, palette: string[], roles: Uint8Array, hues: Int16Array): (string | undefined)[] => {
  const out: (string | undefined)[] = new Array(roles.length)
  for (let c = 0; c < roles.length; c++) out[c] = roleColor(t, palette, roles[c]!, hues[c]!)
  return out
}

export const c4Colors = (paint: C4Paint, t: Theme, palette: string[]): (string | undefined)[][] => paint.roles.map((row, r) => rowColors(t, palette, row, paint.hues[r]!))

type Cell = { text: string; color?: string; bold: boolean; scope: number; legend: boolean }

const sameRun = (a: Cell, b: Cell) => a.color === b.color && a.bold === b.bold && a.scope === b.scope && a.legend === b.legend

const runsOf = (row: string[], colors: (string | undefined)[], paint: C4Paint, r: number, legendFrom: number, scoped: boolean): Cell[] => {
  const runs: Cell[] = []
  row.forEach((ch, c) => {
    const role = paint.roles[r]?.[c] ?? ROLE.blank
    const cell: Cell = { text: ch, color: colors[c], bold: role === ROLE.name || role === ROLE.title, scope: scoped ? (paint.scopes[r]?.[c] ?? -1) : -1, legend: r >= legendFrom }
    const last = runs.at(-1)
    if (last && (sameRun(last, cell) || (ch === ' ' && (last.scope < 0 || last.legend)))) last.text += ch
    else if (last && last.scope < 0 && cell.scope < 0 && /^ +$/.test(last.text)) Object.assign(last, { ...cell, text: last.text + ch })
    else runs.push(cell)
  })
  return runs
}

const hoverOf = (t: Theme, run: Cell, scope: string) => (run.legend || /\d/.test(run.text) ? { scope, inverse: true } : { scope, color: t.emphasis ?? t.accent })

export const c4Element = ({ Box, Text }: ElementTable, t: Theme, grid: string[][], colors: (string | undefined)[][], paint: C4Paint, key: string, scopeKey?: string): RenderElement => {
  const legendFrom = paint.roles.findIndex((row, r) => r > 0 && row.length === 0)
  return (
    <Box key={key} flexDirection="column" paddingLeft={2}>
      {grid.map((row, r) => {
        const runs = runsOf(row, colors[r] ?? [], paint, r, legendFrom < 0 ? Infinity : legendFrom, scopeKey !== undefined)
        const texts = runs.map((run, i) => (
          <Text key={`${key}.${r}.${i}`} {...(run.color ? { color: run.color } : {})} {...(run.bold ? { bold: true } : {})} {...(run.scope >= 0 ? { hover: hoverOf(t, run, `c4:${scopeKey}:${run.scope}`) } : {})}>
            {run.text}
          </Text>
        ))
        if (!runs.some(run => run.scope >= 0)) return <Text key={`${key}.${r}`}>{texts.length ? texts : ' '}</Text>
        return <Box key={`${key}.${r}`} flexDirection="row">{texts}</Box>
      })}
    </Box>
  )
}
