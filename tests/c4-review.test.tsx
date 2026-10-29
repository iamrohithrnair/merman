import { expect, test } from 'claude-code/testing'

import { c4Model, plantUmlC4 } from '../hooks/c4'
import type { C4Picture, C4Pictures } from '../hooks/c4layout'
import { ROLE, c4Grid, c4Layout, c4Width } from '../hooks/c4layout'
import { parse } from '../hooks/markdown'
import { drawDiagrams, mermaidText } from '../hooks/mermaid'
import { cells, width } from '../hooks/render'
import { resolveStyle } from '../hooks/theme'

const mount = (text: string, columns = 120) => ({
  plugin: 'merman',
  component: 'AssistantMessage' as const,
  props: { text, isFirstOfReply: true },
  viewport: { columns, rows: 40 },
  surface: 'terminal' as const,
})

const fence = (source: string) => '```mermaid\n' + source + '\n```'

const art = (source: string, columns = 120) => mermaidText(source, false, columns) ?? ''

const picture = (drawn: string) => drawn.split('\n\n')[0]!

const legend = (drawn: string) => drawn.split('\n\n')[1] ?? ''

const DOWN = /[│┐┌┬┤├┼]/
const UP = /[│└┘┴├┤┼]/
const RIGHT = /[─┌└├┬┴┼]/
const LEFT = /[─┐┘┤┬┴┼]/

const arrowsOnLines = (drawn: string): string[] => {
  const rows = picture(drawn).split('\n').map(row => [...row])
  const at = (r: number, c: number) => rows[r]?.[c] ?? ' '
  return rows.flatMap((row, r) =>
    row.flatMap((ch, c) => {
      const across = /[►◄]/.test(ch) ? DOWN.test(at(r - 1, c)) && UP.test(at(r + 1, c)) : /[▲▼]/.test(ch) ? RIGHT.test(at(r, c - 1)) && LEFT.test(at(r, c + 1)) : false
      return across ? [`${r}:${c} ${ch}`] : []
    }),
  )
}

test('two relationships in opposite directions between stacked C4 boxes never read as one number', () => {
  const drawn = art('C4Context\n  System(a, "Customer")\n  System(b, "Web App")\n  Rel(a, b, "Orders")\n  Rel(b, a, "Confirms")', 40)
  expect(legend(drawn)).toContain('2  Web App → Customer  Confirms')
  expect(picture(drawn)).not.toMatch(/\d\d/)
})

test('a C4 arrowhead never lands on the line of another relationship', () => {
  const drawn = art('C4Context\n  System(e0, "Customer")\n  System(e1, "Web App")\n  System(e2, "API")\n  System(e3, "Database")\n  Rel(e2, e1, "r0")\n  Rel(e3, e0, "r1")', 80)
  expect(arrowsOnLines(drawn)).toEqual([])
})

test('a C4 line never loops through its own arrowhead to arrive straight', () => {
  const source = [
    'C4Container',
    '  System(e0, "Customer")',
    '  Container(e1, "Web App", "Go")',
    '  Container(e2, "API", "Go", "does a thing for users")',
    '  Person(e3, "Database", "does a thing for users")',
    '  System(e4, "Mail", "does a thing for users")',
    '  Person(e5, "Billing", "does a thing for users")',
    ...['e2, e5', 'e1, e3', 'e2, e3', 'e2, e0', 'e3, e5', 'e3, e1', 'e3, e5', 'e1, e4'].map((pair, i) => `  Rel(${pair}, "r${i}")`),
  ].join('\n')
  expect(arrowsOnLines(art(source, 100))).toEqual([])
})

test('every C4 relationship drawn as a line carries its number', () => {
  const drawn = art('C4Container\n  System(e0, "Customer", "does a thing for users")\n  System(e1, "Web App", "Go")\n  Person(e2, "API")\n  ContainerDb(e3, "Database")\n  ContainerDb(e4, "Mail")\n  Rel(e4, e0, "r0")\n  Rel(e1, e4, "r1")\n  Rel(e1, e3, "r2")', 80)
  expect(legend(drawn)).toContain('1  Mail → Customer  r0')
  for (const n of ['1', '2', '3']) expect(picture(drawn)).toContain(n)
})

const NAMES = ['Customer', 'Web App', 'API', 'Database', 'Mail', 'Billing', 'Auth']
const KINDS = ['Person', 'System', 'System_Ext', 'Container', 'ContainerDb']

