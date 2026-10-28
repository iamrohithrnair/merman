import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { load } from './load.mjs'

const { LINUX_TABLE_COPY, clipboardCommand } = await load()
const html = '<table><tr><td>שלום 中文 $(ignored) `ignored` \\n</td></tr></table>'
const text = 'Name\tValue\nשלום\t中文 $(ignored) `ignored` \\n'
const command = clipboardCommand('linux', html, text)
assert.deepEqual(command.argv, ['copyq', 'eval', LINUX_TABLE_COPY, '-'])

for (const corrupted of [undefined, 'text/html', 'text/plain']) {
  let copies = 0
  const formats = new Map()
  const run = () => runInNewContext(LINUX_TABLE_COPY, {
    arguments: [LINUX_TABLE_COPY, Buffer.from(command.stdin)],
    str: value => value.toString('utf8'),
    copy: (...args) => {
      copies++
      for (let index = 0; index < args.length; index += 2) formats.set(args[index], args[index + 1])
    },
    clipboard: type => Buffer.from(type === corrupted ? '' : formats.get(type)),
  })
  if (corrupted) assert.throws(run, /Clipboard verification failed/)
  else run()
  assert.equal(copies, 1)
  assert.deepEqual([...formats], [['text/html', html], ['text/plain', text]])
}
console.log('CopyQ publishes distinct HTML and plain text together and rejects either missing format')
