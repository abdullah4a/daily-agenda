import { existsSync } from 'node:fs'
import { createApp, createError, createRouter, toWebHandler, type H3Event } from 'h3'
import mongoose from 'mongoose'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectDb } from '../server/utils/db'
import { EntryModel } from '../server/models/Entry'
import { UserModel } from '../server/models/User'
import list from '../server/api/entries/index.get'

const TEST_DB = 'daily-agenda-test-history'

let session: { user?: { id: string } } = {}
vi.stubGlobal('clearUserSession', async () => {
  session = {}
})
vi.stubGlobal('requireUserSession', async (_event: H3Event) => {
  if (!session.user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  return session
})

const handle = toWebHandler(createApp().use(createRouter().get('/', list)))
interface Page { items: { date: string, completedBlocks: { label: string }[] }[], nextCursor: string | null }
const get = async (qs = '') => {
  const res = await handle(new Request(`http://test/${qs}`))
  return { status: res.status, json: await res.json() as Page }
}
const day = (n: number) => `2026-03-${String(n).padStart(2, '0')}`

let userA: string
let userB: string

beforeAll(async () => {
  if (!process.env.MONGODB_URI && existsSync('.env')) process.loadEnvFile('.env')
  await connectDb({ dbName: TEST_DB })
  expect(mongoose.connection.name).toBe(TEST_DB)
  await Promise.all([EntryModel.init(), UserModel.init()])
})

beforeEach(async () => {
  await Promise.all([EntryModel.deleteMany(), UserModel.deleteMany()])
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
  await mongoose.disconnect()
})

describe('GET /api/entries', () => {
  it('rejects anonymous callers', async () => {
    session = {}
    expect((await get()).status).toBe(401)
  })

  it('returns an empty page when there is no history', async () => {
    const { status, json } = await get()
    expect(status).toBe(200)
    expect(json).toEqual({ items: [], nextCursor: null })
  })

  it('lists newest first, only the caller\'s entries with a non-blank answer', async () => {
    await EntryModel.create([
      { user: userA, date: day(1), morningAnswer: 'a' },
      { user: userA, date: day(3), eveningAnswer: 'c' },
      { user: userA, date: day(2) },
      { user: userA, date: day(4), morningAnswer: '  \n ' },
      { user: userB, date: day(5), morningAnswer: 'other user' },
    ])
    const { json } = await get()
    expect(json.items.map(i => i.date)).toEqual([day(3), day(1)])
  })

  it('returns only completed blocks', async () => {
    const block = { start: '09:00', end: '10:00', productive: true }
    await EntryModel.create({
      user: userA,
      date: day(1),
      morningAnswer: 'x',
      blockStatuses: [
        { blockId: 'a', label: 'Deep work', status: 'done', ...block },
        { blockId: 'b', label: 'Skipped one', status: 'skipped', ...block },
      ],
    })
    const { json } = await get()
    expect(json.items[0]!.completedBlocks.map(b => b.label)).toEqual(['Deep work'])
  })

  it('paginates by cursor without gaps or duplicates', async () => {
    await EntryModel.create(Array.from({ length: 5 }, (_, i) => ({ user: userA, date: day(i + 1), morningAnswer: 'x' })))
    const first = (await get('?limit=2')).json
    expect(first.items.map(i => i.date)).toEqual([day(5), day(4)])
    expect(first.nextCursor).toBe(day(4))
    const second = (await get(`?limit=2&cursor=${first.nextCursor}`)).json
    expect(second.items.map(i => i.date)).toEqual([day(3), day(2)])
    const last = (await get(`?limit=2&cursor=${second.nextCursor}`)).json
    expect(last.items.map(i => i.date)).toEqual([day(1)])
    expect(last.nextCursor).toBeNull()
  })

  it('defaults to 20 items and caps the limit at 50', async () => {
    await EntryModel.create(Array.from({ length: 28 }, (_, i) => ({ user: userA, date: day(i + 1), morningAnswer: 'x' })))
    await EntryModel.create(Array.from({ length: 30 }, (_, i) => ({ user: userA, date: `2026-04-${String(i + 1).padStart(2, '0')}`, eveningAnswer: 'x' })))
    expect((await get()).json.items).toHaveLength(20)
    const capped = (await get('?limit=500')).json
    expect(capped.items).toHaveLength(50)
    expect(capped.nextCursor).not.toBeNull()
  })

  it('rejects a malformed cursor or limit', async () => {
    expect((await get('?cursor=nope')).status).toBe(400)
    expect((await get('?limit=0')).status).toBe(400)
    expect((await get('?limit=abc')).status).toBe(400)
  })
})
