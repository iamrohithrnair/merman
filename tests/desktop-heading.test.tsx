import { expect, test } from 'claude-code/testing'

import { width } from '../hooks/render'

for (const surface of ['terminal', 'desktop'] as const) {
  test(`a level 2 banner heading on ${surface} draws its rule as long as the heading`, async $ => {
    const ui = await $.ui.mount({
      plugin: 'merman',
      surface,
      component: 'AssistantMessage' as const,
      props: { text: '## Heading level two', isFirstOfReply: true },
      viewport: { columns: 153, rows: 54 },
    })
    const rule = (await ui.findAll({ type: 'Text' })).find(t => /^━+$/.test(t.text))
    expect(rule).toBeDefined()
    if (surface === 'terminal') expect(rule!.text).toBe('━'.repeat(width('Heading level two')))
    else {
      expect(rule!.text.length).toBeGreaterThan(width('Heading level two'))
      const holders = (await ui.findAll({ type: 'Box' })).filter(b => b.props.width === 0 && b.props.flexGrow === 1 && b.props.overflow === 'hidden')
      expect(holders).toHaveLength(1)
    }
    await ui.unmount()
  })
}