const randomC4 = (next: () => number) => {
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1))
  const n = int(3, 7)
  const lines = ['C4Container', ...NAMES.slice(0, n).map((name, i) => `  ${KINDS[int(0, 4)]}(e${i}, "${name}"${next() < 0.5 ? ', "Go"' : ''}${next() < 0.5 ? ', "does a thing for users"' : ''})`)]
  for (let j = int(2, 8); j > 0; j--) {
    const a = int(0, n - 1)
    lines.push(`  Rel(e${a}, e${(a + int(1, n - 1)) % n}, "r${j}")`)
  }
  return lines.join('\n')
}

const flaws = (source: string, columns: number) => {
  const { text, paint } = c4Layout(c4Model(source)!, columns, false)!
  const end = paint.roles.findIndex((row, r) => r > 0 && row.length === 0)
  const lines = new Set<number>()
  const numbers = new Set<number>()
  const merged: string[] = []
  paint.roles.slice(0, end).forEach((row, r) =>
    row.forEach((role, c) => {
      const scope = paint.scopes[r]![c]!
      if (role === ROLE.line || role === ROLE.arrow) lines.add(scope)
      if (role !== ROLE.number) return
      numbers.add(scope)
      if (row[c + 1] === ROLE.number && paint.scopes[r]![c + 1] !== scope) merged.push(`${r}:${c}`)
    }),
  )
  return { unnumbered: [...lines].filter(s => !numbers.has(s)), merged, arrows: arrowsOnLines(text) }
}

test('random small C4 diagrams give every line its own legible number and keep arrowheads off other lines', () => {
  let seed = 4242
  const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  for (let k = 0; k < 150; k++) {
    const source = randomC4(next)
    for (const columns of [80, 120]) expect({ source, columns, ...flaws(source, columns) }).toEqual({ source, columns, unnumbered: [], merged: [], arrows: [] })
  }
})

const framedC4 = (next: () => number) => {
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1))
  const lines = ['C4Container']
  let open = 0
  for (let i = 0; i < 9; i++) {
    if (next() < 0.3 && open < 3) {
      lines.push(`  System_Boundary(b${i}, "Group ${i}") {`)
      open++
    }
    lines.push(`  Container(e${i}, "${NAMES[i % NAMES.length]} ${i}", "Go"${next() < 0.5 ? ', "does a thing for users"' : ''})`)
    if (next() < 0.3 && open > 0) {
      lines.push('  }')
      open--
    }
  }
  lines.push(...Array<string>(open).fill('  }'))
  for (let j = int(4, 9); j > 0; j--) {
    const a = int(0, 8)
    lines.push(`  Rel(e${a}, e${(a + int(1, 8)) % 9}, "r${j}")`)
  }
  return lines.join('\n')
}

const frameFlaws = (source: string, columns: number) => {
  const { text, paint } = c4Layout(c4Model(source)!, columns, false)!
  const rows = text.split('\n').map(row => [...row])
  const roles = paint.roles
  const at = (x: number, y: number) => roles[y]?.[x]
  const along = (x: number, y: number, vertical: boolean) => at(x, y) === ROLE.line && (vertical ? at(x - 1, y) === ROLE.frame || at(x + 1, y) === ROLE.frame : at(x, y - 1) === ROLE.frame || at(x, y + 1) === ROLE.frame)
  const hugging: string[] = []
  const corners: string[] = []
  for (let y = 0; y < roles.findIndex((row, r) => r > 0 && row.length === 0); y++) {
    for (let x = 0; x < roles[y]!.length; x++) {
      if ((along(x, y, true) && along(x, y + 1, true)) || (along(x, y, false) && along(x + 1, y, false))) hugging.push(`${y}:${x}`)
      const ch = rows[y]?.[x] ?? ''
      if (at(x, y) !== ROLE.frame || !/[┌┐└┘]/.test(ch)) continue
      if (at(x + (/[┌└]/.test(ch) ? 1 : -1), y) !== ROLE.frame || at(x, y + (/[┌┐]/.test(ch) ? 1 : -1)) !== ROLE.frame) corners.push(`${y}:${x}`)
    }
  }
  return { hugging, corners }
}

