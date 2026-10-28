import type { On } from 'claude-code'

export const claudeAt = (on: On, base: string) => on('session.version', () => ({ value: { version: base, base } }))

export const linksHttp = (mounting: Promise<{ unmount: () => Promise<void> }>): Promise<boolean> =>
  mounting.then(async ui => (await ui.unmount(), true), () => false)
