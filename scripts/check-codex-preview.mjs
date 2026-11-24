import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const renderer = fileURLToPath(new URL('../integrations/codex/skills/merman/render.mjs', import.meta.url))
const temp = mkdtempSync(join(tmpdir(), 'merman-codex-'))
try {
  const input = join(temp, 'reply.md')
  writeFileSync(input, [
    '# Preview',
    '',
    '| Item | Count |',
    '| --- | ---: |',
    '| Apples | 3 |',
    '',
    '~~~mermaid',
    'flowchart LR',
    '  A[Plan] --> B[Ship]',
    '~~~',
    '',
    '<script>alert("example")</script>',
    '',
    '[Example](https://example.com)',
  ].join('\n'))
  const result = spawnSync(process.execPath, [renderer, input], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Content-Security-Policy/)
  assert.match(result.stdout, /background:#1e1e2e/)
  assert.match(result.stdout, /Apples/)
  assert.match(result.stdout, /[┌╭].*[┐╮]/)
  assert.match(result.stdout, /href="https:\/\/example\.com"/)
  assert.match(result.stdout, /&lt;/)
  assert.doesNotMatch(result.stdout, /<script\b/i)
  console.log('Codex preview renders tables, Mermaid diagrams, and safe HTML')
} finally {
  rmSync(temp, { recursive: true, force: true })
}
