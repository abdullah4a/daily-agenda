// Pure calendar helpers for the Insights week view (YYYY-MM-DD strings, computed in UTC to avoid drift).
const DAY_MS = 86_400_000
const toMs = (date: string) => Date.parse(`${date}T00:00:00Z`)
const toDate = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export interface DayInsight { date: string, productiveMinutes: number, done: number, skipped: number }
export interface InsightsResponse {
  from: string
  to: string
  days: DayInsight[]
  total: { productiveMinutes: number, done: number, skipped: number }
}

export function addDays(date: string, n: number): string {
  return toDate(toMs(date) + n * DAY_MS)
}

/** Monday of the week containing `date`. */
export function weekStart(date: string): string {
  const dow = new Date(toMs(date)).getUTCDay() // 0 = Sunday
  return addDays(date, -((dow + 6) % 7))
}

export function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

export function formatHoursSpoken(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  const parts = [h && `${h} hour${h === 1 ? '' : 's'}`, (m || !h) && `${m} minute${m === 1 ? '' : 's'}`]
  return parts.filter(Boolean).join(' ')
}

const utcFormat = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).format(new Date(toMs(date)))

export function formatWeekRange(start: string): string {
  const end = addDays(start, 6)
  const sameYear = start.slice(0, 4) === end.slice(0, 4)
  const from = utcFormat(start, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
  return `${from} – ${utcFormat(end, { month: 'short', day: 'numeric', year: 'numeric' })}`
}

export function dayLabel(date: string, style: 'short' | 'long' = 'short'): string {
  return utcFormat(date, { weekday: style })
}