test('C4 lines keep out of the one-cell gaps between nested frame borders', () => {
  const source = 'C4Context\n  Enterprise_Boundary(b0, "Bank") {\n    Person(cust, "Customer")\n    System(core, "Core Banking")\n    Enterprise_Boundary(b1, "Back office") {\n      System(ledger, "Ledger")\n      System(archive, "Archive")\n      System(mail, "E-mail")\n    }\n  }\n  Rel(mail, cust, "Emails")\n  Rel(core, ledger, "Posts")\n  Rel(core, archive, "Stores")'
  expect(frameFlaws(source, 80).hugging).toEqual([])
})

test('random framed C4 diagrams never cross a frame border at or next to its corner', () => {
  let seed = 77
  const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  for (let k = 0; k < 60; k++) {
    const source = framedC4(next)
    for (const columns of [80, 120]) expect({ source, columns, corners: frameFlaws(source, columns).corners }).toEqual({ source, columns, corners: [] })
  }
})

test('C4 boundaries nested a hundred and fifty deep give up quickly instead of freezing the render', () => {
  const source = 'C4Context\nSystem(o,"Outside")\n' + 'Boundary(b,""){'.repeat(150) + 'System(x,"X")' + '}'.repeat(150) + '\nRel(o,x,"in")\nRel(x,o,"out")'
  expect(source.length).toBeLessThan(8000)
  expect(source.split('\n').length).toBeLessThan(80)
  const started = performance.now()
  mermaidText(source, false, 200)
  expect(performance.now() - started).toBeLessThan(150)
})

const nest = (levels: number) => `C4Context\n${'Boundary(b, "") {'.repeat(levels)} System(x, "X") ${'}'.repeat(levels)}`

test('C4 boundaries nested sixteen deep still draw, and a seventeenth level leaves the block as source', () => {
  expect(c4Model(nest(16))).not.toBeNull()
  expect(c4Model(nest(17))).toBeNull()
})

test('a C4 diagram too big to lay out leaves the block as source without building its canvas', () => {
  const source = `C4Context\n${Array.from({ length: 28 }, (_, i) => `${'Boundary(b,""){'.repeat(16)}System(x${i},"X")${'}'.repeat(16)}`).join('\n')}\nRel(x0,x1,"a")`
  expect(source.length).toBeLessThan(8000)
  const started = performance.now()
  expect(mermaidText(source, false, 200)).toBeNull()
  expect(performance.now() - started).toBeLessThan(150)
})

test('a C4 diagram whose routes would take seconds stops at the router work limit and lists the rest in the legend', () => {
  const sources = Array.from({ length: 40 }, (_, i) => `Container(s${i}, "S${i}", "${'x'.repeat(90)}")`)
  const rels = Array.from({ length: 40 }, (_, i) => `Boundary(z${i},""){ Rel(s${i},t) } Boundary(y${i},""){ BiRel(s${i},t) }`).join(' ')
  const source = ['C4Container', 'Container(t, "T")', ...sources, rels].join('\n')
  expect(source.length).toBeLessThan(8000)
  const started = performance.now()
  const drawn = c4Layout(c4Model(source)!, 200, false)
  expect(performance.now() - started).toBeLessThan(2000)
  expect(drawn!.paint.roles.some(row => row.includes(ROLE.muted))).toBe(true)
})

test('a C4 diagram whose boxes are wider than the terminal skips routing and lists its relationships in the legend', () => {
  const drawn = art(`C4Container\n  Container(a, "Alpha", "${'t'.repeat(90)}")\n  System(b, "Beta")\n  Rel(a, b, "Calls")`, 80)
  expect(drawn).not.toMatch(/[►◄▼▲]/)
  expect(drawn).toContain(' 1  Alpha → Beta  Calls')
})

const hebrewTexts = async (ui: { findAll: (q: { type: 'Text' }) => Promise<{ text: string }[]> }) => (await ui.findAll({ type: 'Text' })).map(t => t.text).filter(t => /[א-ת]/.test(t))

test('C4 boxes send Hebrew to a visual-order terminal the way flowchart boxes do', { options: { rtl: 'warp' } }, async $ => {
  const flow = await $.ui.mount(mount(fence('flowchart LR\n  A[שלום עולם] --> B[next]')))
  const flowRows = await hebrewTexts(flow)
  await flow.unmount()
  const c4 = await $.ui.mount(mount(fence('C4Context\n  System(a, "שלום עולם")\n  System(b, "next")\n  Rel(a, b, "x")')))
  const c4Rows = await hebrewTexts(c4)
  await c4.unmount()
  expect(flowRows.some(t => t.includes('םלוע םולש'))).toBe(true)
  expect(c4Rows.some(t => t.includes('םלוע םולש'))).toBe(true)
})

