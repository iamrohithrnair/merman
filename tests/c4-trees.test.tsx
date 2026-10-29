import { expect, test } from 'claude-code/testing'

import { parse } from '../hooks/markdown'
import { drawDiagrams } from '../hooks/mermaid'
import { resolveStyle } from '../hooks/theme'

const mount = (text: string, columns = 120) => ({
  plugin: 'merman',
  component: 'AssistantMessage' as const,
  props: { text, isFirstOfReply: true },
  viewport: { columns, rows: 40 },
  surface: 'terminal' as const,
})

const fence = (source: string) => '```mermaid\n' + source + '\n```'

const bigC4 = (seed: number) => {
  let at = seed
  const next = () => (at = (at * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  const lines = ['C4Container']
  for (let f = 0; f < 4; f++) {
    lines.push(`  System_Boundary(g${f}, "Group ${f}") {`)
    for (let i = f * 7; i < f * 7 + 7; i++) lines.push(`    Container(c${i}, "Orders ${i}", "Go", "Takes orders from the web shop")`)
    lines.push('  }')
  }
  lines.push('  Person(c28, "Customer", "Buys bread online")', '  Person(c29, "Visitor", "Looks around")')
  for (let j = 0; j < 40; j++) {
    const a = Math.floor(next() * 30)
    lines.push(`  Rel(c${a}, c${(a + 1 + Math.floor(next() * 29)) % 30}, "Calls ${j}", "HTTPS")`)
  }
  return lines.join('\n')
}

test('a redraw of a reply whose C4 drawings together outgrow the tree cache still reuses every drawing', { timeoutMs: 20000 }, async ($, on) => {
  const blocks = parse([7, 8, 9, 10].map(seed => fence(bigC4(seed))).join('\n\nSome words.\n\n'), { numbers: true, paths: true })
  const style = { ...resolveStyle({ theme: 'dracula' }), noteKey: 'r1' }
  let reused: boolean[] | undefined
  on('ui.render', ($, e) => {
    const el = $.ui.resolve(e)
    if (!reused) {
      const first = drawDiagrams(el, style, blocks, 160)
      const again = drawDiagrams(el, style, blocks, 160)
      reused = [...first].map(([i, d]) => again.get(i)?.element === d.element)
    }
    return <el.Text>engine</el.Text>
  })
  const ui = await $.ui.mount(mount(''))
  await ui.unmount()
  expect(reused).toEqual([true, true, true, true])
})
