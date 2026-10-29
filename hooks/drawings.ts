import type { RenderElement } from 'claude-code'

export type Drawing = { key: string; text: string; folds: Map<string, boolean>; element: RenderElement }

export const DRAWING_BUDGET = 1 << 17

const NODE_WEIGHT = 3

type Kept = Drawing & { weight: number }

const drawings = new Map<string, Kept>()
let weight = 0
let count = 0
const ids = new WeakMap<object, number>()

export const idOf = (thing: object): number => {
  const known = ids.get(thing)
  if (known !== undefined) return known
  ids.set(thing, ++count)
  return count
}

export const textOf = (value: unknown): string => JSON.stringify(value) ?? ''

export const reusedDrawing = (id: string, key: string, text: string, open: readonly string[]): RenderElement | undefined => {
  const d = drawings.get(id)
  if (!d || d.key !== key || d.text !== text) return undefined
  for (const [fold, was] of d.folds) if (open.includes(fold) !== was) return undefined
  drawings.delete(id)
  drawings.set(id, d)
  return d.element
}

export const unfoldedDrawing = (id: string, key: string, text: string): RenderElement | undefined =>
  drawings.get(id)?.folds.size === 0 ? reusedDrawing(id, key, text, []) : undefined

const fresh = <T extends RenderElement | undefined>(id: string, key: string, text: string, memo: boolean, draw: (folds: Map<string, boolean>) => T): RenderElement | T => {
  const folds = new Map<string, boolean>()
  const element = draw(folds)
  return memo && element ? keptDrawing(id, { key, text, folds, element }) : element
}

export const drawnOnce = async <T extends RenderElement | undefined>(id: string, key: () => string, text: string, memo: boolean, readOpen: () => Promise<string[]>, draw: (open: string[], folds: Map<string, boolean>) => T, prepare?: () => Promise<unknown>): Promise<RenderElement | T> => {
  const quick = memo ? unfoldedDrawing(id, key(), text) : undefined
  if (quick) return quick
  const open = await readOpen()
  const hit = memo ? reusedDrawing(id, key(), text, open) : undefined
  if (hit) return hit
  await prepare?.()
  return fresh(id, key(), text, memo, folds => draw(open, folds))
}

export const drawnPlain = async <T extends RenderElement | undefined>(id: string, key: () => string, text: string, draw: () => T, prepare?: () => Promise<unknown>): Promise<RenderElement | T> => {
  const hit = unfoldedDrawing(id, key(), text)
  if (hit) return hit
  await prepare?.()
  return fresh(id, key(), text, true, draw)
}

export const memoized = <T extends RenderElement | undefined>(id: string, key: string, text: string, open: readonly string[], memo: boolean, draw: (folds: Map<string, boolean>) => T): RenderElement | T =>
  (memo ? reusedDrawing(id, key, text, open) : undefined) ?? fresh(id, key, text, memo, draw)

export const nodeCount = (node: unknown): number => {
  if (typeof node === 'string' || typeof node === 'number') return 1
  if (node === null || typeof node !== 'object') return 0
  if (!Array.isArray(node)) return 1 + nodeCount((node as { children?: unknown }).children)
  let n = 0
  for (let i = 0; i < node.length; i++) n += nodeCount(node[i])
  return n
}

export const keptDrawing = (id: string, d: Drawing, budget = DRAWING_BUDGET): RenderElement => {
  const old = drawings.get(id)
  if (old) weight -= old.weight
  drawings.delete(id)
  const kept: Kept = { ...d, weight: Math.max(d.text.length, nodeCount(d.element) * NODE_WEIGHT) }
  drawings.set(id, kept)
  weight += kept.weight
  for (const [key, entry] of drawings) {
    if (weight <= budget || drawings.size <= 1) break
    drawings.delete(key)
    weight -= entry.weight
  }
  return d.element
}
