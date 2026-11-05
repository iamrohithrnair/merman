import type { Clock } from './theme'

export type Sent = { text: string; at: number }

const KEEP = 500
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const two = (n: number) => String(n).padStart(2, '0')

type Parts = { year: number; month: number; day: number; hour: number; minute: number }

const zoned = new Map<string, Intl.DateTimeFormat | null>()

const formatFor = (zone: string): Intl.DateTimeFormat | null => {
  if (!zoned.has(zone)) {
    try {
      zoned.set(zone, new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }))
    } catch {
      zoned.set(zone, null)
    }
  }
  return zoned.get(zone) ?? null
}

export const isTimeZone = (zone: string): boolean => zone !== '' && formatFor(zone) !== null

const partsOf = (at: number, zone: string): Parts => {
  const format = zone ? formatFor(zone) : null
  if (!format) {
    const d = new Date(at)
    return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate(), hour: d.getHours(), minute: d.getMinutes() }
  }
  const part = Object.fromEntries(format.formatToParts(new Date(at)).map(p => [p.type, Number(p.value)]))
  return { year: part.year!, month: part.month! - 1, day: part.day!, hour: part.hour! % 24, minute: part.minute! }
}

export const clockText = (at: number, now: number, clock: Clock, zone = ''): string => {
  const d = partsOf(at, zone)
  const h = d.hour
  const time = clock === '12h' ? `${h % 12 === 0 ? 12 : h % 12}:${two(d.minute)} ${h < 12 ? 'AM' : 'PM'}` : `${two(h)}:${two(d.minute)}`
  const today = partsOf(now, zone)
  const isToday = d.year === today.year && d.month === today.month && d.day === today.day
  return isToday ? time : `${MONTHS[d.month]} ${d.day} ${time}`
}

export const promptKey = (text: string) => text.trim().replace(/\s+/g, ' ').slice(0, 300)

export const withRecord = <T>(list: readonly T[], record: T): T[] => [...list, record].slice(-KEEP)

export const sentAt = (sent: readonly Sent[], text: string, drawnAt: number): number | undefined => {
  const key = promptKey(text)
  return sent.findLast(one => one.text === key && one.at <= drawnAt)?.at
}
