import { existsSync } from 'node:fs'
import { createApp, createError, createRouter, toWebHandler, type H3Event } from 'h3'
import mongoose from 'mongoose'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectDb, disconnectDb } from '../server/utils/db'
import { EntryModel } from '../server/models/Entry'
import { ScheduleModel } from '../server/models/Schedule'
import { franklinDefaults } from '../server/utils/schedule'
import { UserModel } from '../server/models/User'
import putBlock from '../server/api/entries/[date]/blocks/[blockId].put'
import insights from '../server/api/insights.get'
import { MAX_BLOCK_STATUSES } from '../server/utils/tracking'

const TEST_DB = 'daily-agenda-test-tracking'

let session: { user?: { id: string } } = {}
vi.stubGlobal('clearUserSession', async () => {
  session = {}
})
vi.stubGlobal('requireUserSession', async (_event: H3Event) => {
  if (!session.user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  return session
})

const router = createRouter()
  .put('/entries/:date/blocks/:blockId', putBlock)
  .get('/insights', insights)
const handle = toWebHandler(createApp().use(router))

const call = (method: string, path: string, body?: unknown) => handle(new Request(`http://test${path}`, {
  method,
  headers: { 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
}))
const setStatus = (date: string, blockId: string, status: unknown) =>
  call('PUT', `/entries/${date}/blocks/${blockId}`, { status })

let userA: string
let userB: string

beforeAll(async () => {
  if (!process.env.MONGODB_URI && existsSync('.env')) process.loadEnvFile('.env')
  await connectDb({ dbName: TEST_DB })
  expect(mongoose.connection.name).toBe(TEST_DB)
  await Promise.all([EntryModel.init(), UserModel.init(), ScheduleModel.init()])
})

beforeEach(async () => {
  await Promise.all([EntryModel.deleteMany(), UserModel.deleteMany(), ScheduleModel.deleteMany()])
  const [a, b] = await UserModel.create([
    { email: 'a@example.com', passwordHash: 'x' },
    { email: 'b@example.com', passwordHash: 'x' },
  ])
  userA = a!.id
  userB = b!.id
  session = { user: { id: userA } }
})

afterAll(async () => {
  if (mongoose.connection.name === TEST_DB) await mongoose.connection.dropDatabase()
  await disconnectDb()
})

describe('block status API', () => {
  it('requires a signed-in user and validates input', async () => {
    session = {}
    expect((await setStatus('2026-01-01', 'work-am', 'done')).status).toBe(401)
    expect((await call('GET', '/insights?from=2026-01-01&to=2026-01-02')).status).toBe(401)
    session = { user: { id: userA } }
    expect((await setStatus('nope', 'work-am', 'done')).status).toBe(400)
    expect((await setStatus('2026-01-01', 'work-am', 'bogus')).status).toBe(400)
    expect((await setStatus('2026-01-01', 'missing', 'done')).status).toBe(404)
  })

  it('snapshots the block, replaces, and clears', async () => {
    await ScheduleModel.create({ user: userA, blocks: franklinDefaults() })
    let res = await setStatus('2026-01-01', 'work-am', 'done')
    expect((await res.json()).blockStatuses).toEqual([
      { blockId: 'work-am', label: 'Work', start: '08:00', end: '12:00', status: 'done', productive: true },
    ])
    res = await setStatus('2026-01-01', 'work-am', 'skipped')
    expect((await res.json()).blockStatuses).toHaveLength(1)
    expect((await EntryModel.findOne().lean())!.blockStatuses[0]!.status).toBe('skipped')
    res = await setStatus('2026-01-01', 'work-am', null)
    expect((await res.json()).blockStatuses).toEqual([])
    expect((await setStatus('2026-01-09', 'work-am', 'cleared')).status).toBe(200)
  })

  it('keeps history when the schedule is edited later', async () => {
    await ScheduleModel.create({ user: userA, blocks: franklinDefaults() })
    await setStatus('2026-01-01', 'work-am', 'done')
    await ScheduleModel.updateOne(
      { user: userA, 'blocks.id': 'work-am' },
      { $set: { 'blocks.$.label': 'Renamed', 'blocks.$.end': '09:00', 'blocks.$.productive': false } },
    )
    const entry = await EntryModel.findOne().lean()
    expect(entry!.blockStatuses[0]).toMatchObject({ label: 'Work', end: '12:00', productive: true })
    const res = await call('GET', '/insights?from=2026-01-01&to=2026-01-01')
    expect((await res.json()).total.productiveMinutes).toBe(240)
  })

  describe('block snapshot', () => {
    const block = { label: 'Old block', start: '09:00', end: '10:00', productive: true }
    const put = (date: string, body: unknown) => call('PUT', `/entries/${date}/blocks/deleted-id`, body)

    it('uses the snapshot for a block no longer in the schedule', async () => {
      const res = await put('2026-01-01', { status: 'done', block })
      expect(res.status).toBe(200)
      expect((await res.json()).blockStatuses).toEqual([{ blockId: 'deleted-id', status: 'done', ...block }])
    })

    it('prefers the snapshot over the current schedule', async () => {
      await setStatus('2026-01-02', 'work-am', 'skipped')
      const res = await call('PUT', '/entries/2026-01-02/blocks/work-am', { status: 'done', block })
      expect((await res.json()).blockStatuses[0]).toMatchObject({ blockId: 'work-am', label: 'Old block' })
    })

    it('still needs a known block without a snapshot', async () => {
      expect((await put('2026-01-01', { status: 'done' })).status).toBe(404)
    })

    it('ignores a snapshot when clearing', async () => {
      expect((await put('2026-01-01', { status: null, block: 'junk' })).status).toBe(200)
    })

    it.each([
      ['a string', 'x'],
      ['null', null],
      ['an array', []],
      ['a missing key', { label: 'A', start: '09:00', end: '10:00' }],
      ['an extra key', { ...block, status: 'done' }],
      ['an empty label', { ...block, label: '   ' }],
      ['a long label', { ...block, label: 'x'.repeat(61) }],
      ['a non-string label', { ...block, label: 5 }],
      ['a bad time', { ...block, start: '9am' }],
      ['equal times', { ...block, end: '09:00' }],
      ['a non-boolean flag', { ...block, productive: 'yes' }],
    ])('rejects %s', async (_name, bad) => {
      expect((await put('2026-01-01', { status: 'done', block: bad })).status).toBe(400)
      expect(await EntryModel.countDocuments()).toBe(0)
    })
  })

  it('does not lose concurrent check-offs or create duplicates', async () => {
    await ScheduleModel.create({ user: userA, blocks: franklinDefaults() })
    const ids = ['rise-plan', 'work-am', 'read-eat', 'work-pm', 'review', 'sleep']
    await Promise.all(ids.map(id => setStatus('2026-01-01', id, 'done')))
    await Promise.all(ids.map(id => setStatus('2026-01-01', id, 'done')))
    expect(await EntryModel.countDocuments()).toBe(1)
    const entry = await EntryModel.findOne().lean()
    expect(entry!.blockStatuses.map(b => b.blockId).sort()).toEqual([...ids].sort())
  })

  it('is user scoped', async () => {
    await setStatus('2026-01-01', 'work-am', 'done')
    session = { user: { id: userB } }
    const res = await call('GET', '/insights?from=2026-01-01&to=2026-01-01')
    expect((await res.json()).total).toEqual({ productiveMinutes: 0, done: 0, skipped: 0 })
    expect(await EntryModel.countDocuments({ user: userB })).toBe(0)
  })
})

describe('insights API', () => {
  it('totals productive minutes, wraps overnight blocks, counts done and skipped', async () => {
    await ScheduleModel.create({ user: userA, blocks: [
      { id: 'night', label: 'Night work', start: '22:00', end: '01:00', productive: true },
      { id: 'a', label: 'A', start: '08:00', end: '09:30', productive: true },
      { id: 'b', label: 'B', start: '10:00', end: '11:00', productive: false },
    ] })
    await setStatus('2026-01-01', 'night', 'done')
    await setStatus('2026-01-01', 'a', 'done')
    await setStatus('2026-01-01', 'b', 'done')
    await setStatus('2026-01-03', 'a', 'skipped')
    const json = await (await call('GET', '/insights?from=2026-01-01&to=2026-01-03')).json()
    expect(json.days).toEqual([
      { date: '2026-01-01', productiveMinutes: 270, done: 3, skipped: 0 },
      { date: '2026-01-02', productiveMinutes: 0, done: 0, skipped: 0 },
      { date: '2026-01-03', productiveMinutes: 0, done: 0, skipped: 1 },
    ])
    expect(json.total).toEqual({ productiveMinutes: 270, done: 3, skipped: 1 })
  })

  it('validates the range', async () => {
    expect((await call('GET', '/insights')).status).toBe(400)
    expect((await call('GET', '/insights?from=2026-02-30&to=2026-03-01')).status).toBe(400)
    expect((await call('GET', '/insights?from=2026-01-05&to=2026-01-01')).status).toBe(400)
    expect((await call('GET', '/insights?from=2026-01-01&to=2026-04-02')).status).toBe(200)
    expect((await call('GET', '/insights?from=2026-01-01&to=2026-04-03')).status).toBe(400)
  })
})

describe('block status cap', () => {
  const snapshot = (id: string) => ({ status: 'done', block: { label: id, start: '08:00', end: '09:00', productive: false } })
  const put = (id: string) => call('PUT', `/entries/2026-06-15/blocks/${id}`, snapshot(id))

  it('answers 400 past the cap, and still updates a block already there', async () => {
    session = { user: { id: userA } }
    for (let i = 0; i < MAX_BLOCK_STATUSES; i++) expect((await put(`b${i}`)).status).toBe(200)
    expect((await put('one-more')).status).toBe(400)
    expect((await call('PUT', '/entries/2026-06-15/blocks/b0', { ...snapshot('b0'), status: 'skipped' })).status).toBe(200)
    const entry = await EntryModel.findOne({ user: userA, date: '2026-06-15' }).lean()
    expect(entry!.blockStatuses).toHaveLength(MAX_BLOCK_STATUSES)
  })

  it('holds under concurrent check-offs', async () => {
    session = { user: { id: userA } }
    const results = await Promise.all(Array.from({ length: MAX_BLOCK_STATUSES + 5 }, (_, i) => put(`c${i}`)))
    expect(results.filter(r => r.status === 400)).toHaveLength(5)
    const entry = await EntryModel.findOne({ user: userA, date: '2026-06-15' }).lean()
    expect(entry!.blockStatuses).toHaveLength(MAX_BLOCK_STATUSES)
  })
})
