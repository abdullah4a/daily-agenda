// Pure time helpers for the Today page. No Nuxt or DOM imports so they are unit-testable.

export interface DayBlock {
  id: string
  label: string
  start: string
  end: string
  productive: boolean
}

export type DayPeriod = 'morning' | 'evening' | 'late-night'
export type BlockStatus = 'past' | 'current' | 'upcoming'

export interface ZonedClock {
  /** YYYY-MM-DD in the timezone */
  date: string
  /** Minutes since local midnight, including a seconds fraction */
  minutes: number
}

const DAY = 24 * 60

export function resolveTimezone(timezone: string | null | undefined): string | undefined {
  if (!timezone) return undefined
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return timezone
  }
  catch {
    return undefined
  }
}

export function zonedClock(timezone: string | null | undefined, at: Date = new Date()): ZonedClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: resolveTimezone(timezone),
    calendar: 'gregory',
    numberingSystem: 'latn',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at)
  const n = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0)
  const pad = (v: number) => String(v).padStart(2, '0')
  return {
    date: `${String(n('year')).padStart(4, '0')}-${pad(n('month'))}-${pad(n('day'))}`,
    minutes: (n('hour') % 24) * 60 + n('minute') + n('second') / 60,
  }
}

/** Dates roll at local midnight. Morning is 04:00 to 16:00, evening to 24:00, then a quiet late night. */
export function periodAt(minutes: number): DayPeriod {
  if (minutes < 4 * 60) return 'late-night'
  return minutes < 16 * 60 ? 'morning' : 'evening'
}

export interface DayEntry {
  date: string
  morningAnswer: string
  eveningAnswer: string
  morningAnswerAt: string | null
  eveningAnswerAt: string | null
  updatedAt: string | null
}

export function blankEntry(date: string): DayEntry {
  return { date, morningAnswer: '', eveningAnswer: '', morningAnswerAt: null, eveningAnswerAt: null, updatedAt: null }
}

/**
 * A read can hold an older day than the one it is now, however it got here (a cached copy, a slow
 * network, a page left open). Such a day must never be edited as current, so it becomes a blank
 * one for today. Dates are YYYY-MM-DD, so they compare as strings.
 */
export function resolveDay<R extends { entry: DayEntry, blockStatuses?: unknown[] }>(read: R, today: string): R & { stale: boolean } {
  if (read.entry.date >= today) return { ...read, stale: false }
  return { ...read, entry: blankEntry(today), blockStatuses: [], stale: true }
}

/** True if the device is in a different zone from the saved one. Aliases of one zone count as equal. */
export function zonesDiffer(device: string | null | undefined, saved: string | null | undefined): boolean {
  const deviceZone = resolveTimezone(device)
  const savedZone = resolveTimezone(saved)
  if (!deviceZone || !savedZone) return false
  const canonical = (zone: string) => new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone
  return canonical(deviceZone) !== canonical(savedZone)
}

export function toMin(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

export function blockLengthMinutes(block: Pick<DayBlock, 'start' | 'end'>): number {
  return (toMin(block.end) - toMin(block.start) + DAY) % DAY || DAY
}

export function blockState(block: Pick<DayBlock, 'start' | 'end'>, minutes: number) {
  const start = toMin(block.start)
  const length = blockLengthMinutes(block)
  const elapsed = (minutes - start + DAY) % DAY
  if (elapsed < length) {
    return { status: 'current' as BlockStatus, progress: elapsed / length, remaining: length - elapsed }
  }
  const overnight = toMin(block.end) <= start
  const status: BlockStatus = !overnight && minutes >= toMin(block.end) ? 'past' : 'upcoming'
  return { status, progress: status === 'past' ? 1 : 0, remaining: 0 }
}

export function sortBlocks<T extends Pick<DayBlock, 'start'>>(blocks: T[]): T[] {
  return [...blocks].sort((a, b) => toMin(a.start) - toMin(b.start))
}

export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.ceil(minutes))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h && m) return `${h}h ${m}m`
  return h ? `${h}h` : `${m}m`
}

export function formatClock(time: string): string {
  const [h, m] = time.split(':').map(Number)
  const hour = (h ?? 0) % 12 || 12
  return `${hour}:${String(m ?? 0).padStart(2, '0')} ${(h ?? 0) < 12 ? 'AM' : 'PM'}`
}
