import type { Clock } from './theme'

export type Sent = { text: string; at: number }

const KEEP = 500
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const two = (n: number) => String(n).padStart(2, '0')

const timeText = (h: number, m: number, clock: Clock): string =>
  clock === '12h' ? `${h % 12 || 12}:${two(m)} ${h < 12 ? 'AM' : 'PM'}` : `${two(h)}:${two(m)}`

export const clockZone = (value: unknown): Intl.DateTimeFormat | undefined => {
  const timeZone = typeof value === 'string' ? value.trim() : ''
  if (!timeZone) return undefined
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
  } catch {
    return undefined
  }
}

const zonedParts = (zone: Intl.DateTimeFormat, at: number) => {
  const parts = { year: 0, month: 0, day: 0, hour: 0, minute: 0 }
  for (const { type, value } of zone.formatToParts(at)) {
    if (type in parts) parts[type as keyof typeof parts] = Number(value)
  }
  return parts
}

export const clockText = (at: number, now: number, clock: Clock, zone?: Intl.DateTimeFormat): string => {
  if (zone) {
    const d = zonedParts(zone, at)
    const today = zonedParts(zone, now)
    const time = timeText(d.hour, d.minute, clock)
    return d.year === today.year && d.month === today.month && d.day === today.day ? time : `${MONTHS[d.month - 1]} ${d.day} ${time}`
  }
  const d = new Date(at)
  const time = timeText(d.getHours(), d.getMinutes(), clock)
  const today = new Date(now)
  const isToday = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate()
  return isToday ? time : `${MONTHS[d.getMonth()]} ${d.getDate()} ${time}`
}

export const promptKey = (text: string) => text.trim().replace(/\s+/g, ' ').slice(0, 300)

export const withRecord = <T>(list: readonly T[], record: T): T[] => [...list, record].slice(-KEEP)

export const sentAt = (sent: readonly Sent[], text: string, drawnAt: number): number | undefined => {
  const key = promptKey(text)
  return sent.findLast(one => one.text === key && one.at <= drawnAt)?.at
}
