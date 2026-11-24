import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

await build({
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  entryPoints: ['scripts/devin-mermaid.mjs'],
  outfile: 'devin/skills/mermaid/render.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  jsxFactory: 'h',
  jsxFragment: 'Fragment',
  minify: true,
  legalComments: 'none',
})
