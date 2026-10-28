import { ratexColor } from './latex'
import { cells, width } from './render'
import { holdVisual } from './rtl'

export const MAC_TABLE_COPY = `
ObjC.import('AppKit')
var input = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile
var payload = JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(input, $.NSUTF8StringEncoding)))
var item = $.NSPasteboardItem.alloc.init
if (!item.setStringForType(payload.html, $.NSPasteboardTypeHTML) ||
    !item.setStringForType(payload.text, $.NSPasteboardTypeString)) throw new Error('Cannot encode table')
var pasteboard = $.NSPasteboard.generalPasteboard
if (!pasteboard || !pasteboard.writeObjects) throw new Error('macOS clipboard is unavailable to this session')
pasteboard.clearContents
if (!pasteboard.writeObjects($.NSArray.arrayWithObject(item))) throw new Error('Cannot write clipboard')
if (ObjC.unwrap(pasteboard.stringForType($.NSPasteboardTypeHTML)) !== payload.html ||
    ObjC.unwrap(pasteboard.stringForType($.NSPasteboardTypeString)) !== payload.text) throw new Error('Clipboard verification failed')
`

export const LINUX_TABLE_COPY = `
var table = JSON.parse(str(arguments[1]))
copy('text/html', table.html, 'text/plain', table.text)
if (str(clipboard('text/html')) !== table.html ||
    str(clipboard('text/plain')) !== table.text) throw new Error('Clipboard verification failed')
`

export const WIN_TABLE_COPY = `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Windows.Forms
  $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $utf8 = New-Object Text.UTF8Encoding($false)
  $fragment = [string]$payload.html
  $lf = [string][char]10
  $crlf = [string][char]13 + $lf
  $template = 'Version:1.0' + $crlf + 'StartHTML:{0:D10}' + $crlf + 'EndHTML:{1:D10}' + $crlf + 'StartFragment:{2:D10}' + $crlf + 'EndFragment:{3:D10}' + $crlf
  $headerLen = $utf8.GetByteCount(($template -f 0, 0, 0, 0))
  $prefix = '<html>' + $lf + '<head>' + $lf + '<meta charset="utf-8">' + $lf + '</head>' + $lf + '<body>' + $lf + '<!--StartFragment-->' + $lf
  $suffix = $lf + '<!--EndFragment-->' + $lf + '</body>' + $lf + '</html>'
  $startFragment = $headerLen + $utf8.GetByteCount($prefix)
  $endFragment = $startFragment + $utf8.GetByteCount($fragment)
  $endHtml = $endFragment + $utf8.GetByteCount($suffix)
  $cf = ($template -f $headerLen, $endHtml, $startFragment, $endFragment) + $prefix + $fragment + $suffix
  $data = New-Object System.Windows.Forms.DataObject
  $data.SetData('HTML Format', (New-Object IO.MemoryStream(, [byte[]]($utf8.GetBytes($cf) + [byte]0))))
  $data.SetData([System.Windows.Forms.DataFormats]::UnicodeText, [string]$payload.text)
  [System.Windows.Forms.Clipboard]::SetDataObject($data, $true)
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
`

