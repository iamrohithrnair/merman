import type { RenderNode } from 'claude-code'

export type Look = Readonly<{
  color?: string
  backgroundColor?: string
  bold?: true
  italic?: true
  underline?: true
  strikethrough?: true
  dimColor?: true
  inverse?: true
}>

export type LookProps = {
  color?: string
  backgroundColor?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  dimColor?: boolean
  inverse?: boolean
}

export type Run = { text: string; look: Look }

type TextTag = (props: never) => RenderNode | null | undefined

const FLAGS = ['bold', 'italic', 'underline', 'strikethrough', 'dimColor', 'inverse'] as const

export const PLAIN: Look = Object.freeze({})

const MAX_LOOKS = 4000
const looks = new Map<string, Look[]>()

const made = (props: LookProps): Look => {
  const look: Record<string, string | true> = {}
  if (props.color) look.color = props.color
  if (props.backgroundColor) look.backgroundColor = props.backgroundColor
  for (const flag of FLAGS) if (props[flag]) look[flag] = true
  return Object.keys(look).length ? (Object.freeze(look) as Look) : PLAIN
}

export const lookOf = (props: LookProps): Look => {
  const flags = (props.bold ? 1 : 0) | (props.italic ? 2 : 0) | (props.underline ? 4 : 0) | (props.strikethrough ? 8 : 0) | (props.dimColor ? 16 : 0) | (props.inverse ? 32 : 0)
  const key = props.backgroundColor ? `${props.color ?? ''}\0${props.backgroundColor}` : (props.color ?? '')
  let row = looks.get(key)
  if (!row) {
    if (looks.size >= MAX_LOOKS) looks.clear()
    looks.set(key, (row = []))
  }
  return (row[flags] ??= made(props))
}

const overs = new WeakMap<Look, WeakMap<Look, Look>>()

export const over = (parent: Look, child: Look): Look => {
  if (child === PLAIN || child === parent) return parent
  if (parent === PLAIN) return child
  const row = overs.get(parent) ?? new WeakMap<Look, Look>()
  overs.set(parent, row)
  const hit = row.get(child)
  if (hit) return hit
  const look = lookOf({
    color: child.color ?? parent.color,
    backgroundColor: child.backgroundColor ?? parent.backgroundColor,
    bold: parent.bold || child.bold,
    italic: parent.italic || child.italic,
    underline: parent.underline || child.underline,
    strikethrough: parent.strikethrough || child.strikethrough,
    dimColor: parent.dimColor || child.dimColor,
    inverse: parent.inverse || child.inverse,
  })
  row.set(child, look)
  return look
}

export const within = (parent: Look, child: Look): Look => (over(parent, child) === parent ? PLAIN : child)

const lined = (look: Look): boolean => Boolean(look.underline || look.strikethrough || look.inverse)

const blankAlike = (parent: Look, a: Look, b: Look): boolean => {
  const x = parent === PLAIN ? a : over(parent, a)
  const y = parent === PLAIN ? b : over(parent, b)
  return x === y || (!lined(x) && !lined(y) && x.backgroundColor === y.backgroundColor)
}

export const isBlank = (text: string): boolean => /^\s+$/.test(text)

const takesBlank = (parent: Look, last: Run, run: Run, next: Run | undefined): boolean => next?.look !== run.look && blankAlike(parent, run.look, last.look)

const joined = (parent: Look, last: Run, run: Run, next: Run | undefined): boolean => {
  if (last.look !== run.look && isBlank(run.text)) {
    if (!takesBlank(parent, last, run, next)) return false
  } else if (last.look !== run.look) {
    if (!isBlank(last.text) || !blankAlike(parent, last.look, run.look)) return false
    last.look = run.look
  }
  last.text += run.text
  return true
}

export const joinRuns = (runs: Run[], parent: Look = PLAIN): Run[] => {
  if (runs.length === 1 && runs[0]!.text) return runs
  const out: Run[] = []
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!
    const last = out[out.length - 1]
    if (run.text && !(last && joined(parent, last, run, runs[i + 1]))) out.push(run)
  }
  return out
}

export const drawRun = (Text: TextTag, run: Run): RenderNode => (run.look === PLAIN ? run.text : (h(Text, run.look, run.text) as RenderNode))

export const drawRuns = (Text: TextTag, runs: readonly Run[]): RenderNode[] => runs.map(run => drawRun(Text, run))