test('C4 boxes with no right-to-left text keep their hover groups on a visual-order terminal', { options: { rtl: 'warp' } }, async $ => {
  const ui = await $.ui.mount({ ...mount(fence('C4Context\n  System(a, "Alpha")\n  System(b, "Beta")\n  Rel(a, b, "Calls")')), requestId: 'r1' })
  expect(scopesOf(await ui.drawn()).some(s => s.startsWith('c4:'))).toBe(true)
  await ui.unmount()
})

test('a PlantUML class diagram with an untyped two-argument constructor stays a plain code block with no note', async $ => {
  const ui = await $.ui.mount(mount('```plantuml\n@startuml\nclass Person {\n  Person(name, age)\n  getName()\n}\n@enduml\n```'))
  expect(await ui.find({ type: 'Text', text: /^── plantuml$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /failed to render|draw as source|cols, terminal/ })).toBeUndefined()
  await ui.unmount()
})

test('C4-PlantUML with no include is still found by an element with a quoted label', () => {
  expect(plantUmlC4('@startuml\nPerson(u, "User")\nSystem(s, "Shop")\nRel(u, s, "Buys")\n@enduml')).toBeDefined()
  expect(plantUmlC4('@startuml\nclass Person {\n  Person(name, age)\n}\n@enduml')).toBeUndefined()
})

type El = { hover?: { scope?: string }; children?: unknown[] }

const scopesOf = (node: unknown): string[] => {
  if (!node || typeof node !== 'object') return []
  const n = node as El
  return [...(n.hover?.scope ? [n.hover.scope] : []), ...(n.children ?? []).flatMap(scopesOf)]
}

test('two C4 drawings made without a reply id do not share hover groups', async ($, on) => {
  const blocks = parse(fence('C4Context\n  System(a, "Alpha")\n  System(b, "Beta")\n  Rel(a, b, "Calls")'), { numbers: true, paths: true })
  const drawings: string[][] = []
  on('ui.render', ($, e) => {
    const el = $.ui.resolve(e)
    for (let k = 0; k < 2; k++) drawings.push(scopesOf(drawDiagrams(el, resolveStyle({}), blocks, 120).get(0)?.element))
    return <el.Text>engine</el.Text>
  })
  const ui = await $.ui.mount(mount(''))
  await ui.unmount()
  expect(drawings[0]!.some(s => drawings[1]!.includes(s))).toBe(false)
})

