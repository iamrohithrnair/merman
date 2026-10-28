import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { mock } from 'claude-code/testing'

export const clipboardEnv = (on: On, platform: 'macos' | 'other', environment: Record<string, string> = {}) => {
  mock.env(on, environment)
  on('fs.stat', (_, e, next) => !e.path.replace(/\\/g, '/').endsWith('/usr/bin/osascript')
    ? next(e)
    : platform === 'macos'
      ? { value: { kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false } }
      : { deny: 'Not macOS' })
}

export const startSession = async ($: Engine, on: On) => {
  on('session.start', () => ({ cwd: '/tmp' }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
}

export const runResult = (exitCode: number, stderr = '') =>
  ({ value: { exitCode, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false } })

export const recordCopies = (on: On) => {
  const copies: string[] = []
  on('ui.copy', (_, e) => {
    copies.push(e.text)
    return { value: { isCopied: true as const } }
  })
  return copies
}

export const recordToasts = (on: On) => {
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  return toasts
}
