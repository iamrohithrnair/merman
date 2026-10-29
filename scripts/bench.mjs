import { readFileSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { join } from 'node:path'
import { ROOT, load } from './load.mjs'

const { parse, mermaidText, boxArt, resolveStyle, el, reply, renderDiffCard } = await load()
const demo = readFileSync(join(ROOT, 'docs/demo.md'), 'utf8')
const style = resolveStyle({ theme: 'dracula', rtl: 'warp' })
const columns = 200
const RUNS = Number(process.env.RUNS ?? 200)
const BASELINE = join(ROOT, 'docs/bench-baseline.json')
const TOLERANCE = 1.6

const quantile = (samples, q) => {
  const s = [...samples].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]
}

const time = (label, fn, runs = RUNS) => {
  for (let i = 0; i < 5; i++) fn(-1 - i)
  const samples = []
  for (let i = 0; i < runs; i++) {
    const t = performance.now()
    fn(i)
    samples.push(performance.now() - t)
  }
  return { stage: label, median: quantile(samples, 0.5), p95: quantile(samples, 0.95) }
}

const calibration = time('calibration', () => {
  let x = 0
  for (let i = 0; i < 1e6; i++) x = (x + Math.sqrt(i)) % 97
  return x
}, 30).median

const fresh = (text, i) => `${text}\n${i}`
const freshCharts = (text, i) => text.replace(/(```mermaid\n[\s\S]*?)\n```/g, `$1\n%% ${i}\n\`\`\``).concat(`\n${i}`)

const section = n => demo.repeat(n)
const bigTable = `| id | service | region | pods | p95 |\n|---|---|---|---|---|\n${Array.from({ length: 300 }, (_, i) => `| ${i} | svc-${i} | us-east | ${i * 3} | ${i % 90}ms |`).join('\n')}`
const code = n => `\`\`\`ts\n${Array.from({ length: n }, (_, i) => `const v${i} = await fetch("/api/${i}", { retries: ${i % 5} }) // 99.9% ~/src/app.ts`).join('\n')}\n\`\`\``
const bigCode = code(800)
const hugeCode = code(1500)
const streamSource = section(6)

const blocks = parse(demo, { numbers: true, paths: true })
const charts = blocks.filter(b => b.kind === 'code' && b.lang === 'mermaid').map(b => b.lines.join('\n'))
const arts = charts.map(c => mermaidText(c, false, columns))

const streamTimes = []
for (let end = 100; end <= streamSource.length; end += 100) {
  const text = streamSource.slice(0, end)
  const t = performance.now()
  reply(text, style)
  streamTimes.push(performance.now() - t)
}

const hebrew = (n, tag = '') => Array.from({ length: n }, (_, i) => `פסקה ${i}${tag} עם **מודגש**, \`קוד\`, 99.9% ו-250ms וגם kubectl באנגלית ועוד מילים כדי שהשורה תתכסה.`).join("\n\n")
const count = n => (n == null || n === false ? 0 : Array.isArray(n) ? n.reduce((a, c) => a + count(c), 0) : typeof n !== "object" ? 1 : 1 + count(n.children))
const linked = { ...style, httpLinks: true, fileLinks: 'file://', pathLinks: true, home: '/home/me', cwd: '/work' }
const paragraphs = Array.from({ length: 300 }, (_, i) => `Paragraph ${i} with **bold**, \`code\`, 99.9% and ~/src/app.ts.`).join("\n\n")
const pathTable = `| file | notes |\n|---|---|\n${Array.from({ length: 300 }, (_, i) => `| /srv/app/src/f${i}.ts | ~/notes/n${i}.md |`).join('\n')}`
const nodeRows = [
  ["nodes: 500 highlighted ts lines", `\`\`\`ts\n${Array.from({ length: 500 }, (_, i) => `const v${i} = await fetch("/api/${i}", { retries: ${i % 5} })`).join("\n")}\n\`\`\``],
  ["nodes: 300 table rows", bigTable.split("\n").slice(0, 302).join("\n")],
  ["nodes: 300 paragraphs", paragraphs],
  ["nodes: 300 paragraphs, paths linked", paragraphs, linked],
  ["nodes: 300 table rows of paths, linked", pathTable, linked],
  ["nodes: 300 Hebrew paragraphs", hebrew(300)],
  ["nodes: demo reply", demo],
].map(([stage, text, drawn = style]) => ({ stage, nodes: count(reply(text, drawn)) }))
const editLines = Array.from({ length: 400 }, (_, i) => `+const v${i} = await fetch("/api/${i}", { retries: ${i % 5} })`)
nodeRows.push({ stage: 'nodes: opened 400-line diff card', nodes: count(renderDiffCard(el, style, { filePath: '/repo/app.ts', structuredPatch: [{ oldStart: 1, newStart: 1, lines: editLines }] }, () => ({ folded: false, element: null }), 'bench')) })

const rows = [
  time('parse, demo (cold)', i => parse(fresh(demo, i), { numbers: true, paths: true })),
  time('mermaid layout, demo diagrams (cold)', i => charts.forEach(c => mermaidText(`${c}\n%% ${i}`, false, columns))),
  time('mermaid paint, demo diagrams', () => arts.forEach((a, k) => a && boxArt(el, style, a, `b${k}`))),
  time('full reply, demo (cold)', i => reply(freshCharts(demo, i), style)),
  time('full reply, demo (warm)', () => reply(demo, style)),
  time('full reply, 6x demo (cold)', i => reply(freshCharts(section(6), i), style), Math.max(20, RUNS / 5)),
  time('table, 300 rows', i => reply(fresh(bigTable, i), style)),
  time('Hebrew, 300 paragraphs (cold)', i => reply(hebrew(300, `-${i}`), style), Math.max(20, RUNS / 5)),
  time('code block, 800 lines, highlighted', i => reply(fresh(bigCode, i), style), Math.max(20, RUNS / 5)),
  time('code block, 1500 lines, drawn plain past the node budget', i => reply(fresh(hugeCode, i), style), Math.max(20, RUNS / 5)),
  {
    stage: 'stream replay of the 6x demo reply, every 100 chars (per redraw)',
    median: quantile(streamTimes, 0.5),
    p95: quantile(streamTimes, 0.95),
  },
].map(r => ({ ...r, relative: r.median / calibration }))

const fmt = n => n.toFixed(3)
console.table(nodeRows.map(r => ({ stage: r.stage, nodes: r.nodes, 'of 20000 limit': `${((r.nodes / 20000) * 100).toFixed(0)}%` })))
console.log(`node ${process.version}, ${cpus()[0]?.model ?? 'cpu'}, ${RUNS} runs, calibration ${fmt(calibration)} ms`)
console.table(rows.map(r => ({ stage: r.stage, 'median ms': fmt(r.median), 'p95 ms': fmt(r.p95), 'x calibration': r.relative.toFixed(4) })))

const args = process.argv.slice(2)
if (args.includes('--update')) {
  const baseline = Object.fromEntries([...rows.map(r => [r.stage, Number(r.relative.toFixed(5))]), ...nodeRows.map(r => [r.stage, r.nodes])])
  writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`)
  console.log(`baseline written to ${BASELINE}`)
}
if (args.includes('--check')) {
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'))
  const failed = args.includes('--no-time') ? [] : rows.filter(r => baseline[r.stage] !== undefined && r.relative > baseline[r.stage] * TOLERANCE)
  const missing = rows.filter(r => baseline[r.stage] === undefined)
  for (const r of failed) console.error(`REGRESSION ${r.stage}: ${r.relative.toFixed(4)} vs baseline ${baseline[r.stage]} (limit x${TOLERANCE})`)
  for (const r of missing) console.error(`NO BASELINE ${r.stage}`)
  const grown = nodeRows.filter(r => baseline[r.stage] !== undefined && r.nodes > baseline[r.stage] * 1.1)
  for (const r of grown) console.error(`NODE GROWTH ${r.stage}: ${r.nodes} vs baseline ${baseline[r.stage]} (limit +10%, engine refuses trees over 20000)`)
  for (const r of nodeRows.filter(r => baseline[r.stage] === undefined)) console.error(`NO BASELINE ${r.stage}`)
  if (failed.length || missing.length || grown.length || nodeRows.some(r => baseline[r.stage] === undefined)) process.exit(1)
  console.log(args.includes('--no-time') ? 'node counts within +10% of baseline (timings reported, not gated)' : `all stages within x${TOLERANCE} time and +10% nodes of baseline`)
}
