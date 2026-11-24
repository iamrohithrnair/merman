import { readFileSync } from 'node:fs'
import { mermaidText } from '../hooks/mermaid.tsx'

const source = readFileSync(process.argv[2] ?? 0, 'utf8').replace(/^\s*```+\s*mermaid[^\n]*\n|\n\s*```+\s*$/g, '')
const columns = Number(process.env.COLUMNS) || 100
const art = mermaidText(source, process.env.MERMAN_ASCII === '1', columns)
if (art === null) {
  process.stderr.write('merman could not draw this diagram\n')
  process.exit(1)
}
process.stdout.write(`${art}\n`)
