import { expect, test } from 'claude-code/testing'

import { c4Model } from '../hooks/c4'
import { mermaidText } from '../hooks/mermaid'
import { PRESETS } from '../hooks/presets'
import { width } from '../hooks/render'
import { paintOf } from './paint'

const SURFACES = ['terminal', 'desktop'] as const

const mount = (text: string, columns = 200, surface: (typeof SURFACES)[number] = 'terminal') => ({
  plugin: 'merman',
  component: 'AssistantMessage' as const,
  props: { text, isFirstOfReply: true },
  viewport: { columns, rows: 40 },
  surface,
})

const fence = (source: string) => '```mermaid\n' + source + '\n```'

const BANK = `C4Container
  title Internet banking
  Person(customer, "Customer", "A customer of the bank")
  System_Boundary(bank, "Internet Banking") {
    Container(web, "Web App", "React", "Delivers the single page app")
    ContainerDb(db, "Database", "Postgres")
  }
  System_Ext(mail, "E-mail System", "Sends e-mail")
  Rel(customer, web, "Uses", "HTTPS")
  Rel(web, db, "Reads/writes")
  Rel(web, mail, "Sends e-mail")`

const art = (source: string, columns = 120) => mermaidText(source, false, columns) ?? ''

const picture = (drawn: string) => drawn.split('\n\n')[0]!

const legend = (drawn: string) => drawn.split('\n\n')[1] ?? ''

const widest = (drawn: string) => Math.max(...drawn.split('\n').map(width))

type Node = { type?: string; hover?: { scope?: string }; children?: unknown[] }

const scoped = (node: unknown, out: Map<string, string[]> = new Map()): Map<string, string[]> => {
  if (!node || typeof node !== 'object') return out
  const n = node as Node
  const scope = n.hover?.scope
  if (scope?.startsWith('c4:')) out.set(scope, [...(out.get(scope) ?? []), (n.children ?? []).filter(c => typeof c === 'string').join('')])
  for (const child of n.children ?? []) scoped(child, out)
  return out
}

for (const surface of SURFACES) {
  test(`every C4 diagram kind draws its elements instead of showing source on ${surface}`, async $ => {
    for (const kind of ['C4Context', 'C4Container', 'C4Component', 'C4Dynamic', 'C4Deployment']) {
      const ui = await $.ui.mount(mount(fence(`${kind}\n  System(a, "Alpha")\n  System(b, "Beta")\n  Rel(a, b, "Calls")`), 200, surface))
      expect(await ui.find({ type: 'Text', text: /draw as source|failed to render/ })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /^── mermaid$/ })).toBeUndefined()
      expect(await ui.find({ text: /Alpha/ })).toBeDefined()
      expect(await ui.find({ text: /Beta/ })).toBeDefined()
      await ui.unmount()
    }
  })

  test(`C4 colors: externals in the comment color, arrowheads in the accent color, names bold, on ${surface}`, async $ => {
    const t = PRESETS['catppuccin-mocha']
    const ui = await $.ui.mount(mount(fence(BANK), 200, surface))
    expect((await paintOf(ui, '[External Software System]'))?.color).toBe(t.codeComment)
    expect((await paintOf(ui, '[Container: React]'))?.color).not.toBe(t.codeComment)
    expect((await paintOf(ui, 'Web App'))?.bold).toBe(true)
    expect((await paintOf(ui, '►'))?.color).toBe(t.accent)
    await ui.unmount()
  })

  test(`each C4 route and its legend row share a hover group on ${surface}`, async $ => {
    const ui = await $.ui.mount(mount(fence(BANK), 200, surface))
    const groups = scoped(await ui.drawn())
    expect(groups.size).toBe(3)
    for (const texts of groups.values()) {
      expect(texts.some(t => /[─│┌┐└┘├┤┬┴]/.test(t))).toBe(true)
      expect(texts.some(t => /→/.test(t))).toBe(true)
    }
    await ui.unmount()
  })

  test(`two replies drawing the same C4 diagram light only their own routes on ${surface}`, async $ => {
    const seen: string[][] = []
    for (const requestId of ['r1', 'r2']) {
      const ui = await $.ui.mount({ ...mount(fence(BANK), 200, surface), requestId })
      seen.push([...scoped(await ui.drawn()).keys()])
      await ui.unmount()
    }
    expect(seen[0]!.length).toBe(3)
    expect(seen[1]!.some(s => seen[0]!.includes(s))).toBe(false)
  })
}

test('a half-streamed C4 diagram waits for its closing fence', async $ => {
  const ui = await $.ui.mount(mount('```mermaid\n' + BANK))
  expect(await ui.find({ text: /\[Container: React\]/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /failed to render|draw as source/ })).toBeUndefined()
  await ui.unmount()
})

