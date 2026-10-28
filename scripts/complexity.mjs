import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const baselineFile = join(root, 'scripts', 'complexity-baseline.json')
const MAX = 15

const files = execFileSync('git', ['ls-files', 'hooks/*.ts', 'hooks/*.tsx'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter(file => file && !file.includes('/vendor/'))

const lint = () => {
  const args = ['lint', '--only=complexity/noExcessiveCognitiveComplexity', '--reporter=json', '--max-diagnostics=1000', ...files]
  try {
    return execFileSync(join(root, 'scripts', 'node_modules', '.bin', 'biome'), args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch (error) {
    return error.stdout
  }
}

const found = JSON.parse(lint()).diagnostics
  .filter(d => d.category === 'lint/complexity/noExcessiveCognitiveComplexity')
  .map(d => ({ at: `${d.location.path}:${d.location.start.line}`, file: d.location.path, score: Number(/complexity of (\d+)/.exec(JSON.stringify(d.message))[1]) }))

const excess = {}
for (const { file, score } of found) excess[file] = (excess[file] ?? 0) + score - MAX

if (process.argv.includes('--update')) {
  writeFileSync(baselineFile, `${JSON.stringify(Object.fromEntries(Object.entries(excess).sort()), null, 2)}\n`)
  console.log(`complexity baseline: ${found.length} functions over ${MAX}, written to scripts/complexity-baseline.json`)
  process.exit(0)
}

const baseline = JSON.parse(readFileSync(baselineFile, 'utf8'))
const grown = Object.keys(excess).filter(file => excess[file] > (baseline[file] ?? 0))
for (const file of grown) {
  console.log(`::error file=${file}::cognitive complexity over ${MAX} grew from ${baseline[file] ?? 0} to ${excess[file]}. Split the function, or lower another one in this file.`)
  for (const f of found.filter(f => f.file === file)) console.log(`  ${f.at} complexity ${f.score}`)
}
const lowered = Object.keys(baseline).filter(file => (excess[file] ?? 0) < baseline[file])
if (lowered.length) console.log(`complexity went down in ${lowered.join(', ')}: run npm --prefix scripts run complexity:update to lock it in`)
console.log(`${found.length} functions over ${MAX}`)
process.exit(grown.length ? 1 : 0)
