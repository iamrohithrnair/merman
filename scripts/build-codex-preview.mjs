import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const notices = ['../LICENSE', '../docs/THIRD_PARTY_NOTICES.md']
  .map(path => readFileSync(new URL(path, import.meta.url), 'utf8').trim().replaceAll('*/', '* /'))

await build({
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  entryPoints: ['scripts/codex-preview.mjs'],
  outfile: 'integrations/codex/skills/merman/render.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  jsxFactory: 'h',
  jsxFragment: 'Fragment',
  minify: true,
  banner: { js: '/*\n' + notices.join('\n\n') + '\n*/' },
})