test('C4 boxes print their type in brackets under the title, and the legend names each relationship', () => {
  const drawn = art(BANK)
  expect(drawn.split('\n')[0]).toBe('Internet banking')
  for (const text of ['[Person]', '[Container: React]', '[Container: Postgres]', '[External Software System]', 'Internet Banking']) expect(picture(drawn)).toContain(text)
  expect(legend(drawn)).toMatch(/^ 1 {2}Customer → Web App {2}Uses \[HTTPS\]$/m)
  expect(legend(drawn)).toMatch(/^ 3 {2}Web App → E-mail System {2}Sends e-mail$/m)
})

test('every C4 relationship draws as a line carrying its number, ending in an arrowhead', () => {
  const drawn = picture(art(BANK))
  for (const n of ['1', '2', '3']) expect(drawn).toContain(n)
  expect((drawn.match(/[►◄▼▲]/g) ?? []).length).toBe(3)
})

test('C4 relationships between the same two boxes share one line labelled with every number', () => {
  const source = ['C4Dynamic', '  Container(a, "App")', '  Container(s, "Store")', ...Array.from({ length: 8 }, (_, i) => `  Rel(${i % 2 ? 's, a' : 'a, s'}, "Step ${i + 1}")`)].join('\n')
  const drawn = art(source)
  expect(picture(drawn)).toContain('1,3,5,7')
  expect(picture(drawn)).toContain('2,4,6,8')
  expect(legend(drawn)).toMatch(/^ 8 {2}Store → App {2}Step 8$/m)
})

test('C4 never stacks the digits of one number down a vertical line', () => {
  const source = ['C4Dynamic', '  Container(a, "App")', '  Container(b, "Store")', ...Array.from({ length: 11 }, (_, i) => `  Rel(a, b, "Step ${i + 1}")`)].join('\n')
  const rows = picture(art(source, 40)).split('\n')
  const stacked = rows.flatMap((row, r) => [...row].flatMap((ch, c) => (/\d/.test(ch) && /\d/.test([...(rows[r + 1] ?? '')][c] ?? '') ? [`${r}:${c}`] : [])))
  expect(stacked).toEqual([])
})

test('C4 descriptions wrap and stop at two lines, and <br/> breaks become spaces', () => {
  const drawn = art('C4Context\n  System(a, "Alpha", "one two three four five six seven eight nine ten eleven twelve thirteen fourteen")\n  Person(p, "Customer", "A customer, <br/> with accounts")')
  expect(drawn).toContain('…')
  expect(drawn).not.toContain('fourteen')
  expect(drawn).not.toContain('<br')
  expect(drawn).toContain('A customer, with accounts')
})

test('nested C4 boundaries draw as frames inside frames', () => {
  const drawn = art(`C4Context
  Enterprise_Boundary(ent, "Big Bank") {
    System_Boundary(core, "Core") {
      System(ib, "Internet Banking")
    }
  }`)
  const lines = drawn.split('\n')
  const outer = lines.findIndex(l => l.includes('Big Bank'))
  const inner = lines.findIndex(l => l.includes('Core'))
  expect(inner).toBeGreaterThan(outer)
  expect(lines[inner]!.indexOf('│')).toBe(0)
  expect(lines[inner]!.lastIndexOf('│')).toBe(lines[outer]!.lastIndexOf('│'))
  expect(lines[inner]!.match(/│/g)!.length).toBe(4)
})

test('a C4 frame grows to fit a title longer than its boxes, and only typed boundaries show a type', () => {
  expect(art('C4Deployment\n  Deployment_Node(aws, "Amazon Web Services", "Elastic Compute Cloud") {\n    Container(api, "API")\n  }')).toContain('Amazon Web Services [Elastic Compute Cloud]')
  expect(art('C4Context\n  System_Boundary(b, "Bank", "tag") {\n    System(a, "Alpha")\n  }')).not.toContain('[tag]')
})

test('C4 reads one-line boundaries, trailing comments and empty labels', () => {
  const drawn = art('C4Context\n  System_Boundary(b, "Bank") { System(x, "Ledger") }\n  Person(a, "")  %% the user\n  Rel(a, x, "Reads") %% read path')
  expect(picture(drawn)).toContain('Bank')
  expect(picture(drawn)).toContain('Ledger')
  expect(legend(drawn)).toContain('a → Ledger  Reads')
})

test('C4 aliases that are flowchart keywords still draw', () => {
  expect(art('C4Context\n  System(end, "Ending")\n  System(graph, "Graphing")\n  Rel(end, graph, "Feeds")')).toContain('Ending → Graphing  Feeds')
})

