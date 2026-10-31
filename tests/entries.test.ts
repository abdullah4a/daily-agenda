import { existsSync } from 'node:fs'
import { createApp, createError, createRouter, toWebHandler, type H3Event } from 'h3'
import mongoose from 'mongoose'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectDb, disconnectDb } from '../server/utils/db'
import { EntryModel } from '../server/models/Entry'
import { UserModel } from '../server/models/User'
import { localDateString } from '../server/utils/date'
import { saveEntry, parseEntryPatch } from '../server/utils/entries'
import getEntry from '../server/api/entries/[date].get'
import putEntry from '../server/api/entries/[date].put'
import today from '../server/api/entries/today.get'

const TEST_DB = 'daily-agenda-test-entries'

let session: { user?: { id: string } } = {}
vi.stubGlobal('clearUserSession', async () => {
  session = {}
})
vi.stubGlobal('requireUserSession', async (_event: H3Event) => {
  if (!session.user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  return session
})

const router = createRouter()
  .get('/today', today)
  .get('/:date', getEntry)
  .put('/:date', putEntry)
const handle = toWebHandler(createApp().use(router))

const call = (method: string, path: string, body?: unknown) => handle(new Request(`http://test${path}`, {
  method,
  headers: { 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
}))
const put = async (date: string, body: unknown) => {
  const res = await call('PUT', `/${date}`, body)
  return { status: res.status, json: await res.json() as { entry: Record<string, unknown> } }
}

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
    { email: 'a@example.com', passwordHash: 'x', timezone: 'Pacific/Kiritimati' },
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

describe('entries API', () => {
  it('requires a signed-in user', async () => {
    session = {}
    expect((await call('GET', '/2026-01-01')).status).toBe(401)
    expect((await call('PUT', '/2026-01-01', { morningAnswer: 'x' })).status).toBe(401)
    expect((await call('GET', '/today')).status).toBe(401)
  })

  it('returns an empty entry when none exists', async () => {
    const res = await call('GET', '/2026-01-01')
    expect((await res.json()).entry).toMatchObject({ date: '2026-01-01', morningAnswer: '', eveningAnswer: '' })
  })

  it('rejects invalid dates and bodies', async () => {
    expect((await call('GET', '/2026-02-30')).status).toBe(400)
    expect((await put('nope', { morningAnswer: 'x' })).status).toBe(400)
    expect((await put('2026-01-01', {})).status).toBe(400)
    expect((await put('2026-01-01', { morningAnswer: 5 })).status).toBe(400)
    expect((await put('2026-01-01', { morningAnswer: 'x'.repeat(5001) })).status).toBe(400)
    expect((await put('2026-01-01', { morningAnswer: 'x', clientUpdatedAt: 'garbage' })).status).toBe(400)
  })

  it('upserts partial answers without clobbering the other field', async () => {
    await put('2026-01-01', { morningAnswer: 'plan' })
    const { json } = await put('2026-01-01', { eveningAnswer: 'review' })
    expect(json.entry).toMatchObject({ morningAnswer: 'plan', eveningAnswer: 'review' })
    expect(await EntryModel.countDocuments()).toBe(1)
  })

  it('scopes entries to the user', async () => {
    await put('2026-01-01', { morningAnswer: 'mine' })
    session = { user: { id: userB } }
    expect((await (await call('GET', '/2026-01-01')).json()).entry.morningAnswer).toBe('')
    await put('2026-01-01', { morningAnswer: 'theirs' })
    expect(await EntryModel.countDocuments()).toBe(2)
    session = { user: { id: userA } }
    expect((await (await call('GET', '/2026-01-01')).json()).entry.morningAnswer).toBe('mine')
  })

  it('applies last-write-wins per field using clientUpdatedAt', async () => {
    await put('2026-01-01', { morningAnswer: 'new', clientUpdatedAt: '2026-01-01T10:00:00Z' })
    const stale = await put('2026-01-01', { morningAnswer: 'old', eveningAnswer: 'e', clientUpdatedAt: { morningAnswer: '2026-01-01T09:00:00Z', eveningAnswer: '2026-01-01T09:00:00Z' } })
    expect(stale.json.entry).toMatchObject({ morningAnswer: 'new', eveningAnswer: 'e' })
    const newer = await put('2026-01-01', { morningAnswer: 'newest', clientUpdatedAt: '2026-01-01T11:00:00Z' })
    expect(newer.json.entry.morningAnswer).toBe('newest')
  })

  it('clamps future client times to now', () => {
    const now = new Date('2026-01-01T00:00:00Z')
    const patch = parseEntryPatch({ morningAnswer: 'x', clientUpdatedAt: '2099-01-01T00:00:00Z' }, now)
    expect(patch.fields.morningAnswer!.at).toEqual(now)
  })

  it('survives concurrent first upserts', async () => {
    const writes = Array.from({ length: 8 }, (_, i) => saveEntry(userA, '2026-03-03', parseEntryPatch({ morningAnswer: `w${i}` })))
    await expect(Promise.all(writes)).resolves.toHaveLength(8)
    expect(await EntryModel.countDocuments({ user: userA, date: '2026-03-03' })).toBe(1)
  })

  it('today uses the user timezone', async () => {
    const res = await call('GET', '/today')
    expect((await res.json()).entry.date).toBe(localDateString('Pacific/Kiritimati'))
  })
})
