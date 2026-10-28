import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { load } from './load.mjs'

if (process.platform !== 'darwin') {
  console.log('Skipped native clipboard bridge check: macOS required')
  process.exit(0)
}

const { MAC_TABLE_COPY, MAC_IMAGE_COPY, imageCommand } = await load()
const payload = {
  html: '<table><tr><th>Name</th></tr><tr><td>Żółć &amp; שלום</td></tr></table>',
  text: 'Name\nŻółć & שלום\t中文',
}
const bridge = `
ObjC.import('AppKit')
var received = $.NSMutableArray.alloc.init
var testPasteboard = {
  writeObjects: function(objects) {
    received.addObjectsFromArray(objects)
    if (Number(received.count) !== 1 || !received.objectAtIndex(0).isKindOfClass($.NSPasteboardItem)) throw new Error('Expected a native NSPasteboardItem')
    return true
  },
  stringForType: function(type) { return received.objectAtIndex(0).stringForType(type) }
}
`
const helper = MAC_TABLE_COPY.replace('$.NSPasteboard.generalPasteboard', 'testPasteboard')
assert.notEqual(helper, MAC_TABLE_COPY)
const result = spawnSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', bridge + helper], {
  input: JSON.stringify(payload), encoding: 'utf8', timeout: 5000,
})
assert.equal(result.status, 0, result.stderr || result.error?.message)
const broken = spawnSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', bridge + helper.replace('$.NSArray.arrayWithObject(item)', '[item]')], {
  input: JSON.stringify(payload), encoding: 'utf8', timeout: 5000,
})
assert.notEqual(broken.status, 0)
assert.match(broken.stderr, /Expected a native NSPasteboardItem/)
console.log('Native clipboard bridge preserves NSPasteboardItem and both Unicode formats; implicit JavaScript arrays are rejected')

const image = imageCommand('macos', '┌──────┐\n│ 苹果 │\n└──────┘', { foreground: '#cdd6f4', background: '#1e1e2e' })
const imageBridge = `
ObjC.import('AppKit')
var stored = null
var testPasteboard = { clearContents: true, setDataForType: function(data, type) { stored = data; return ObjC.unwrap(type) === ObjC.unwrap($.NSPasteboardTypePNG) }, dataForType: function() { return stored } }
`
const imageHelper = MAC_IMAGE_COPY.replace('$.NSPasteboard.generalPasteboard', 'testPasteboard')
assert.notEqual(imageHelper, MAC_IMAGE_COPY)
const probe = `
var rep = $.NSBitmapImageRep.imageRepWithData(stored)
var corner = rep.colorAtXY(0, 0)
;[rep.pixelsWide, rep.pixelsHigh, Math.round(corner.redComponent * 255), Math.round(corner.greenComponent * 255), Math.round(corner.blueComponent * 255)].join(',')
`
const drawn = spawnSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', imageBridge + imageHelper + probe], { input: image.stdin, encoding: 'utf8', timeout: 5000 })
assert.equal(drawn.status, 0, drawn.stderr || drawn.error?.message)
const [wide, high, ...corner] = drawn.stdout.trim().split(',').map(Number)
assert.ok(wide > 2 * 8 * 8 && high > 2 * 3 * 14, `image is ${wide}x${high}`)
assert.deepEqual(corner, [30, 30, 46])
console.log(`Native image helper writes a ${wide}x${high} PNG in the theme background`)

const gaps = `
var rep = $.NSBitmapImageRep.imageRepWithData(stored)
var lit = function (x, y) { return rep.colorAtXY(x, y).redComponent > 0.5 }
var missing = [0, 1].map(function (c) {
  var count = 0
  for (var y = 2 * pad; y < 2 * (height - pad); y++) {
    var any = false
    for (var x = Math.ceil(2 * (pad + c * cell)); x < Math.floor(2 * (pad + (c + 1) * cell)); x++) if (lit(x, y)) { any = true; break }
    if (!any) count++
  }
  return count
})
missing.join(',')
`
const blocks = spawnSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', imageBridge + imageHelper + gaps], { input: imageCommand('macos', '█│\n█│\n█│', { foreground: '#cdd6f4', background: '#1e1e2e' }).stdin, encoding: 'utf8', timeout: 5000 })
assert.equal(blocks.status, 0, blocks.stderr || blocks.error?.message)
assert.equal(blocks.stdout.trim(), '0,0', `pixel rows without █ or │ ink: ${blocks.stdout.trim()}`)
console.log('Stacked █ and │ glyphs touch from row to row in the PNG')
