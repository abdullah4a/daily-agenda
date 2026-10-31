const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MINUTES_PER_DAY = 24 * 60

export function isValidTimezone(timezone: unknown): timezone is string {
  if (typeof timezone !== 'string' || timezone === '') return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return true
  }
  catch {
    return false
  }
}

/** Calendar date (YYYY-MM-DD) in an IANA timezone. Throws RangeError on an invalid timezone. */
export function localDateString(timezone: string, at: Date = new Date()): string {
  if (!isValidTimezone(timezone)) throw new RangeError(`Invalid timezone: ${timezone}`)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at)
  const part = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`
}

/** True only for a real calendar date, so 2026-02-30 is rejected. */
export function isValidDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
}

export function isValidTime(value: unknown): value is string {
  return typeof value === 'string' && TIME_PATTERN.test(value)
}

/** Parses a strict 24-hour HH:mm string; returns null when malformed. */
export function parseTime(value: string): { hours: number, minutes: number } | null {
  const match = TIME_PATTERN.exec(value)
  if (!match) return null
  return { hours: Number(match[1]), minutes: Number(match[2]) }
}

/** Minutes since midnight. Throws RangeError on a malformed time. */
export function timeToMinutes(value: string): number {
  const parsed = parseTime(value)
  if (!parsed) throw new RangeError(`Invalid time: ${value}`)
  return parsed.hours * 60 + parsed.minutes
}

/**
 * Forward distance from start to end. An end earlier than start is treated as
 * the next day, so 23:00 to 01:00 is 120. Equal times give 0.
 */
export function minutesBetween(start: string, end: string): number {
  const diff = timeToMinutes(end) - timeToMinutes(start)
  return diff < 0 ? diff + MINUTES_PER_DAY : diff
}
