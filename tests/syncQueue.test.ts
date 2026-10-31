import { describe, expect, it, vi } from 'vitest'
import {
  backoffMs, classifyFailure, createSyncQueue, drainQueue, isSyncKey, mergeStamp, MERGE_SEPARATOR, planUnconfirmed,
  type AnswerChange, type StorageLike, type SyncOp,
} from '../utils/syncQueue'

function memoryStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    get length() { return map.size },
    key: i => [...map.keys()][i] ?? null,
    getItem: k => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: k => void map.delete(k),
  }
}

const answer = (over: Partial<AnswerChange> = {}): AnswerChange => ({
  kind: 'answer', date: '2026-10-30', field: 'morningAnswer', value: 'hello', clientUpdatedAt: '2026-10-30T10:00:00.000Z', ...over,
})
const httpError = (statusCode: number) => Object.assign(new Error('http'), { statusCode })

describe('sync queue storage', () => {
  it('survives a new queue instance, as after a reload', () => {
    const storage = memoryStorage()
    createSyncQueue(storage, 'u1').put(answer())
    expect(createSyncQueue(storage, 'u1').list()).toMatchObject([{ value: 'hello', clientUpdatedAt: '2026-10-30T10:00:00.000Z' }])
  })

  it('is scoped per user', () => {
    const storage = memoryStorage()
    const a = createSyncQueue(storage, 'a')
    const ab = createSyncQueue(storage, 'ab')
    a.put(answer())
    expect(ab.list()).toEqual([])
    ab.clear()
    expect(a.list()).toHaveLength(1)
  })

  it('keeps the latest edit per date and field, and keeps dates apart', () => {
    const q = createSyncQueue(memoryStorage(), 'u1')
    q.put(answer({ value: 'one' }))
    q.put(answer({ value: 'two', clientUpdatedAt: '2026-10-30T11:00:00.000Z' }))
    q.put(answer({ date: '2026-10-31', value: 'next day', clientUpdatedAt: '2026-10-31T00:01:00.000Z' }))
    expect(q.list().map(o => [o.date, (o as AnswerChange).value])).toEqual([['2026-10-30', 'two'], ['2026-10-31', 'next day']])
  })

  it('does not let an older edit from another tab replace a newer one', () => {
    const q = createSyncQueue(memoryStorage(), 'u1')
    q.put(answer({ value: 'newer', clientUpdatedAt: '2026-10-30T12:00:00.000Z' }))
    q.put(answer({ value: 'older' }))
    expect(q.list()).toMatchObject([{ value: 'newer' }])
  })

  it('keeps the last check-off for a block, including a clear', () => {
    const q = createSyncQueue(memoryStorage(), 'u1')
    q.put({ kind: 'check', date: '2026-10-30', blockId: 'b/1', status: 'done' })
    q.put({ kind: 'check', date: '2026-10-30', blockId: 'b/1', status: null })
    expect(q.list()).toMatchObject([{ blockId: 'b/1', status: null }])
  })

  it('keeps the block snapshot of a check-off across a reload', () => {
    const storage = memoryStorage()
    const block = { label: 'Work', start: '08:00', end: '12:00', productive: true }
    createSyncQueue(storage, 'u1').put({ kind: 'check', date: '2026-10-30', blockId: 'b1', status: 'done', block })
    expect(createSyncQueue(storage, 'u1').list()).toMatchObject([{ blockId: 'b1', block }])
  })

  it('only removes the version that was sent', () => {
    const q = createSyncQueue(memoryStorage(), 'u1')
    q.put(answer({ value: 'sent' }))
    const sent = q.list()[0]!
    q.put(answer({ value: 'typed meanwhile', clientUpdatedAt: '2026-10-30T11:00:00.000Z' }))
    q.remove(sent)
    expect(q.list()).toMatchObject([{ value: 'typed meanwhile' }])
  })

  it('reports a storage failure and skips unreadable items', () => {
    const storage = memoryStorage()
    const q = createSyncQueue(storage, 'u1')
    q.put(answer())
    storage.setItem([...storage.map.keys()][0]!.replace('morningAnswer', 'eveningAnswer'), '{broken')
    expect(q.list()).toHaveLength(1)
    storage.setItem = () => { throw new Error('quota') }
    expect(q.put(answer({ date: '2026-10-29' }))).toBe(false)
  })

  it('recognises its own keys', () => {
    const storage = memoryStorage()
    createSyncQueue(storage, 'u1').put(answer())
    expect(isSyncKey([...storage.map.keys()][0]!)).toBe(true)
    expect(isSyncKey('theme')).toBe(false)
    expect(isSyncKey(null)).toBe(false)
  })
})

describe('classifyFailure', () => {
  it.each([[undefined, 'retry'], [408, 'retry'], [429, 'retry'], [500, 'retry'], [503, 'retry'], [401, 'auth'], [400, 'drop'], [404, 'drop'], [422, 'drop']])(
    'status %s is %s', (status, action) => {
      expect(classifyFailure(status ? httpError(status) : new TypeError('Failed to fetch'))).toBe(action)
    })
})