export const MAC_IMAGE_COPY = `
ObjC.import('AppKit')
var input = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile
var payload = JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(input, $.NSUTF8StringEncoding)))
var rgb = function (c) { return $.NSColor.colorWithSRGBRedGreenBlueAlpha(c[0] / 255, c[1] / 255, c[2] / 255, 1) }
var font = $.NSFont.fontWithNameSize('Menlo', 14)
if (!font) font = $.NSFont.monospacedSystemFontOfSizeWeight(14, 0)
var attributes = $.NSMutableDictionary.dictionary
attributes.setObjectForKey(font, $.NSFontAttributeName)
attributes.setObjectForKey(rgb(payload.foreground), $.NSForegroundColorAttributeName)
var pad = 16
var cell = Math.round($('M').sizeWithAttributes(attributes).width * 2) / 2
var line = Math.ceil(font.ascender - font.descender + font.leading)
var baseline = (line - font.ascender + font.descender) / 2 - font.descender
var block = $('█').boundingRectWithSizeOptionsAttributes($.NSMakeSize(1000, 1000), 8, attributes)
var width = 2 * pad + Math.ceil(cell * payload.columns)
var height = 2 * pad + line * payload.lines.length
var bitmap = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(null, width * 2, height * 2, 8, 4, true, false, $.NSDeviceRGBColorSpace, 0, 0)
if (!bitmap) throw new Error('Cannot draw image')
bitmap.size = $.NSMakeSize(width, height)
$.NSGraphicsContext.saveGraphicsState
$.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(bitmap))
rgb(payload.background).setFill
$.NSRectFill($.NSMakeRect(0, 0, width, height))
payload.lines.forEach(function (glyphs, i) {
  var bottom = height - pad - (i + 1) * line
  glyphs.forEach(function (g) {
    var x = pad + g.at * cell
    if (!/^[─-▟]$/.test(g.text)) return $(g.text).drawWithRectOptionsAttributes($.NSMakeRect(x, bottom + baseline, 1000, 1000), 0, attributes)
    $.NSGraphicsContext.saveGraphicsState
    $.NSRectClip($.NSMakeRect(x, bottom, cell, line))
    var fit = $.NSAffineTransform.transform
    fit.translateXByYBy(x, bottom)
    fit.scaleXByYBy(cell / block.size.width, line / block.size.height)
    fit.translateXByYBy(-block.origin.x, -block.origin.y)
    fit.concat
    $(g.text).drawWithRectOptionsAttributes($.NSMakeRect(0, 0, 1000, 1000), 0, attributes)
    $.NSGraphicsContext.restoreGraphicsState
  })
})
$.NSGraphicsContext.restoreGraphicsState
var png = bitmap.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $.NSDictionary.dictionary)
var pasteboard = $.NSPasteboard.generalPasteboard
if (!png || !pasteboard) throw new Error('macOS clipboard is unavailable to this session')
pasteboard.clearContents
if (!pasteboard.setDataForType(png, $.NSPasteboardTypePNG)) throw new Error('Cannot write clipboard')
var back = pasteboard.dataForType($.NSPasteboardTypePNG)
if (!back || !back.isEqualToData(png)) throw new Error('Clipboard verification failed')
`

export const WIN_IMAGE_COPY = `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $fg = [System.Drawing.Color]::FromArgb($payload.foreground[0], $payload.foreground[1], $payload.foreground[2])
  $bg = [System.Drawing.Color]::FromArgb($payload.background[0], $payload.background[1], $payload.background[2])
  $font = New-Object System.Drawing.Font('Consolas', 28, [System.Drawing.GraphicsUnit]::Pixel)
  $flags = [System.Windows.Forms.TextFormatFlags]::NoPadding -bor [System.Windows.Forms.TextFormatFlags]::NoPrefix -bor [System.Windows.Forms.TextFormatFlags]::SingleLine
  $cell = [Math]::Round([System.Windows.Forms.TextRenderer]::MeasureText('MMMMMMMMMM', $font, (New-Object System.Drawing.Size(0, 0)), $flags).Width / 10)
  $line = $font.Height
  $pad = 32
  $origin = New-Object System.Drawing.PointF(0, 0)
  $typographic = [System.Drawing.StringFormat]::GenericTypographic
  $probe = New-Object System.Drawing.Drawing2D.GraphicsPath
  $probe.AddString([string][char]0x2588, $font.FontFamily, 0, $font.Size, $origin, $typographic)
  $block = $probe.GetBounds()
  $brush = New-Object System.Drawing.SolidBrush($fg)
  $bitmap = New-Object System.Drawing.Bitmap([int](2 * $pad + $cell * $payload.columns), [int](2 * $pad + $line * $payload.lines.Count))
  $bitmap.SetResolution(192, 192)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.Clear($bg)
  for ($i = 0; $i -lt $payload.lines.Count; $i++) {
    foreach ($g in $payload.lines[$i]) {
      $x = $pad + $g.at * $cell
      $y = $pad + $i * $line
      if ($g.text -notmatch '^[\u2500-\u259f]$') {
        [System.Windows.Forms.TextRenderer]::DrawText($graphics, [string]$g.text, $font, (New-Object System.Drawing.Point($x, $y)), $fg, $bg, $flags)
        continue
      }
      $path = New-Object System.Drawing.Drawing2D.GraphicsPath
      $path.AddString([string]$g.text, $font.FontFamily, 0, $font.Size, $origin, $typographic)
      $fit = New-Object System.Drawing.Drawing2D.Matrix
      $fit.Translate($x, $y)
      $fit.Scale($cell / $block.Width, $line / $block.Height)
      $fit.Translate(-$block.X, -$block.Y)
      $path.Transform($fit)
      $graphics.SetClip((New-Object System.Drawing.Rectangle($x, $y, $cell, $line)))
      $graphics.FillPath($brush, $path)
      $graphics.ResetClip()
    }
  }
  $graphics.Dispose()
  [System.Windows.Forms.Clipboard]::SetImage($bitmap)
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
`

