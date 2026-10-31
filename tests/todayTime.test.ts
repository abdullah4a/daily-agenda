import { describe, expect, it } from 'vitest'
import { blankEntry, blockState, formatClock, formatDuration, periodAt, resolveDay, sortBlocks, zonedClock, zonesDiffer } from '../composables/todayTime'

describe('periodAt', () => {
  it('picks morning from 04:00, evening from 16:00, and nothing after midnight', () => {
    expect(periodAt(4 * 60)).toBe('morning')
    expect(periodAt(15 * 60 + 59)).toBe('morning')
    expect(periodAt(16 * 60)).toBe('evening')
    expect(periodAt(23 * 60 + 59)).toBe('evening')
    expect(periodAt(0)).toBe('late-night')
    expect(periodAt(3 * 60 + 59)).toBe('late-night')
  })
})

describe('resolveDay', () => {
  const read = (date: string) => ({ entry: { ...blankEntry(date), morningAnswer: 'old' }, blockStatuses: [{ blockId: 'a' }] })

  it('keeps a read of today', () => {
    expect(resolveDay(read('2026-10-31'), '2026-10-31')).toMatchObject({ stale: false, entry: { morningAnswer: 'old' } })
  })
  it('turns an older day into a blank today, whatever the connection says', () => {
    expect(resolveDay(read('2026-10-30'), '2026-10-31')).toEqual({ entry: blankEntry('2026-10-31'), blockStatuses: [], stale: true })
  })
  it('compares across month and year ends', () => {
    expect(resolveDay(read('2025-12-31'), '2026-01-01').stale).toBe(true)
  })
  it('keeps a read that is ahead of the device', () => {
    expect(resolveDay(read('2026-11-01'), '2026-10-31').stale).toBe(false)
  })
})

describe('zonesDiffer', () => {
  it('compares zones and treats aliases as equal', () => {
    expect(zonesDiffer('Asia/Karachi', 'UTC')).toBe(true)
    expect(zonesDiffer('Asia/Karachi', 'Asia/Karachi')).toBe(false)
    expect(zonesDiffer('Asia/Calcutta', 'Asia/Kolkata')).toBe(false)
  })
  it('stays quiet when either zone is unknown', () => {
    expect(zonesDiffer('', 'UTC')).toBe(false)
    expect(zonesDiffer('Asia/Karachi', undefined)).toBe(false)
    expect(zonesDiffer('Mars/Base', 'UTC')).toBe(false)
  })
})

describe('blockState', () => {
  const work = { start: '08:00', end: '12:00' }
  const sleep = { start: '22:00', end: '05:00' }
  it('reports progress inside a block', () => {
    const s = blockState(work, 10 * 60)
    expect(s.status).toBe('current')
    expect(s.progress).toBeCloseTo(0.5)
    expect(s.remaining).toBe(120)
  })
  it('marks past and upcoming', () => {
    expect(blockState(work, 13 * 60).status).toBe('past')
    expect(blockState(work, 7 * 60).status).toBe('upcoming')
  })
  it('handles overnight blocks on both sides of midnight', () => {
    expect(blockState(sleep, 23 * 60).status).toBe('current')
    expect(blockState(sleep, 3 * 60).status).toBe('current')
    expect(blockState(sleep, 12 * 60).status).toBe('upcoming')
  })
})

describe('zonedClock', () => {
  it('uses the given timezone for date and minutes', () => {
    const at = new Date('2026-03-01T23:30:00Z')
    expect(zonedClock('Asia/Tokyo', at)).toEqual({ date: '2026-03-02', minutes: 8 * 60 + 30 })
    expect(zonedClock('America/Los_Angeles', at).date).toBe('2026-03-01')
  })
})

describe('formatting', () => {
  it('formats clock and duration', () => {
    expect(formatClock('00:05')).toBe('12:05 AM')
    expect(formatClock('13:30')).toBe('1:30 PM')
    expect(formatDuration(90)).toBe('1h 30m')
    expect(formatDuration(0.2)).toBe('1m')
  })
  it('sorts by start', () => {
    expect(sortBlocks([{ start: '22:00' }, { start: '05:00' }]).map(b => b.start)).toEqual(['05:00', '22:00'])
  })
})
