import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, reactive, ref, shallowRef } from 'vue'
import { blankEntry, resolveDay, zonedClock } from '../composables/todayTime'
import { ACTIVE_USER_KEY, MAX_ANSWER_LENGTH, backoffMs, classifyFailure, createSyncQueue, drainQueue, isSyncKey, mergeStamp, planUnconfirmed } from '../utils/syncQueue'
import { BACKGROUND_HEADER, CACHE_HEADER, FRESH_HEADER } from '../utils/pwaProtocol'

const RETRY = 15000
const DAY1 = '2026-10-31'
const DAY2 = '2026-11-01'
const BEFORE_MIDNIGHT = '2026-10-31T23:59:00.000Z'
const AFTER_MIDNIGHT = '2026-11-01T00:01:00.000Z'

interface ServerEntry { morningAnswer: string, eveningAnswer: string, morningAnswerAt: string | null, eveningAnswerAt: string | null }

/** A fake server: the date it believes, its stored days, and how the next reads should behave. */
const server = {
  today: DAY1,
  days: {} as Record<string, Partial<ServerEntry> & { checks?: { blockId: string, status: string }[] }>,
  /** Answers today's read from the service worker's copy. */
  cachedBody: null as unknown,
  down: false,
  reads: [] as boolean[],
  puts: [] as { date: string, body: Record<string, unknown> }[],
}

function entryOf(date: string) {
  const { checks: _checks, ...stored } = server.days[date] ?? {}
  return { ...blankEntry(date), ...stored }
}

const networkError = () => new Error('network')

function fakeFetch(url: string, options: { method?: string, headers?: Record<string, string>, body?: Record<string, unknown> } = {}) {
  if (server.down) return Promise.reject(networkError())
  if (url === '/api/auth/me') return Promise.resolve({ user: { id: 'u1' } })
  if (url === '/api/schedule') return Promise.resolve({ blocks: [] })
  const date = url.split('/').pop()!
  if (options.method === 'PUT') {
    server.puts.push({ date, body: options.body! })
    const { clientUpdatedAt, ...fields } = options.body as { clientUpdatedAt: Record<string, string> }
    server.days[date] = { ...server.days[date], ...fields }
    for (const [field, at] of Object.entries(clientUpdatedAt)) server.days[date]![`${field}At` as 'morningAnswerAt'] = at
    return Promise.resolve({ entry: entryOf(date) })
  }
  return Promise.resolve({ entry: entryOf(date) })
}

const fakeRaw = (url: string, options: { headers?: Record<string, string> } = {}) => {
  if (url === '/api/schedule') return Promise.resolve({ _data: { blocks: [] }, headers: new Headers() })
  const fresh = !!options.headers?.[FRESH_HEADER]
  if (server.cachedBody && !fresh) {
    server.reads.push(true)
    return Promise.resolve({ _data: server.cachedBody, headers: new Headers({ [CACHE_HEADER]: '1' }) })
  }
  server.reads.push(false)
  if (server.down) return Promise.reject(networkError())
  return Promise.resolve({
    _data: { entry: entryOf(server.today), blockStatuses: server.days[server.today]?.checks ?? [] },
    headers: new Headers(),
  })
}

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  }
}

const fetchMe = vi.fn()
const toastPush = vi.fn()
const settle = () => vi.advanceTimersByTimeAsync(0)

async function startStores() {
  const { useSyncStore } = await import('../stores/sync')
  const { useTodayStore } = await import('../stores/today')
  vi.stubGlobal('useSyncStore', useSyncStore)
  const sync = useSyncStore()
  await sync.start('u1')
  return { sync, today: useTodayStore() }
}

