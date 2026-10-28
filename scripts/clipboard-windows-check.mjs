import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { load } from './load.mjs'

if (process.platform !== 'win32') {
  console.log('Skipped native clipboard bridge check: Windows required')
  process.exit(0)
}

const { parse, tableHtml, clipboardCommand, imageCommand } = await load()
const table = parse('| Name | Value |\n|--|--|\n| Żółć & שלום | ✅ 中文 |', { numbers: false, paths: false }).find(block => block.kind === 'table')
assert.ok(table)
const html = tableHtml(table)
const text = 'Name\tValue\nŻółć & שלום\t✅ 中文'
const command = clipboardCommand('windows', html, text, process.env.SystemRoot)
const write = spawnSync(command.argv[0], command.argv.slice(1), { input: command.stdin, encoding: 'utf8', timeout: 30000 })
assert.equal(write.status, 0, write.stderr || write.error?.message)

const read = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -Namespace Win32 -Name Clip -MemberDefinition '
[DllImport("user32.dll")] public static extern bool OpenClipboard(IntPtr owner);
[DllImport("user32.dll")] public static extern bool CloseClipboard();
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern uint RegisterClipboardFormat(string name);
[DllImport("user32.dll")] public static extern IntPtr GetClipboardData(uint format);
[DllImport("kernel32.dll")] public static extern IntPtr GlobalLock(IntPtr handle);
[DllImport("kernel32.dll")] public static extern bool GlobalUnlock(IntPtr handle);
[DllImport("kernel32.dll")] public static extern UIntPtr GlobalSize(IntPtr handle);
'
if (-not [Win32.Clip]::OpenClipboard([IntPtr]::Zero)) { throw 'Cannot open clipboard' }
try {
  $handle = [Win32.Clip]::GetClipboardData([Win32.Clip]::RegisterClipboardFormat('HTML Format'))
  if ($handle -eq [IntPtr]::Zero) { throw 'No HTML Format on clipboard' }
  $pointer = [Win32.Clip]::GlobalLock($handle)
  if ($pointer -eq [IntPtr]::Zero) { throw 'Cannot lock HTML Format' }
  try {
    $bytes = New-Object byte[] ([int][Win32.Clip]::GlobalSize($handle).ToUInt64())
    [Runtime.InteropServices.Marshal]::Copy($pointer, $bytes, 0, $bytes.Length)
  } finally {
    [void][Win32.Clip]::GlobalUnlock($handle)
  }
} finally {
  [void][Win32.Clip]::CloseClipboard()
}
$end = [Array]::IndexOf($bytes, [byte]0)
if ($end -ge 0) { [Array]::Resize([ref]$bytes, $end) }
[Console]::Out.WriteLine([Convert]::ToBase64String($bytes))
$utf8 = New-Object Text.UTF8Encoding($false)
[Console]::Out.WriteLine([Convert]::ToBase64String($utf8.GetBytes([string][System.Windows.Forms.Clipboard]::GetDataObject().GetData('UnicodeText'))))
`
const readback = spawnSync(command.argv[0], ['-NoProfile', '-NonInteractive', '-STA', '-Command', read], { encoding: 'utf8', timeout: 30000 })
assert.equal(readback.status, 0, readback.stderr || readback.error?.message)
const [cf, unicode] = readback.stdout.trim().split(/\r?\n/).map(line => Buffer.from(line, 'base64'))

const header = cf.toString('latin1', 0, cf.indexOf('<html'))
const offset = name => Number(new RegExp(`^${name}:(\\d+)\\r?$`, 'm').exec(header)?.[1])
const [startHtml, endHtml, startFragment, endFragment] = ['StartHTML', 'EndHTML', 'StartFragment', 'EndFragment'].map(offset)
const fragment = Buffer.from(html)
assert.equal(cf.toString('utf8', startHtml, startHtml + 6), '<html>')
assert.deepEqual(cf.subarray(startFragment, endFragment), fragment)
assert.ok(cf.subarray(0, startFragment).toString('utf8').endsWith('<!--StartFragment-->\n'))
assert.ok(cf.subarray(endFragment).toString('utf8').startsWith('\n<!--EndFragment-->'))
assert.ok(cf.subarray(startHtml, endHtml).toString('utf8').endsWith('</html>'))
assert.ok(cf.length === endHtml || (cf.length === endHtml + 1 && cf[endHtml] === 0))
for (const cell of ['Żółć', 'שלום', '✅', '中文']) assert.ok(cf.toString('utf8', startFragment, endFragment).includes(cell), `${cell} missing from clipboard`)
assert.equal(unicode.toString('utf8'), text.replace(/\n/g, '\r\n'))
console.log('Windows clipboard holds CF_HTML with byte offsets and CRLF Unicode text')

const image = imageCommand('windows', '┌──────┐\n│ 苹果 │\n└──────┘', { foreground: '#cdd6f4', background: '#1e1e2e' }, process.env.SystemRoot)
const drawn = spawnSync(image.argv[0], image.argv.slice(1), { input: image.stdin, encoding: 'utf8', timeout: 30000 })
assert.equal(drawn.status, 0, drawn.stderr || drawn.error?.message)
const look = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$picture = [System.Windows.Forms.Clipboard]::GetImage()
if (-not $picture) { throw 'No image on clipboard' }
$corner = $picture.GetPixel(0, 0)
[Console]::Out.WriteLine(($picture.Width, $picture.Height, $corner.R, $corner.G, $corner.B) -join ',')
`
const seen = spawnSync(image.argv[0], ['-NoProfile', '-NonInteractive', '-STA', '-Command', look], { encoding: 'utf8', timeout: 30000 })
assert.equal(seen.status, 0, seen.stderr || seen.error?.message)
const [wide, high, ...corner] = seen.stdout.trim().split(',').map(Number)
assert.ok(wide > 2 * 8 * 7 && high > 2 * 3 * 14, `image is ${wide}x${high}`)
assert.deepEqual(corner, [30, 30, 46])
console.log(`Windows image helper writes a ${wide}x${high} bitmap in the theme background`)

const blocks = imageCommand('windows', '█│\n█│\n█│', { foreground: '#cdd6f4', background: '#1e1e2e' }, process.env.SystemRoot)
const stacked = spawnSync(blocks.argv[0], blocks.argv.slice(1), { input: blocks.stdin, encoding: 'utf8', timeout: 30000 })
assert.equal(stacked.status, 0, stacked.stderr || stacked.error?.message)
const gaps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$picture = [System.Windows.Forms.Clipboard]::GetImage()
$pad = 32
$cell = ($picture.Width - 2 * $pad) / 2
$missing = foreach ($c in 0, 1) {
  $count = 0
  for ($y = $pad; $y -lt $picture.Height - $pad; $y++) {
    $any = $false
    for ($x = $pad + $c * $cell; $x -lt $pad + ($c + 1) * $cell; $x++) { if ($picture.GetPixel($x, $y).R -gt 128) { $any = $true; break } }
    if (-not $any) { $count++ }
  }
  $count
}
[Console]::Out.WriteLine($missing -join ',')
`
const holes = spawnSync(blocks.argv[0], ['-NoProfile', '-NonInteractive', '-STA', '-Command', gaps], { encoding: 'utf8', timeout: 60000 })
assert.equal(holes.status, 0, holes.stderr || holes.error?.message)
assert.equal(holes.stdout.trim(), '0,0', `pixel rows without █ or │ ink: ${holes.stdout.trim()}`)
console.log('Stacked █ and │ glyphs touch from row to row in the Windows bitmap')