export type ClipboardBackend = 'macos' | 'linux' | 'windows'

const ascii = (json: string): string =>
  Array.from({ length: json.length }, (_, i) => {
    const unit = json.charCodeAt(i)
    return unit > 0x7e ? `\\u${unit.toString(16).padStart(4, '0')}` : json[i]
  }).join('')

const powershell = (systemRoot: string | undefined, script: string) =>
  [`${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`, '-NoProfile', '-NonInteractive', '-STA', '-Command', script]

export type HelperCommand = { stdin: string; argv: string[]; failure: string }

export const clipboardCommand = (backend: ClipboardBackend, html: string, text: string, systemRoot?: string): HelperCommand => backend === 'windows'
  ? {
    stdin: ascii(JSON.stringify({ html, text: text.replace(/\r?\n/g, '\r\n') })),
    argv: powershell(systemRoot, WIN_TABLE_COPY),
    failure: 'Windows clipboard helper failed',
  }
  : {
    stdin: JSON.stringify({ html, text }),
    ...backend === 'macos'
      ? { argv: ['/usr/bin/osascript', '-l', 'JavaScript', '-e', MAC_TABLE_COPY], failure: 'macOS clipboard helper failed' }
      : { argv: ['copyq', 'eval', LINUX_TABLE_COPY, '-'], failure: 'CopyQ failed; install and start CopyQ in the graphical session' },
  }

export const drawsImages = (backend: ClipboardBackend | null): boolean => backend === 'macos' || backend === 'windows'

const rgbOf = (color: string | undefined, fallback: number[]): number[] => {
  const c = color === undefined ? '' : ratexColor(color)
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c)
  const hex = short ? `#${short[1]!.repeat(2)}${short[2]!.repeat(2)}${short[3]!.repeat(2)}` : c
  return /^#[0-9a-f]{6}$/i.test(hex) ? [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) : fallback
}

export const imageLines = (text: string): { at: number; text: string }[][] =>
  text.split('\n').map(line => holdVisual(cells(line)).cells.flatMap((g, at) => (g.trim() ? [{ at, text: g }] : [])))

const luma = ([r, g, b]: number[]): number => (0.299 * r! + 0.587 * g! + 0.114 * b!) / 255

const readable = (foreground: number[], background: number[]): number[] =>
  Math.abs(luma(foreground) - luma(background)) >= 0.4 ? foreground : luma(background) > 0.5 ? [0, 0, 0] : [255, 255, 255]

export const imageCommand = (backend: ClipboardBackend, text: string, colors: { foreground?: string; background?: string }, systemRoot?: string): HelperCommand => {
  const lines = imageLines(text)
  const background = rgbOf(colors.background, [255, 255, 255])
  const json = JSON.stringify({ lines, columns: Math.max(0, ...text.split('\n').map(width)), foreground: readable(rgbOf(colors.foreground, [0, 0, 0]), background), background })
  return backend === 'windows'
    ? { stdin: ascii(json), argv: powershell(systemRoot, WIN_IMAGE_COPY), failure: 'Windows image helper failed' }
    : { stdin: json, argv: ['/usr/bin/osascript', '-l', 'JavaScript', '-e', MAC_IMAGE_COPY], failure: 'macOS image helper failed' }
}
