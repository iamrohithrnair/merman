import type { ClientKeyEvent, ClientModule, ClientPointerEvent } from 'claude-code'

export const CONTINUED = '\uE000'

export type ViewerRun = [string, number]
export type ViewerProps = { rows: ViewerRun[][]; palette: string[]; width: number; view: number; bar: string[] }
type State = { x: number; grab?: [number, number] }
type Bar = { track: number; thumb: number; start: number; info: string }
type Go = (to: number, grab?: [number, number]) => void

const flat = new WeakMap<ViewerRun[][], ViewerRun[][]>()

const cellsOf = (rows: ViewerRun[][]): ViewerRun[][] => {
  const known = flat.get(rows)
  if (known) return known
  const made = rows.map(row => row.flatMap(([text, hue]) => Array.from(text, ch => [ch, hue] as ViewerRun)))
  flat.set(rows, made)
  return made
}

const shownAt = (cells: ViewerRun[], i: number, from: number, to: number): string => {
  const ch = cells[i]![0]
  if (ch === CONTINUED) return i === from ? ' ' : ''
  return cells[i + 1]?.[0] === CONTINUED && i + 1 >= to ? ' ' : ch
}

const windowOf = (cells: ViewerRun[], from: number, to: number): ViewerRun[] => {
  const runs: ViewerRun[] = []
  for (let i = from; i < Math.min(to, cells.length); i++) {
    const text = shownAt(cells, i, from, to)
    const hue = cells[i]![1]
    const last = runs[runs.length - 1]
    if (last && last[1] === hue) last[0] += text
    else runs.push([text, hue])
  }
  return runs
}

const barOf = (x: number, view: number, width: number): Bar => {
  const end = Math.min(width, x + view)
  const long = `  ${x + 1}–${end} of ${width} · drag, or click then ← →`
  const track = Math.max(6, Math.min(30, view - 4 - long.length))
  const thumb = Math.max(1, Math.round((view / width) * track))
  const start = Math.round((x / Math.max(1, width - view)) * (track - thumb))
  return { track, thumb, start, info: view - 4 - track >= long.length ? long : `  ${x + 1}–${end}/${width}` }
}

const keyed = (e: ClientKeyEvent, x: number, view: number, most: number, go: Go) => {
  const step = Math.max(4, Math.floor(view / 4))
  const moves: Record<string, number> = { left: x - step, right: x + step, h: x - step, l: x + step, home: 0, end: most, pageup: x - view, pagedown: x + view }
  const to = moves[e.key]
  if (to !== undefined) go(to)
}

const barTarget = (at: number, x: number, view: number, b: Bar, most: number): number => {
  const step = Math.max(4, Math.floor(view / 4))
  if (at < 2) return x - step
  if (at < 2 + b.track) return ((at - 2) / Math.max(1, b.track - 1)) * most
  return at < 4 + b.track ? x + step : x
}

const pointed = (e: ClientPointerEvent, state: State | undefined, x: number, view: number, b: Bar, most: number, go: Go) => {
  if (e.type === 'down' && e.y === 0) go(barTarget(e.x, x, view, b, most))
  else if (e.type === 'down') go(x, [e.x, x])
  else if (e.type === 'move' && state?.grab && e.button) go(state.grab[1] - (e.x - state.grab[0]), state.grab)
  else if (e.type === 'up' && state?.grab) go(x)
}

const Viewer: ClientModule<ViewerProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const view = Math.max(1, surface.columns || props.view)
  const most = Math.max(0, props.width - view)
  const x = Math.min(surface.state?.x ?? 0, most)
  const go: Go = (to, grab) => surface.setState({ x: Math.max(0, Math.min(most, Math.round(to))), grab })
  const b = barOf(x, view, props.width)
  surface.onKey(e => keyed(e, x, view, most, go))
  surface.onPointer(e => pointed(e, surface.state, x, view, b, most, go))
  const [accent, rule, dim] = props.bar.map(c => c || undefined)
  const hue = (i: number) => (i < 0 ? undefined : props.palette[i] || undefined)
  return (
    <Box flexDirection="column">
      <Text>
        <Text color={accent}>◀ </Text>
        <Text color={rule}>{'░'.repeat(b.start)}</Text>
        <Text color={accent}>{'█'.repeat(b.thumb)}</Text>
        <Text color={rule}>{'░'.repeat(b.track - b.thumb - b.start)}</Text>
        <Text color={accent}> ▶</Text>
        <Text color={dim}>{b.info}</Text>
      </Text>
      {cellsOf(props.rows).map((cells, r) => {
        const runs = windowOf(cells, x, x + view)
        return <Text key={`r${r}`}>{runs.length ? runs.map(([text, tone], i) => <Text key={`c${i}`} color={hue(tone)}>{text}</Text>) : ' '}</Text>
      })}
    </Box>
  )
}

export default Viewer