describe('backoffMs', () => {
  it('grows, jitters and caps', () => {
    expect(backoffMs(0, 1)).toBe(2000)
    expect(backoffMs(0, 0)).toBe(1000)
    expect(backoffMs(3, 1)).toBe(16000)
    expect(backoffMs(20, 1)).toBe(60000)
  })
})

describe('drainQueue', () => {
  function seeded() {
    const queue = createSyncQueue(memoryStorage(), 'u1')
    vi.useFakeTimers({ now: 1000 })
    queue.put(answer({ value: 'first' }))
    vi.setSystemTime(2000)
    queue.put(answer({ field: 'eveningAnswer', value: 'second' }))
    vi.setSystemTime(3000)
    queue.put({ kind: 'check', date: '2026-10-30', blockId: 'b1', status: 'done' })
    vi.useRealTimers()
    return queue
  }
  const label = (op: SyncOp) => (op.kind === 'answer' ? op.value : op.blockId)

  it('sends oldest first, one at a time', async () => {
    const queue = seeded()
    const sent: string[] = []
    let active = 0
    const result = await drainQueue({
      queue,
      canContinue: () => true,
      send: async (op) => {
        expect(++active).toBe(1)
        sent.push(label(op))
        await Promise.resolve()
        active--
      },
    })
    expect(sent).toEqual(['first', 'second', 'b1'])
    expect(result).toMatchObject({ stop: 'empty', synced: 3 })
    expect(queue.list()).toEqual([])
  })

  it('stops on a network error and keeps the item and its order', async () => {
    const queue = seeded()
    const send = vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const result = await drainQueue({ queue, send, canContinue: () => true })
    expect(result).toMatchObject({ stop: 'retry', synced: 1 })
    expect(queue.list().map(label)).toEqual(['second', 'b1'])
  })

  it('holds the whole queue on 401', async () => {
    const queue = seeded()
    const result = await drainQueue({ queue, send: () => Promise.reject(httpError(401)), canContinue: () => true })
    expect(result.stop).toBe('auth')
    expect(queue.list()).toHaveLength(3)
  })

  it('drops only the permanently rejected item, reports it, and carries on', async () => {
    const queue = seeded()
    const send = vi.fn(async (op: SyncOp) => { if (label(op) === 'first') throw httpError(404) })
    const result = await drainQueue({ queue, send, canContinue: () => true })
    expect(result.dropped.map(d => label(d.op))).toEqual(['first'])
    expect(result).toMatchObject({ stop: 'empty', synced: 2 })
  })

  it('stops before the next send when it may not continue, as on an account switch', async () => {
    const queue = seeded()
    let allowed = true
    const send = vi.fn(async () => { allowed = false })
    const result = await drainQueue({ queue, send, canContinue: () => allowed })
    expect(send).toHaveBeenCalledTimes(1)
    expect(result.stop).toBe('halted')
    expect(queue.list()).toHaveLength(2)
  })

  it('sends again when an item was edited while in flight', async () => {
    const queue = seeded()
    const sent: string[] = []
    let edited = false
    await drainQueue({
      queue,
      canContinue: () => true,
      send: async (op) => {
        sent.push(label(op))
        if (!edited) {
          edited = true
          queue.put(answer({ value: 'first, edited', clientUpdatedAt: '2026-10-30T11:00:00.000Z' }))
        }
      },
    })
    expect(sent).toContain('first, edited')
    expect(queue.list()).toEqual([])
  })
})

describe('planUnconfirmed', () => {
  it('sends local text when the server has none', () => {
    expect(planUnconfirmed('  ', 'mine')).toEqual({ action: 'send', value: 'mine' })
  })
  it('sends local text that already contains the server\'s', () => {
    expect(planUnconfirmed('theirs', 'theirs and more')).toEqual({ action: 'send', value: 'theirs and more' })
  })
  it('skips what the server already has, so a repeated send never duplicates', () => {
    expect(planUnconfirmed(`theirs${MERGE_SEPARATOR}mine`, 'mine')).toEqual({ action: 'skip' })
  })
  it('never lets a blank local text clear the server', () => {
    expect(planUnconfirmed('theirs', '')).toEqual({ action: 'skip' })
  })
  it('keeps the server text first', () => {
    expect(planUnconfirmed('theirs', 'mine')).toEqual({ action: 'send', value: `theirs${MERGE_SEPARATOR}mine` })
  })
  it('parks a merge past the limit', () => {
    expect(planUnconfirmed('aaaa', 'bbbb', 8).action).toBe('park')
  })
})

describe('mergeStamp', () => {
  it('beats the server even with a slow device clock', () => {
    expect(mergeStamp('2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', Date.parse('2026-01-01T00:00:01.000Z')))
      .toBe('2026-01-02T00:00:00.001Z')
  })
})

describe('drainQueue with unsendable items', () => {
  it('leaves held and parked answers in place', async () => {
    const q = createSyncQueue(memoryStorage(), 'u1')
    q.put(answer({ value: 'held', field: 'morningAnswer', hold: true }))
    q.put(answer({ value: 'parked', field: 'eveningAnswer', parked: true }))
    const send = vi.fn()
    const result = await drainQueue({ queue: q, send, canContinue: () => true })
    expect(send).not.toHaveBeenCalled()
    expect(result.stop).toBe('empty')
    expect(q.list()).toHaveLength(2)
  })
})
