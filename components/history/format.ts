/** Formats a YYYY-MM-DD calendar date without timezone drift (parsed and printed in UTC). */
export function formatDay(date: string) {
  const d = new Date(`${date}T00:00:00Z`)
  const fmt = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).format(d)
  return {
    month: fmt({ month: 'short' }),
    day: fmt({ day: 'numeric' }),
    weekday: fmt({ weekday: 'long' }),
    year: fmt({ year: 'numeric' }),
    long: fmt({ weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
  }
}

export function preview(text: string, max = 180): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}...` : flat
}