const atCap = (seed: number, frames = 4, per = 7, rels = 40) => {
  let at = seed
  const next = () => (at = (at * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  const n = frames * per + 2
  const lines = ['C4Container']
  for (let f = 0; f < frames; f++) {
    lines.push(`  System_Boundary(b${f}, "Group ${f}") {`)
    for (let i = f * per; i < f * per + per; i++) lines.push(`    Container(e${i}, "Orders ${i}", "Go", "Takes orders from the web shop")`)
    lines.push('  }')
  }
  lines.push(`  Person(e${n - 2}, "Customer ${n - 2}", "Buys bread online")`, `  Person(e${n - 1}, "Customer ${n - 1}", "Buys cakes online")`)
  for (let j = 0; j < rels; j++) {
    const a = Math.floor(next() * n)
    lines.push(`  Rel(e${a}, e${(a + 1 + Math.floor(next() * (n - 1))) % n}, "Calls ${j}", "HTTPS")`)
  }
  return lines.join('\n')
}

const nodes = (n: unknown): number => (typeof n === 'string' ? 1 : !n || typeof n !== 'object' ? 0 : Array.isArray(n) ? n.reduce((sum: number, c) => sum + nodes(c), 0) : 1 + nodes((n as El).children))

test('a reply with four large C4 diagrams draws them without hover groups to stay under the node limit', async $ => {
  const one = await $.ui.mount({ ...mount(fence(atCap(7))), requestId: 'one' })
  expect(scopesOf(await one.drawn()).some(s => s.startsWith('c4:'))).toBe(true)
  await one.unmount()
  const ui = await $.ui.mount({ ...mount([7, 8, 9, 10].map(seed => fence(atCap(seed))).join('\n\nSome words.\n\n')), requestId: 'four' })
  const tree = await ui.drawn()
  expect(nodes(tree)).toBeLessThan(18000)
  expect(scopesOf(tree).some(s => s.startsWith('c4:'))).toBe(false)
  expect((await ui.findAll({ type: 'Text', text: /Orders 27/ })).length).toBeGreaterThan(0)
  await ui.unmount()
})

test('a reply that grows past the node limit and shrinks back draws its C4 hover groups only while it fits', async $ => {
  const hovered = async (text: string) => {
    const ui = await $.ui.mount({ ...mount(text), requestId: 'grows' })
    const scopes = scopesOf(await ui.drawn()).filter(s => s.startsWith('c4:'))
    await ui.unmount()
    return scopes.length > 0
  }
  const one = fence(atCap(7))
  const four = [7, 8, 9, 10].map(seed => fence(atCap(seed))).join('\n\nSome words.\n\n')
  expect([await hovered(one), await hovered(four), await hovered(one)]).toEqual([true, false, true])
})

const colorsOf = (node: unknown, text: RegExp): string[] => {
  if (!node || typeof node !== 'object') return []
  const n = node as El & { props?: { color?: string } }
  const own = n.props?.color !== undefined && (n.children ?? []).some(c => typeof c === 'string' && text.test(c)) ? [n.props.color] : []
  return [...own, ...(n.children ?? []).flatMap(c => colorsOf(c, text))]
}

test('a C4 diagram redrawn with nothing changed reuses its tree, and draws a fresh one for another theme, width or hover group', async ($, on) => {
  const blocks = parse(fence(atCap(5, 2, 4, 12)), { numbers: true, paths: true })
  const styles = { dracula: resolveStyle({ theme: 'dracula' }), nord: resolveStyle({ theme: 'nord' }) }
  let seen: Record<string, boolean> | undefined
  on('ui.render', ($, e) => {
    const el = $.ui.resolve(e)
    const draw = (theme: keyof typeof styles, columns: number, noteKey: string) => drawDiagrams(el, { ...styles[theme], noteKey }, blocks, columns).get(0)!
    if (!seen) {
      const first = draw('dracula', 120, 'r1')
      const again = draw('dracula', 120, 'r1')
      const nord = draw('nord', 120, 'r1').element
      const other = draw('dracula', 120, 'r2').element
      seen = {
        reused: again.element === first.element && again.lean!() === first.lean!(),
        hovered: scopesOf(first.element).some(s => s.startsWith('c4:r1:')),
        lean: first.lean!() !== first.element && !scopesOf(first.lean!()).some(s => s.startsWith('c4:')),
        theme: nord !== first.element && colorsOf(nord, /►/).every(c => c === styles.nord.theme.accent) && colorsOf(nord, /►/).length > 0,
        width: draw('dracula', 119, 'r1').element !== first.element,
        scope: other !== first.element && scopesOf(other).some(s => s.startsWith('c4:r2:')) && !scopesOf(other).some(s => s.startsWith('c4:r1:')),
        back: draw('dracula', 120, 'r1').element === first.element,
      }
    }
    return <el.Text>engine</el.Text>
  })
  const ui = await $.ui.mount(mount(''))
  await ui.unmount()
  expect(seen).toEqual({ reused: true, hovered: true, lean: true, theme: true, width: true, scope: true, back: true })
})

const tooWide = (seed: number) => fence(['C4Container', ...Array.from({ length: 30 }, (_, i) => `  Container(e${i}, "S${i} ${seed}", "${'t'.repeat(100)}")`)].join('\n'))

test('large C4 drawings take more room in the diagram cache than small ones', async ($, on) => {
  const seen: unknown[] = []
  on('ui.render', ($, e) => {
    const el = $.ui.resolve(e)
    const full = (seed: number) => drawDiagrams(el, resolveStyle({}), parse(tooWide(seed), { numbers: true, paths: true }), 80).get(0)?.full
    if (!seen.length) {
      seen.push(full(0))
      for (let seed = 1; seed <= 8; seed++) full(seed)
      seen.push(full(0))
    }
    return <el.Text>engine</el.Text>
  })
  const ui = await $.ui.mount(mount(''))
  await ui.unmount()
  expect(seen[0] !== undefined && seen[1] !== seen[0]).toBe(true)
})

test('a theme with another number of colors repaints a C4 drawing without laying it out again', async ($, on) => {
  const seen: unknown[] = []
  on('ui.render', ($, e) => {
    const el = $.ui.resolve(e)
    if (!seen.length) for (const theme of ['dracula', 'mono']) seen.push(drawDiagrams(el, resolveStyle({ theme }), parse(tooWide(99), { numbers: true, paths: true }), 80).get(0)?.full)
    return <el.Text>engine</el.Text>
  })
  const ui = await $.ui.mount(mount(''))
  await ui.unmount()
  expect(seen[0] !== undefined && seen[1] === seen[0]).toBe(true)
})

const keeping = () => {
  const kept = new Map<string, C4Picture | null>()
  const memo = { routed: 0, pictures: ((key, make) => {
    if (!kept.has(key)) {
      memo.routed++
      kept.set(key, make())
    }
    return kept.get(key)!
  }) as C4Pictures }
  return memo
}

test('a C4 diagram resized across widths that pack its boxes the same way routes once per packing and draws as if laid out afresh', () => {
  const model = c4Model(atCap(3, 2, 4, 12))!
  const memo = keeping()
  const widths = Array.from({ length: 61 }, (_, i) => 160 - i)
  for (const columns of widths) expect(c4Layout(model, columns, false, memo.pictures)).toEqual(c4Layout(model, columns, false))
  expect(memo.routed).toBeGreaterThan(1)
  expect(memo.routed).toBeLessThan(widths.length / 4)
})

const drawnOf = (art: ReturnType<typeof c4Layout>) => JSON.stringify(art && [art.text, ...[art.paint.roles, art.paint.hues, art.paint.scopes].map(rows => rows.map(row => [...row])), art.paint.parts.map(part => part.lines)])

test('random C4 diagrams share pictures across widths and ASCII modes without drawing anything differently', { timeoutMs: 20000 }, () => {
  let seed = 913
  const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  for (let k = 0; k < 10; k++) {
    const source = k % 2 ? framedC4(next) : randomC4(next)
    const memo = keeping()
    for (const ascii of [false, true])
      for (const columns of [140, 120, 100, 90, 80, 70, 60, 50, 40]) {
        const fresh = c4Layout(c4Model(source)!, columns, ascii)!
        const lines = fresh.text.split('\n')
        const shared = c4Layout(c4Model(source)!, columns, ascii, memo.pictures)!
        const same = drawnOf(shared) === drawnOf(fresh) && JSON.stringify(c4Grid(shared.paint)) === JSON.stringify(c4Grid(fresh.paint)) && c4Width(shared.paint) === c4Width(fresh.paint)
        const measured = JSON.stringify(c4Grid(fresh.paint)) === JSON.stringify(lines.map(cells)) && c4Width(fresh.paint) === Math.max(...lines.map(width))
        expect({ source, columns, ascii, same, measured }).toEqual({ source, columns, ascii, same: true, measured: true })
      }
  }
})

test('C4 pictures shared between widths are weighed by size, so big drawings push out old ones', async ($, on) => {
  const shared: boolean[] = []
  on('ui.render', ($, e) => {
    const el = $.ui.resolve(e)
    const firstRow = (seed: number, columns: number) => drawDiagrams(el, resolveStyle({}), parse(tooWide(seed), { numbers: true, paths: true }), columns).get(0)?.full?.c4?.roles[0]
    if (!shared.length) {
      const first = firstRow(500, 80)
      shared.push(first !== undefined && firstRow(500, 81) === first)
      for (let seed = 501; seed <= 520; seed++) firstRow(seed, 80)
      shared.push(firstRow(500, 82) === first)
    }
    return <el.Text>engine</el.Text>
  })
  const ui = await $.ui.mount(mount(''))
  await ui.unmount()
  expect(shared).toEqual([true, false])
})

test('a long C4 title wraps and a long frame label ends in an ellipsis to fit the terminal', () => {
  const title = 'Deployment of the internet banking platform across every data center the bank runs today'
  const drawn = art(`C4Deployment\n  title ${title}\n  Deployment_Node(n, "Customer's computer", "${'Microsoft Windows or Apple macOS '.repeat(3)}") {\n    Container(a, "Browser")\n  }`, 80)
  expect(Math.max(...drawn.split('\n').map(width))).toBeLessThanOrEqual(78)
  expect(drawn.split('\n').slice(0, 2).join(' ')).toBe(title)
  expect(drawn).toContain("Customer's computer [Microsoft Windows")
  expect(drawn).toMatch(/…\s*│/)
})

test('C4 names and descriptions in Chinese break between characters to keep their box narrow', () => {
  const drawn = art('C4Context\n  System(s, "订单系统和支付系统和退款系统和发票系统", "处理订单和支付，以及很多其他的事情和更多的事情")', 120)
  expect(Math.max(...drawn.split('\n').map(width))).toBeLessThanOrEqual(32)
  expect(drawn).toContain('的事情和更多的事情')
})

test('C4 box rows keep the width of their border with a zero-width space in a label', () => {
  expect(new Set(art('C4Context\n  Person(a, "Al\u200bice")').split('\n').map(width)).size).toBe(1)
})

test('C4 draws no tab from a technology or boundary label', () => {
  expect(art('C4Container\n  Container(a, "API", "Go\tgRPC")')).not.toContain('\t')
  expect(art('C4Context\n  System_Boundary(b, "Big\tBank") {\n    System(a, "Alpha")\n  }')).not.toContain('\t')
})

test('a mermaid comment on the C4 kind line still draws', () => {
  expect(art('C4Context %% the shop\n  System(a, "Alpha")')).toContain('Alpha')
})

test('a C4 title with braces still draws', () => {
  expect(art('C4Context\n  title Shop {v2}\n  System(a, "Alpha")')).toContain('Alpha')
})

test('C4-PlantUML with a together group still draws', () => {
  const source = plantUmlC4('@startuml\n!include <C4/C4_Container>\nPerson(u, "User")\ntogether {\n  System(a, "Alpha")\n  System(b, "Beta")\n}\nRel(u, a, "Uses")\n@enduml')
  expect(source).toBeDefined()
  expect(c4Model(source!)).not.toBeNull()
})

test('C4-PlantUML package groups draw the elements inside them', () => {
  const source = plantUmlC4('@startuml\n!include <C4/C4_Container>\nPerson(u, "User")\npackage "Shop" {\n  System(a, "Alpha")\n}\nRel(u, a, "Uses")\n@enduml')
  expect(legend(art(source!))).toContain('User → Alpha  Uses')
})

test('the C4-PlantUML \\n idiom breaks a name or description onto a line of its own', () => {
  const rows = art('C4Context\n  System(a, "Internet\\nBanking", "Holds the\\naccounts")').split('\n')
  for (const line of ['Internet', 'Banking', 'Holds the', 'accounts']) expect(rows.some(row => new RegExp(`^│ +${line} +│$`).test(row))).toBe(true)
  const flat = art('C4Container\n  Container(a, "API", "Go\\ngRPC")\n  System_Boundary(b, "Big\\nBank") {\n    System(c, "Alpha")\n  }')
  expect(flat).toContain('[Container: Go gRPC]')
  expect(flat).toContain('Big Bank')
})

test('a C4 alias defined twice draws once, with its last label, inside the boundary of its last definition', () => {
  const drawn = art('C4Context\n  System(a, "First")\n  System_Boundary(b, "Bank") {\n    System(a, "Second")\n  }\n  System(c, "Other")\n  Rel(c, a, "Calls")')
  expect(drawn).not.toContain('First')
  expect(legend(drawn)).toContain('Other → Second  Calls')
  const rows = drawn.split('\n')
  const bank = rows.findIndex(row => row.includes('Bank'))
  const second = rows.findIndex(row => row.includes('Second'))
  expect(second).toBeGreaterThan(bank)
  expect(rows[second]!.indexOf('│')).toBeLessThan(rows[second]!.indexOf('Second') - rows[bank]!.indexOf('│') - 1)
})

test('C4 labels with a pipe keep their text when the first layout is too wide', async ($, on) => {
  const blocks = parse(fence(`C4Container\n  Container(a, "A | B", "${'t'.repeat(90)}", "C | D")`), { numbers: true, paths: true })
  let drawn: string | undefined
  on('ui.render', ($, e) => {
    const el = $.ui.resolve(e)
    drawn = drawDiagrams(el, resolveStyle({}), blocks, 80).get(0)?.art
    return <el.Text>engine</el.Text>
  })
  const ui = await $.ui.mount(mount(''))
  await ui.unmount()
  expect(drawn === undefined || (drawn.includes('A | B') && drawn.includes('C | D'))).toBe(true)
})
