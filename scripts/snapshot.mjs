import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, load } from './load.mjs'

const { resolveStyle, reply } = await load()
const demo = readFileSync(join(ROOT, 'docs/demo.md'), 'utf8')
const dir = join(ROOT, 'tests/snapshots')
const THEMES = ['catppuccin-mocha', 'github-light', 'mono']

const flags = p => ['bold', 'italic', 'underline', 'strikethrough', 'dim', 'inverse'].filter(k => p?.[k]).join(',')
const walk = (node, depth, out) => {
  if (node === null || node === undefined || node === false) return
  if (Array.isArray(node)) return node.forEach(n => walk(n, depth, out))
  if (typeof node !== 'object') return void out.push(`${'  '.repeat(depth)}"${node}"`)
  const { type, props: p, children = [] } = node
  const props = p ?? {}
  const attrs = [props.color && `color=${props.color}`, props.backgroundColor && `bg=${props.backgroundColor}`, flags(props), props.flexDirection === 'row' && 'row', props.borderStyle && `border=${props.borderStyle}`].filter(Boolean).join(' ')
  out.push(`${'  '.repeat(depth)}<${type}${attrs ? ` ${attrs}` : ''}>`)
  walk(children, depth + 1, out)
}

let bad = 0
mkdirSync(dir, { recursive: true })
for (const [theme, rtl, name] of [...THEMES.map(t => [t, 'warp', t]), ['catppuccin-mocha', 'kitty', 'kitty']]) {
  const out = []
  walk(reply(demo, resolveStyle({ theme, rtl }), 100), 0, out)
  const text = `${out.join('\n')}\n`
  const file = join(dir, `demo-${name}.txt`)
  if (process.argv.includes('--update') || !existsSync(file)) {
    writeFileSync(file, text)
    console.log(`wrote ${file}`)
  } else if (readFileSync(file, 'utf8') !== text) {
    bad++
    const a = readFileSync(file, 'utf8').split('\n')
    const b = text.split('\n')
    const i = a.findIndex((l, k) => l !== b[k])
    console.error(`SNAPSHOT DIFF ${name} at line ${i + 1}:\n  was: ${a[i]}\n  now: ${b[i]}`)
  } else console.log(`ok ${name}`)
}
if (bad) process.exit(1)
