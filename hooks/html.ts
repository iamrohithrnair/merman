import type { Block, Inline } from './markdown'
import { displayText, isWebLink } from './markdown'

const tsvCell = (cell: Inline[]): string => {
  const text = displayText(cell)
  return /[\t\r\n"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export const tableText = (table: Extract<Block, { kind: 'table' }>): string =>
  [table.header, ...table.rows].map(row => row.map(tsvCell).join('\t')).join('\n')

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, c => ENTITIES[c]!)

const inlineHtml = (nodes: Inline[]): string => nodes.map(node => {
  switch (node.kind) {
    case 'strong': return `<strong>${inlineHtml(node.children)}</strong>`
    case 'emphasis': return `<em>${inlineHtml(node.children)}</em>`
    case 'strike': return `<del>${inlineHtml(node.children)}</del>`
    case 'code': return `<code style="white-space: pre-wrap">${escapeHtml(node.text)}</code>`
    case 'math': return `<em>${escapeHtml(node.text)}</em>`
    case 'link': return isWebLink(node.href)
      ? `<a href="${escapeHtml(node.href)}">${escapeHtml(node.text)}</a>`
      : escapeHtml(node.text)
    default: return escapeHtml(node.text).replace(/\n/g, '<br>')
  }
}).join('')

export const tableHtml = (table: Extract<Block, { kind: 'table' }>): string => {
  const row = (cells: Inline[][], tag: 'th' | 'td') => `    <tr>${cells.map((cell, i) =>
    `<${tag} style="text-align: ${table.align[i] ?? 'left'}">${inlineHtml(cell)}</${tag}>`,
  ).join('')}</tr>`
  return [
    '<table>',
    '  <thead>',
    row(table.header, 'th'),
    '  </thead>',
    '  <tbody>',
    ...table.rows.map(cells => row(cells, 'td')),
    '  </tbody>',
    '</table>',
  ].join('\n')
}
