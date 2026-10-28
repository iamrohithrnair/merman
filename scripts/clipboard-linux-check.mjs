import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { load } from './load.mjs'

const stop = async child => {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return
  const exited = new Promise(resolve => child.once('exit', resolve))
  child.kill()
  const deadline = globalThis.setTimeout(() => child.kill('SIGKILL'), 1000)
  try {
    await exited
  } finally {
    clearTimeout(deadline)
  }
}

assert.equal(process.platform, 'linux')
assert.ok(process.env.DISPLAY, 'Run under xvfb-run to isolate the X11 clipboard')
const { clipboardCommand } = await load()
const scratch = mkdtempSync(join(tmpdir(), 'merman-wayland-'))
const config = join(scratch, 'sway.conf')
writeFileSync(config, 'xwayland disable\nseat seat0 fallback true\n')
const env = { ...process.env, XDG_RUNTIME_DIR: scratch, WLR_BACKENDS: 'headless', WLR_RENDERER: 'pixman', WLR_LIBINPUT_NO_DEVICES: '1' }
delete env.WAYLAND_DISPLAY
const compositor = spawn('sway', ['--config', config], { env, stdio: ['ignore', 'ignore', 'pipe'] })
let diagnostics = ''
compositor.stderr.on('data', data => { diagnostics += data })
compositor.on('error', error => { diagnostics += error.message })

try {
  for (let attempt = 0; attempt < 100; attempt++) {
    const socket = readdirSync(scratch, { withFileTypes: true }).find(entry => entry.isSocket() && entry.name.startsWith('wayland-'))
    if (socket) {
      env.WAYLAND_DISPLAY = socket.name
      break
    }
    if (compositor.exitCode !== null || compositor.signalCode !== null) throw new Error(diagnostics)
    await setTimeout(100)
  }
  assert.ok(env.WAYLAND_DISPLAY, `Wayland did not start: ${diagnostics}`)
  const html = `<table><tr><th>Name</th></tr>${'<tr><td>Żółć &amp; שלום 中文</td></tr>'.repeat(3000)}</table>`
  const text = `Name\n${'Żółć & שלום 中文\n'.repeat(3000)}`
  for (const backend of ['wayland', 'x11']) {
    console.log(`${backend}: starting CopyQ`)
    const session = {
      ...env,
      QT_QPA_PLATFORM: backend === 'wayland' ? 'wayland' : 'xcb',
      XDG_SESSION_TYPE: backend,
      XDG_CONFIG_HOME: join(scratch, backend),
      COPYQ_SESSION_NAME: `test-${backend}`,
    }
    if (backend === 'x11') delete session.WAYLAND_DISPLAY
    else delete session.DISPLAY
    const server = spawn('copyq', [], { env: session, stdio: ['ignore', 'ignore', 'pipe'] })
    let serverDiagnostics = ''
    server.stderr.on('data', data => { serverDiagnostics += data })
    server.on('error', error => { serverDiagnostics += error.message })
    try {
      let ready = false
      for (let attempt = 0; attempt < 100; attempt++) {
        if (server.exitCode !== null || server.signalCode !== null) break
        const ping = spawnSync('copyq', ['eval', '1'], { env: session, encoding: 'utf8', timeout: 1000, killSignal: 'SIGKILL' })
        if (ping.status === 0) {
          ready = true
          break
        }
        await setTimeout(100)
      }
      assert.ok(ready, `CopyQ did not start on ${backend}: ${serverDiagnostics}`)
      console.log(`${backend}: copying both formats`)
      const command = clipboardCommand('linux', html, text)
      const copy = spawnSync(command.argv[0], command.argv.slice(1), { input: command.stdin, env: session, encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL' })
      assert.equal(copy.status, 0, copy.error?.message || copy.stderr || command.failure)
      for (let attempt = 0; attempt < 2; attempt++) {
        for (const [mime, expected] of [['text/html', html], ['text/plain', text]]) {
          console.log(`${backend}: reading ${mime}, attempt ${attempt + 1}`)
          const paste = backend === 'wayland'
            ? ['wl-paste', '--type', mime, '--no-newline']
            : ['xclip', '-selection', 'clipboard', '-target', mime, '-out']
          const result = spawnSync(paste[0], paste.slice(1), { env: session, encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL' })
          assert.equal(result.status, 0, result.error?.message || result.stderr)
          assert.equal(result.stdout, expected)
        }
      }
      console.log(`${backend}: distinct Unicode HTML and plain text survive two pastes after the copy command exits`)
    } finally {
      await stop(server)
    }
  }
} finally {
  await stop(compositor)
  rmSync(scratch, { recursive: true, force: true })
}
