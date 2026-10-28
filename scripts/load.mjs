import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ROOT = fileURLToPath(new URL('..', import.meta.url))

export const load = async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'merman-')), 'bundle.js')
  await build({
    stdin: {
      contents: [
        "export { parse } from './hooks/markdown.ts'",
        "export { MAC_TABLE_COPY, LINUX_TABLE_COPY, WIN_TABLE_COPY, MAC_IMAGE_COPY, WIN_IMAGE_COPY, clipboardCommand, imageCommand } from './hooks/clipboard.ts'",
        "export { tableHtml } from './hooks/html.ts'",
        "export { renderBlocks, renderDiffCard } from './hooks/render.tsx'",
        "export { mermaidText, boxArt, drawDiagrams } from './hooks/mermaid.tsx'",
        "export { resolveStyle } from './hooks/theme.ts'",
      ].join('\n'),
      resolveDir: ROOT,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    jsx: 'transform',
    jsxFactory: 'h',
    jsxFragment: 'Fragment',
    outfile: out,
    logLevel: 'error',
  })
  globalThis.h = (type, props, ...children) => ({ type, props, children })
  globalThis.Fragment = 'Fragment'
  const lib = await import(pathToFileURL(out).href)
  const el = { Box: 'Box', Text: 'Text', Button: 'Button', Link: 'Link' }
  const reply = (text, style, columns = 200) => {
    const blocks = lib.parse(text, { numbers: style.highlightNumbers, paths: style.highlightPaths })
    return lib.renderBlocks(el, style, blocks, columns, lib.drawDiagrams(el, style, blocks, columns), () => null)
  }
  return { ...lib, el, reply }
}
