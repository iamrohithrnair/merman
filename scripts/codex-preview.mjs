import { readFileSync, statSync } from 'node:fs'
import { parse } from '../hooks/markdown.ts'
import { drawDiagrams } from '../hooks/mermaid.tsx'
import { renderBlocks } from '../hooks/render.tsx'
import { resolveStyle } from '../hooks/theme.ts'

globalThis.h = (type, props, ...children) => ({ type, props, children })
globalThis.Fragment = Symbol('Fragment')

const elements = { Box: 'Box', Text: 'Text', Link: 'Link' }
const escapes = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
const escape = text => String(text).replace(/[&<>"]/g, ch => escapes[ch])
const color = value => /^(?:#[0-9a-f]{3}|#[0-9a-f]{6}|[a-z]+)$/i.test(value ?? '') ? value : null
const cells = value => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0

const attributes = props => {
  const rules = [
    ['color', color(props.color)],
    ['background-color', color(props.background ?? props.backgroundColor)],
    ['border-color', color(props.borderColor)],
    ['padding-inline-start', cells(props.paddingLeft ?? props.paddingX) + 'ch'],
    ['padding-inline-end', cells(props.paddingRight ?? props.paddingX) + 'ch'],
    ['column-gap', cells(props.columnGap) + 'ch'],
    ['row-gap', cells(props.rowGap) + 'em'],
    ['width', props.width === '100%' ? props.width : cells(props.width) + 'ch'],
    ['flex-wrap', props.flexWrap === 'wrap' ? 'wrap' : null],
    ['flex-shrink', props.flexShrink === 0 ? '0' : null],
    ['align-items', ['center', 'flex-start', 'flex-end'].includes(props.alignItems) ? props.alignItems : null],
    ['align-self', ['center', 'flex-start', 'flex-end'].includes(props.alignSelf) ? props.alignSelf : null],
    ['justify-content', ['center', 'flex-start', 'flex-end', 'space-between'].includes(props.justifyContent) ? props.justifyContent : null],
  ]
  const css = rules.filter(([, value]) => value && value !== '0ch' && value !== '0em').map(([key, value]) => key + ':' + value).join(';')
  return css ? ' style="' + escape(css) + '"' : ''
}

const html = node => {
  if (node == null || typeof node === 'boolean') return ''
  if (Array.isArray(node)) return node.map(html).join('')
  if (typeof node !== 'object') return escape(node)
  const { type, children } = node
  const props = node.props ?? {}
  const body = html(children)
  const style = attributes(props)
  if (type === 'Box') {
    const border = props.borderStyle ? props.borderStyle === 'double' ? ' double' : ' bordered' : ''
    return '<div class="' + (props.flexDirection === 'row' ? 'row' : 'column') + border + '"' + style + '>' + body + '</div>'
  }
  if (type === 'Link' && /^https?:\/\//i.test(props.href ?? '')) {
    return '<a href="' + escape(props.href) + '" rel="noreferrer"' + style + '>' + (body || escape(props.label ?? '')) + '</a>'
  }
  if (type !== 'Text') return body || escape(props.label ?? '')
  const flags = ['bold', 'italic', 'underline', 'strikethrough', 'dimColor', 'inverse'].filter(key => props[key]).join(' ')
  return '<span class="' + flags + '"' + style + '>' + body + '</span>'
}

const [input, theme = 'catppuccin-mocha'] = process.argv.slice(2)
if (!input) {
  process.stderr.write('Usage: node render.mjs <input.md> [theme]\n')
  process.exit(2)
}
if (!statSync(input, { throwIfNoEntry: false })?.isFile()) {
  process.stderr.write('Input must be a Markdown file.\n')
  process.exit(2)
}

const columns = 100
const style = resolveStyle({ theme })
style.httpLinks = true
const blocks = parse(readFileSync(input, 'utf8'), { numbers: true, paths: true })
const diagrams = drawDiagrams(elements, style, blocks, columns)
const body = html(renderBlocks(elements, style, blocks, columns, diagrams))
process.stdout.write('<!doctype html>\n<html lang="en"><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">' +
  '<title>Merman preview</title><style>' +
  'html{background:' + (color(style.background) ?? '#111') + ';color:' + (color(style.theme.codeText) ?? '#eee') + '}' +
  'body{margin:0;font:14px/1.5 ui-monospace,monospace}main{padding:2ch;max-width:106ch;margin:auto;overflow:auto;white-space:pre}' +
  'main>span{display:block;white-space:pre-wrap;overflow-wrap:anywhere}' +
  '.row,.column{display:flex;min-height:1.5em}.column{flex-direction:column}.bordered,.double{border:1px solid}.double{border:3px double}' +
  '.bold{font-weight:700}.italic{font-style:italic}.underline{text-decoration:underline}.strikethrough{text-decoration:line-through}' +
  '.dimColor{opacity:.7}.inverse{filter:invert(1)}a{color:inherit}' +
  '</style><main>' + body + '</main></html>\n')
