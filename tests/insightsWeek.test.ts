import { describe, expect, it } from 'vitest'
import { addDays, formatHours, formatWeekRange, weekStart } from '../components/insights/week'

describe('insights week helpers', () => {
  it('finds the Monday of a week', () => {
    expect(weekStart('2026-10-31')).toBe('2026-10-26') // Saturday
    expect(weekStart('2026-10-26')).toBe('2026-10-26')
    expect(weekStart('2026-11-01')).toBe('2026-10-26') // Sunday
  })
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-12-28', 7)).toBe('2027-01-04')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('formats hours and ranges', () => {
    expect(formatHours(0)).toBe('0m')
    expect(formatHours(90)).toBe('1h 30m')
    expect(formatHours(120)).toBe('2h')
    expect(formatWeekRange('2026-10-26')).toBe('Oct 26 – Nov 1, 2026')
  })
})