async function loaded() {
  const stores = await startStores()
  stores.today.reset()
  await stores.today.load()
  await settle()
  return stores
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-31T12:00:00.000Z'))
  Object.assign(server, { today: DAY1, days: {}, cachedBody: null, down: false, reads: [], puts: [] })
  fetchMe.mockClear()
  toastPush.mockClear()
  const fetcher = Object.assign(vi.fn(fakeFetch), { raw: vi.fn(fakeRaw) })
  vi.stubGlobal('$fetch', fetcher)
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('navigator', { onLine: true })
  Object.entries({
    ref, reactive, computed, shallowRef, zonedClock, blankEntry, resolveDay,
    createSyncQueue, drainQueue, classifyFailure, backoffMs, isSyncKey, planUnconfirmed, mergeStamp,
    ACTIVE_USER_KEY, MAX_ANSWER_LENGTH, BACKGROUND_HEADER, CACHE_HEADER, FRESH_HEADER,
  }).forEach(([name, value]) => vi.stubGlobal(name, value))
  vi.stubGlobal('useAuthStore', () => ({ user: { timezone: 'UTC' }, fetchMe }))
  vi.stubGlobal('useToast', () => ({ push: toastPush, error: toastPush }))
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('date authority and revalidation', () => {
  it('a live read behind the clock keeps the server\'s day and its check-offs, and never spins', async () => {
    vi.setSystemTime(new Date(AFTER_MIDNIGHT))
    server.days[DAY1] = { morningAnswer: 'yesterday', checks: [{ blockId: 'b1', status: 'done' }] }
    const { today } = await loaded()

    expect(today.date).toBe(DAY1)
    expect(today.drafts.morningAnswer).toBe('yesterday')
    expect(today.checks).toEqual({ b1: 'done' })
    expect(today.offlineCopy).toBe(false)

    const before = server.reads.length
    await vi.advanceTimersByTimeAsync(RETRY - 1)
    expect(server.reads.length).toBe(before)
    await vi.advanceTimersByTimeAsync(1)
    expect(server.reads.length).toBe(before + 1)
    expect(today.checks).toEqual({ b1: 'done' })
  })

  it('follows the server once it reaches the new day', async () => {
    vi.setSystemTime(new Date(AFTER_MIDNIGHT))
    server.days[DAY1] = { morningAnswer: 'yesterday' }
    const { today } = await loaded()
    server.today = DAY2
    await vi.advanceTimersByTimeAsync(RETRY)
    expect(today.date).toBe(DAY2)
    expect(today.drafts.morningAnswer).toBe('')
    expect(today.dayNotice).toBe(true)
  })

  it('stops polling once server and clock agree', async () => {
    await loaded()
    const before = server.reads.length
    await vi.advanceTimersByTimeAsync(RETRY * 3)
    expect(server.reads.length).toBe(before)
  })

  it('a cached old day becomes a blank today, revalidated only at the retry interval', async () => {
    vi.setSystemTime(new Date(AFTER_MIDNIGHT))
    server.today = DAY2
    server.days[DAY2] = { morningAnswer: 'from the server' }
    server.cachedBody = { entry: { ...blankEntry(DAY1), morningAnswer: 'old' }, blockStatuses: [] }
    const { today } = await loaded()
    expect(today.date).toBe(DAY2)
    expect(today.drafts.morningAnswer).toBe('')
    expect(today.offlineCopy).toBe(true)
    expect(server.reads).toEqual([true])

    await vi.advanceTimersByTimeAsync(RETRY)
    expect(server.reads).toEqual([true, false])
    expect(today.drafts.morningAnswer).toBe('from the server')
    expect(today.offlineCopy).toBe(false)
  })

  it('a cached copy cannot replace a live day during skew', async () => {
    vi.setSystemTime(new Date(AFTER_MIDNIGHT))
    server.days[DAY1] = { checks: [{ blockId: 'b1', status: 'done' }] }
    const { today } = await loaded()
    server.cachedBody = { entry: blankEntry(DAY1), blockStatuses: [] }
    await today.refresh()
    expect(today.date).toBe(DAY1)
    expect(today.checks).toEqual({ b1: 'done' })
  })

  it('retries a failed revalidate at the same interval', async () => {
    server.cachedBody = { entry: blankEntry(DAY1), blockStatuses: [] }
    server.down = true
    await loaded()
    await vi.advanceTimersByTimeAsync(RETRY)
    expect(server.reads).toEqual([true, false])
    await vi.advanceTimersByTimeAsync(RETRY - 1)
    expect(server.reads).toEqual([true, false])
    await vi.advanceTimersByTimeAsync(1)
    expect(server.reads).toEqual([true, false, false])
  })

  it.each(['dispose', 'reset'] as const)('%s cancels the timers', async (method) => {
    server.cachedBody = { entry: blankEntry(DAY1), blockStatuses: [] }
    const { today } = await loaded()
    today[method]()
    await vi.advanceTimersByTimeAsync(RETRY * 2)
    expect(server.reads).toEqual([true])
  })

  it('a poll in flight during unmount does not schedule another', async () => {
    vi.setSystemTime(new Date(AFTER_MIDNIGHT))
    const { today } = await loaded()
    await vi.advanceTimersByTimeAsync(RETRY - 1)
    const inFlight = vi.advanceTimersByTimeAsync(1)
    today.dispose()
    await inFlight
    const before = server.reads.length
    await vi.advanceTimersByTimeAsync(RETRY * 2)
    expect(server.reads.length).toBe(before)
  })
})

describe('rollover', () => {
  it('moves to the new day from a live read', async () => {
    vi.setSystemTime(new Date(BEFORE_MIDNIGHT))
    server.days[DAY1] = { morningAnswer: 'old', checks: [{ blockId: 'b1', status: 'done' }] }
    server.days[DAY2] = { morningAnswer: 'other device' }
    const { today } = await loaded()
    vi.setSystemTime(new Date(AFTER_MIDNIGHT))
    server.today = DAY2
    await today.rollover()
    expect(today.date).toBe(DAY2)
    expect(today.drafts.morningAnswer).toBe('other device')
    expect(today.checks).toEqual({})
    expect(today.dayNotice).toBe(true)
    await vi.advanceTimersByTimeAsync(6000)
    expect(today.dayNotice).toBe(false)
  })

  it('wipes nothing when the server still says yesterday', async () => {
    vi.setSystemTime(new Date(BEFORE_MIDNIGHT))
    server.days[DAY1] = { morningAnswer: 'kept', checks: [{ blockId: 'b1', status: 'done' }] }
    const { today } = await loaded()
    vi.setSystemTime(new Date(AFTER_MIDNIGHT))
    await today.rollover()
    expect(today.date).toBe(DAY1)
    expect(today.drafts.morningAnswer).toBe('kept')
    expect(today.checks).toEqual({ b1: 'done' })
    expect(today.dayNotice).toBe(false)
  })

  it('goes blank by itself when the server cannot answer', async () => {
    vi.setSystemTime(new Date(BEFORE_MIDNIGHT))
    server.days[DAY1] = { morningAnswer: 'old' }
    const { today } = await loaded()
    vi.setSystemTime(new Date(AFTER_MIDNIGHT))
    server.down = true
    await today.rollover()
    expect(today.date).toBe(DAY2)
    expect(today.drafts.morningAnswer).toBe('')
    expect(today.offlineCopy).toBe(true)
    expect(today.entryStatus).toBe('ready')
  })

  it('a read that lands after reset is ignored', async () => {
    vi.setSystemTime(new Date(BEFORE_MIDNIGHT))
    const { today } = await loaded()
    vi.setSystemTime(new Date(AFTER_MIDNIGHT))
    const rolling = today.rollover()
    today.reset()
    await rolling
    expect(today.date).toBe('')
    expect(today.entryStatus).toBe('loading')
  })

  it('a rollover read that fails after reset applies nothing', async () => {
    vi.setSystemTime(new Date(BEFORE_MIDNIGHT))
    const { today } = await loaded()
    vi.setSystemTime(new Date(AFTER_MIDNIGHT))
    server.down = true
    const rolling = today.rollover()
    today.reset()
    await rolling
    expect(today.date).toBe('')
    expect(today.offlineCopy).toBe(false)
  })
})

describe('a field focused across midnight', () => {
  async function focusedOverMidnight() {
    vi.setSystemTime(new Date(BEFORE_MIDNIGHT))
    server.days[DAY1] = { morningAnswer: 'typing' }
    server.days[DAY2] = { morningAnswer: 'new day text' }
    const stores = await loaded()
    stores.today.startEditing('morningAnswer')
    stores.today.setDraft('morningAnswer', 'typing a')
    vi.setSystemTime(new Date(AFTER_MIDNIGHT))
    server.today = DAY2
    await stores.today.rollover()
    return stores
  }

  it('keeps its text and keeps saving to the old date', async () => {
    const { today } = await focusedOverMidnight()
    expect(today.date).toBe(DAY2)
    expect(today.drafts.morningAnswer).toBe('typing a')
    today.setDraft('morningAnswer', 'typing ab')
    await vi.advanceTimersByTimeAsync(800)
    expect(server.days[DAY1]!.morningAnswer).toBe('typing ab')
    expect(server.days[DAY2]!.morningAnswer).toBe('new day text')
  })

  it('keeps the notice until blur, then moves to the new day', async () => {
    const { today } = await focusedOverMidnight()
    await vi.advanceTimersByTimeAsync(60000)
    expect(today.dayNotice).toBe(true)
    today.stopEditing()
    expect(today.drafts.morningAnswer).toBe('new day text')
    await vi.advanceTimersByTimeAsync(6000)
    expect(today.dayNotice).toBe(false)
    today.setDraft('morningAnswer', 'new day text more')
    await vi.advanceTimersByTimeAsync(800)
    expect(server.days[DAY2]!.morningAnswer).toBe('new day text more')
    expect(server.days[DAY1]!.morningAnswer).toBe('typing a')
  })

  it('the other field is on the new day straight away', async () => {
    const { today } = await focusedOverMidnight()
    today.setDraft('eveningAnswer', 'tonight')
    await vi.advanceTimersByTimeAsync(800)
    expect(server.days[DAY2]!.eveningAnswer).toBe('tonight')
  })
})

describe('hold-back on an unconfirmed blank day', () => {
  async function blankOverMidnight() {
    vi.setSystemTime(new Date(BEFORE_MIDNIGHT))
    const stores = await loaded()
    vi.setSystemTime(new Date(AFTER_MIDNIGHT))
    server.down = true
    await stores.today.rollover()
    return stores
  }

  it('offline, the text queues and stays durable', async () => {
    const { today, sync } = await blankOverMidnight()
    today.setDraft('morningAnswer', 'offline')
    expect(sync.ops).toMatchObject([{ date: DAY2, value: 'offline', unconfirmed: true }])
    expect(server.puts).toEqual([])
  })

  it('sends plainly when the server has nothing', async () => {
    const { today } = await blankOverMidnight()
    today.setDraft('morningAnswer', 'mine')
    server.down = false
    server.today = DAY2
    await vi.advanceTimersByTimeAsync(RETRY)
    await vi.advanceTimersByTimeAsync(800)
    expect(server.days[DAY2]!.morningAnswer).toBe('mine')
  })

  it('keeps the server\'s text and appends the local text', async () => {
    const { today, sync } = await blankOverMidnight()
    today.setDraft('morningAnswer', 'mine')
    server.down = false
    server.today = DAY2
    server.days[DAY2] = { morningAnswer: 'theirs', morningAnswerAt: '2026-11-01T00:00:30.000Z' }
    await vi.advanceTimersByTimeAsync(RETRY + 1000)
    expect(server.days[DAY2]!.morningAnswer).toBe('theirs\n\n---\nmine')
    expect(sync.ops).toEqual([])
    expect(today.drafts.morningAnswer).toBe('theirs\n\n---\nmine')
  })

  it('merges even when the first send beats the confirming read', async () => {
    const { today, sync } = await blankOverMidnight()
    today.setDraft('morningAnswer', 'mine')
    server.down = false
    server.today = DAY2
    server.days[DAY2] = { morningAnswer: 'theirs' }
    await sync.trigger()
    expect(server.days[DAY2]!.morningAnswer).toBe('theirs\n\n---\nmine')
    expect(today.date).toBe(DAY2)
  })

  it('holds a focused field until blur, then merges once', async () => {
    const { today } = await blankOverMidnight()
    today.startEditing('morningAnswer')
    today.setDraft('morningAnswer', 'mi')
    server.down = false
    server.today = DAY2
    server.days[DAY2] = { morningAnswer: 'theirs' }
    await vi.advanceTimersByTimeAsync(RETRY)
    today.setDraft('morningAnswer', 'mine')
    await vi.advanceTimersByTimeAsync(800)
    expect(today.drafts.morningAnswer).toBe('mine')
    expect(server.puts).toEqual([])
    today.stopEditing()
    await vi.advanceTimersByTimeAsync(1000)
    expect(server.days[DAY2]!.morningAnswer).toBe('theirs\n\n---\nmine')
    expect(server.puts).toHaveLength(1)
    expect(today.drafts.morningAnswer).toBe('theirs\n\n---\nmine')
  })

  it('a first keystroke on a held-back field cannot replace text it never showed', async () => {
    const { today } = await blankOverMidnight()
    today.startEditing('morningAnswer')
    server.down = false
    server.today = DAY2
    server.days[DAY2] = { morningAnswer: 'theirs' }
    await vi.advanceTimersByTimeAsync(RETRY)
    today.setDraft('morningAnswer', 'x')
    today.stopEditing()
    await vi.advanceTimersByTimeAsync(1000)
    expect(server.days[DAY2]!.morningAnswer).toBe('theirs\n\n---\nx')
  })

  it('parks a merge that does not fit, loses neither side and tells the user', async () => {
    const { today, sync } = await blankOverMidnight()
    const local = 'l'.repeat(3000)
    today.setDraft('morningAnswer', local)
    server.down = false
    server.today = DAY2
    server.days[DAY2] = { morningAnswer: 's'.repeat(3000) }
    await vi.advanceTimersByTimeAsync(RETRY + 1000)
    expect(server.days[DAY2]!.morningAnswer).toBe('s'.repeat(3000))
    expect(sync.ops).toMatchObject([{ parked: true }])
    expect(today.drafts.morningAnswer).toContain(local)
    expect(today.drafts.morningAnswer).toContain('s'.repeat(3000))
    expect(toastPush).toHaveBeenCalledTimes(1)

    today.setDraft('morningAnswer', 'short now')
    await vi.advanceTimersByTimeAsync(800)
    expect(server.days[DAY2]!.morningAnswer).toBe('short now')
  })

  it('shortening stays local until it fits, so no text is lost', async () => {
    const { today, sync } = await blankOverMidnight()
    today.setDraft('morningAnswer', 'l'.repeat(3000))
    server.down = false
    server.today = DAY2
    server.days[DAY2] = { morningAnswer: 's'.repeat(3000) }
    await vi.advanceTimersByTimeAsync(RETRY + 1000)
    const before = server.puts.length

    const tooLong = today.drafts.morningAnswer.slice(0, 5500)
    today.setDraft('morningAnswer', tooLong)
    await vi.advanceTimersByTimeAsync(RETRY)
    expect(server.puts.length).toBe(before)
    expect(sync.ops).toMatchObject([{ parked: true, value: tooLong }])
    expect(toastPush).toHaveBeenCalledTimes(1)

    const fits = tooLong.slice(0, 5000)
    today.setDraft('morningAnswer', fits)
    await vi.advanceTimersByTimeAsync(800)
    expect(server.days[DAY2]!.morningAnswer).toBe(fits)
    expect(sync.ops).toEqual([])
  })

  it('a reload forgets a hold, and the text still merges', async () => {
    const { today, sync } = await blankOverMidnight()
    today.startEditing('morningAnswer')
    today.setDraft('morningAnswer', 'mine')
    expect(sync.ops).toMatchObject([{ hold: true }])
    today.dispose()
    expect(sync.ops).toMatchObject([{ hold: false, unconfirmed: true }])
  })
})

describe('answers parked on another day', () => {
  const parkedOn = (date: string) => ({ kind: 'answer', date, field: 'morningAnswer', value: 'merged', clientUpdatedAt: '2026-10-30T12:00:00.000Z', parked: true }) as const

  it('leaves the pending count once the notice has them, but not the sign-out count', async () => {
    const { today, sync } = await loaded()
    sync.enqueue(parkedOn('2026-10-30'))
    expect(today.strandedOps).toMatchObject([{ date: '2026-10-30', value: 'merged' }])
    expect(today.unsaved).toBe(0)
    expect(today.saveState).toBe('idle')
    expect(sync.pending).toBe(1)
  })

  it('counts a parked answer for the shown day, which its field can still fix', async () => {
    const { today, sync } = await loaded()
    sync.enqueue(parkedOn(DAY1))
    expect(today.strandedOps).toEqual([])
    expect(today.unsaved).toBe(1)
  })

  it('discardOp removes the item and nothing else', async () => {
    const { today, sync } = await loaded()
    sync.enqueue(parkedOn('2026-10-30'))
    sync.enqueue({ ...parkedOn('2026-10-29') })
    expect(sync.discardOp(today.strandedOps[0]!)).toBe(true)
    expect(sync.ops).toMatchObject([{ date: '2026-10-29' }])
  })

  it('discardOp keeps a newer version of the item', async () => {
    const { sync } = await loaded()
    sync.enqueue(parkedOn('2026-10-30'))
    const seen = sync.ops[0]!
    sync.enqueue({ ...parkedOn('2026-10-30'), value: 'newer', clientUpdatedAt: '2026-10-30T13:00:00.000Z' })
    expect(sync.discardOp(seen)).toBe(false)
    expect(sync.ops).toMatchObject([{ value: 'newer' }])
  })

  it('discarding the only parked answer clears the notice and the sign-out count', async () => {
    const { today, sync } = await loaded()
    sync.enqueue(parkedOn('2026-10-30'))
    expect(sync.discardOp(today.strandedOps[0]!)).toBe(true)
    expect(today.strandedOps).toEqual([])
    expect(sync.pending).toBe(0)
  })

  it('a stale Discard for an item another tab already removed reports success and keeps the rest', async () => {
    const { today, sync } = await loaded()
    sync.enqueue(parkedOn('2026-10-30'))
    sync.enqueue(parkedOn('2026-10-29'))
    const [first] = today.strandedOps
    expect(sync.discardOp(first!)).toBe(true)
    expect(sync.discardOp(first!)).toBe(true)
    expect(sync.ops).toMatchObject([{ date: '2026-10-29' }])
  })
})
