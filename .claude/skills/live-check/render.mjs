import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [bin, png, cols, rows, xterm] = process.argv.slice(2)
const chrome = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => p && existsSync(p))
if (!chrome) throw new Error('no Chrome or Chromium found, set CHROME')
const dir = mkdtempSync(join(tmpdir(), 'live-check-'))
const html = join(dir, 'term.html')
const data = readFileSync(bin).toString('base64')
const js = readFileSync(join(xterm, 'lib/xterm.js'), 'utf8')
const css = readFileSync(join(xterm, 'css/xterm.css'), 'utf8')
writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><style>${css} body{margin:0;background:#1e1e2e} #t{padding:12px;display:inline-block} .xterm-rows span,.xterm-rows div{unicode-bidi:bidi-override;direction:ltr}</style></head><body><div id="t"></div><script>${js}</script><script>
const term = new Terminal({ cols: ${cols}, rows: ${rows}, fontFamily: 'Menlo, monospace', fontSize: 14, theme: { background: '#1e1e2e' }, allowProposedApi: true })
term.open(document.getElementById('t'))
term.write(Uint8Array.from(atob('${data}'), c => c.charCodeAt(0)))
</script></body></html>`)
execFileSync(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${join(dir, 'profile')}`, '--hide-scrollbars', `--window-size=${Number(cols) * 9 + 30},${Number(rows) * 16 + 130}`, '--virtual-time-budget=4000', `--screenshot=${png}`, `file://${html}`], { stdio: 'ignore', timeout: 60000 })
console.log(png)
