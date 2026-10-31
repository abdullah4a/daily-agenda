import { describe, expect, it } from 'vitest'
import {
  isValidDateString,
  isValidTime,
  isValidTimezone,
  localDateString,
  minutesBetween,
  parseTime,
  timeToMinutes,
} from '../server/utils/date'

describe('isValidTimezone', () => {
  it('accepts IANA names and rejects anything else', () => {
    expect(isValidTimezone('UTC')).toBe(true)
    expect(isValidTimezone('Asia/Karachi')).toBe(true)
    expect(isValidTimezone('Mars/Base')).toBe(false)
    expect(isValidTimezone('')).toBe(false)
    expect(isValidTimezone(undefined)).toBe(false)
  })
})

describe('localDateString', () => {
  const instant = new Date('2026-03-01T22:30:00Z')

  it('returns the calendar date in the given timezone', () => {
    expect(localDateString('UTC', instant)).toBe('2026-03-01')
    expect(localDateString('Asia/Tokyo', instant)).toBe('2026-03-02')
    expect(localDateString('America/Los_Angeles', new Date('2026-01-01T03:00:00Z'))).toBe('2025-12-31')
  })

  it('throws on an invalid timezone', () => {
    expect(() => localDateString('Mars/Base', instant)).toThrow(RangeError)
  })
})

describe('isValidDateString', () => {
  it('requires a real calendar date', () => {
    expect(isValidDateString('2028-02-29')).toBe(true)
    expect(isValidDateString('2026-02-29')).toBe(false)
    expect(isValidDateString('2026-13-01')).toBe(false)
    expect(isValidDateString('2026-3-1')).toBe(false)
  })
})

describe('time parsing', () => {
  it('parses strict HH:mm', () => {
    expect(parseTime('09:05')).toEqual({ hours: 9, minutes: 5 })
    expect(parseTime('23:59')).toEqual({ hours: 23, minutes: 59 })
    expect(isValidTime('00:00')).toBe(true)
  })

  it.each(['24:00', '9:05', '12:60', '12:00:00', ''])('rejects %j', (value) => {
    expect(parseTime(value)).toBeNull()
    expect(isValidTime(value)).toBe(false)
    expect(() => timeToMinutes(value)).toThrow(RangeError)
  })

  it('converts to minutes since midnight', () => {
    expect(timeToMinutes('01:30')).toBe(90)
  })
})

describe('minutesBetween', () => {
  it('measures forward, wrapping past midnight', () => {
    expect(minutesBetween('09:00', '10:30')).toBe(90)
    expect(minutesBetween('23:00', '01:00')).toBe(120)
    expect(minutesBetween('12:00', '12:00')).toBe(0)
  })
})