test('named C4 arguments fill their slot and quoted commas stay in one argument', () => {
  const drawn = art('C4Container\n  Container(api, "API, public", $descr="Serves JSON", $techn="Go")')
  expect(drawn).toContain('API, public')
  expect(drawn).toContain('[Container: Go]')
  expect(drawn).toContain('Serves JSON')
})

test('BiRel draws arrowheads at both ends and Rel_Back points at its first alias', () => {
  const both = art('C4Context\n  System(a, "Alpha")\n  System(b, "Beta")\n  BiRel(a, b, "Syncs")')
  expect(legend(both)).toContain('Alpha ↔ Beta  Syncs')
  expect((picture(both).match(/[►◄▼▲]/g) ?? []).length).toBe(2)
  expect(picture(both)).not.toMatch(/[├┤┬┴][►◄▼▲]|[►◄▼▲][├┤┬┴]/)
  expect(legend(art('C4Context\n  System(a, "Alpha")\n  System(b, "Beta")\n  Rel_Back(a, b, "Reads")'))).toContain('Beta → Alpha  Reads')
})

test('C4Dynamic steps are numbered in statement order', () => {
  const drawn = legend(art('C4Dynamic\n  Container(a, "SPA")\n  Container(b, "API")\n  ContainerDb(c, "DB")\n  RelIndex(9, a, b, "Submits")\n  Rel(b, c, "Stores")'))
  expect(drawn).toMatch(/^ 1 {2}SPA → API {2}Submits$/m)
  expect(drawn).toMatch(/^ 2 {2}API → DB {2}Stores$/m)
})

test('a relationship from a C4 element to itself is listed in the comment color without a line', async $ => {
  const source = 'C4Context\n  System(a, "Alpha")\n  Rel(a, a, "Retries")'
  const drawn = art(source)
  expect(legend(drawn)).toContain('Alpha → Alpha  Retries')
  expect(picture(drawn)).not.toMatch(/[►◄▼▲]/)
  const ui = await $.ui.mount(mount(fence(source)))
  expect((await paintOf(ui, 'Retries'))?.color).toBe(PRESETS['catppuccin-mocha'].codeComment)
  await ui.unmount()
})

test('broken C4 shows its source under the failure note', async $ => {
  const broken = [
    'C4Context\n  System(a, "Alpha")\n  Rel(a, nowhere, "Calls")',
    'C4Deployment\n  Deployment_Node(n1, "One") {\n    Container(x, "X")\n  }\n  Deployment_Node(n2, "Two") {\n    Container(y, "Y")\n  }\n  Rel(n1, n2, "Replicates")',
    'C4Context\n  System_Boundary(b, "Open") {\n    System(a, "Alpha")',
  ]
  for (const source of broken) {
    expect(c4Model(source)).toBeNull()
    const ui = await $.ui.mount(mount(fence(source)))
    expect(await ui.find({ type: 'Text', text: /^diagram failed to render$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^── mermaid$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('C4 style and layout statements are skipped', () => {
  const drawn = art('C4Context\n  System(a, "Alpha")\n  UpdateElementStyle(a, $bgColor="red")\n  UpdateLayoutConfig($c4ShapeInRow="3")\n  Lay_R(a, a)')
  expect(drawn).toContain('Alpha')
  expect(drawn).not.toContain('bgColor')
})

test('C4 draws in plain ASCII when mermaidAscii is on', () => {
  const drawn = mermaidText(BANK, true, 200) ?? ''
  expect(drawn).toContain('[Container: React]')
  expect(drawn).toContain('Customer -> Web App')
  expect(drawn).not.toMatch(/[─│┌┐└┘╭╮╰╯►◄▼▲→]/)
})

test('C4 fits the terminal by wrapping boxes onto more rows and the legend onto more lines', () => {
  for (const columns of [80, 100, 160]) expect(widest(art(BANK, columns))).toBeLessThanOrEqual(columns - 2)
  const long = 'C4Context\n  Person(a, "Customer of the personal banking platform")\n  System(s, "Mainframe banking system of record for accounts")\n  Rel(a, s, "Uses a very long relationship label that will certainly need wrapping somewhere")'
  expect(widest(art(long, 80))).toBeLessThanOrEqual(78)
  expect(widest(art('C4Context\n  System(a, "A")\n  System(b, "B")\n  Rel(a, b, "' + 'x'.repeat(90) + '")', 80))).toBeLessThanOrEqual(78)
})

test('C4 queues draw with double side bars', () => {
  expect(art('C4Container\n  ContainerQueue(q, "Events", "Kafka")')).toMatch(/╟─+╢/)
})
