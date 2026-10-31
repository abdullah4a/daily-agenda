import { existsSync } from 'node:fs'
import { createApp, createError, createRouter, toWebHandler } from 'h3'
import mongoose from 'mongoose'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectDb, disconnectDb } from '../server/utils/db'
import { ScheduleModel } from '../server/models/Schedule'
import { UserModel } from '../server/models/User'
import { franklinDefaults, validateBlocks } from '../server/utils/schedule'
import getSchedule from '../server/api/schedule/index.get'
import putSchedule from '../server/api/schedule/index.put'

const TEST_DB = 'daily-agenda-test-schedule'

let session: { user?: { id: string } } = {}
vi.stubGlobal('clearUserSession', async () => {
  session = {}
})
vi.stubGlobal('requireUserSession', async () => {
  if (!session.user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  return session
})

const handle = toWebHandler(createApp().use(createRouter().get('/s', getSchedule).put('/s', putSchedule)))
const get = () => handle(new Request('http://test/s'))
const put = (body: unknown) => handle(new Request('http://test/s', {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
}))
const signIn = async () => {
  const user = await UserModel.create({
    email: `${new mongoose.Types.ObjectId().toString()}@example.com`,
    passwordHash: 'x',
  })
  session = { user: { id: user.id } }
  return user.id as string
}
const b = (id: string, start: string, end: string, extra = {}) => ({ id, label: id, start, end, productive: false, ...extra })

beforeAll(async () => {
  if (!process.env.MONGODB_URI && existsSync('.env')) process.loadEnvFile('.env')
  await connectDb({ dbName: TEST_DB })
  expect(mongoose.connection.name).toBe(TEST_DB)
  await Promise.all([ScheduleModel.init(), UserModel.init()])
})
beforeEach(async () => {
  session = {}
  await Promise.all([ScheduleModel.deleteMany(), UserModel.deleteMany()])
})
afterAll(async () => {
  if (mongoose.connection.name === TEST_DB) await mongoose.connection.dropDatabase()
  await disconnectDb()
})

describe('defaults', () => {
  it('pass their own validation', () => {
    expect(validateBlocks(franklinDefaults()).ok).toBe(true)
  })
})

describe('GET /schedule', () => {
  it('rejects anonymous callers', async () => {
    expect((await get()).status).toBe(401)
  })

  it('seeds Franklin defaults with productive work', async () => {
    await signIn()
    const { blocks } = await (await get()).json()
    expect(blocks).toHaveLength(6)
    const productive = blocks.filter((x: { productive: boolean }) => x.productive)
    expect(productive.map((x: { label: string }) => x.label)).toEqual(['Work', 'Work'])
    expect(blocks.at(-1)).toMatchObject({ start: '22:00', end: '05:00' })
  })

  it('does not duplicate under concurrent first use', async () => {
    const id = await signIn()
    const responses = await Promise.all(Array.from({ length: 10 }, () => get()))
    expect(responses.every(r => r.status === 200)).toBe(true)
    expect(await ScheduleModel.countDocuments({ user: id })).toBe(1)
  })

  it('is scoped to the user', async () => {
    await signIn()
    await put({ blocks: [b('a', '09:00', '10:00')] })
    await signIn()
    expect((await (await get()).json()).blocks).toHaveLength(6)
  })
})

describe('PUT /schedule', () => {
  it('rejects anonymous callers', async () => {
    expect((await put({ blocks: [] })).status).toBe(401)
  })

  it('replaces blocks and defaults productive to false', async () => {
    await signIn()
    const res = await put({ blocks: [{ id: 'a', label: ' Deep work ', start: '09:00', end: '10:00' }] })
    expect(res.status).toBe(200)
    expect((await (await get()).json()).blocks).toEqual([b('a', '09:00', '10:00', { label: 'Deep work' })])
  })

  it('returns 400 for invalid payloads and leaves data intact', async () => {
    await signIn()
    await get()
    expect((await put({ blocks: 'x' })).status).toBe(400)
    expect((await put({})).status).toBe(400)
    expect((await (await get()).json()).blocks).toHaveLength(6)
  })
})

describe('validateBlocks', () => {
  const bad = (blocks: unknown) => expect(validateBlocks(blocks).ok).toBe(false)

  it('rejects bad times, labels, ids and types', () => {
    bad([b('a', '9:00', '10:00')])
    bad([b('a', '09:00', '24:00')])
    bad([b('a', '09:00', '10:00', { label: '' })])
    bad([b('a', '09:00', '10:00', { label: 'x'.repeat(61) })])
    bad([b('a', '09:00', '10:00'), b('a', '11:00', '12:00')])
    bad([b('', '09:00', '10:00')])
    bad([b('a', '09:00', '10:00', { productive: 'yes' })])
    bad([null])
  })

  it('rejects zero-length blocks, a second overnight block, and too many blocks', () => {
    bad([b('a', '09:00', '09:00')])
    bad([b('a', '22:00', '05:00'), b('b', '23:00', '01:00')])
    bad(Array.from({ length: 31 }, (_, i) => b(`id${i}`, '00:00', '00:01')))
  })

  it('detects overlaps including across midnight', () => {
    bad([b('a', '09:00', '11:00'), b('b', '10:00', '12:00')])
    bad([b('a', '22:00', '05:00'), b('b', '04:00', '06:00')])
    bad([b('a', '22:00', '05:00'), b('b', '23:00', '23:30')])
  })

  it('allows touching blocks and one overnight block', () => {
    expect(validateBlocks([b('a', '09:00', '10:00'), b('b', '10:00', '11:00'), b('s', '22:00', '09:00')]).ok).toBe(true)
  })
})
