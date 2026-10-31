import { existsSync } from 'node:fs'
import mongoose from 'mongoose'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { connectDb, disconnectDb } from '../server/utils/db'
import { EntryModel } from '../server/models/Entry'
import { PushSubscriptionModel } from '../server/models/PushSubscription'
import { ScheduleModel } from '../server/models/Schedule'
import { UserModel } from '../server/models/User'

const TEST_DB = 'daily-agenda-test-models'
const models = [UserModel, ScheduleModel, EntryModel, PushSubscriptionModel]

const userId = () => new mongoose.Types.ObjectId()
const block = (id: string) => ({ id, label: 'Work', start: '09:00', end: '10:00', productive: true })

beforeAll(async () => {
  if (!process.env.MONGODB_URI && existsSync('.env')) process.loadEnvFile('.env')
  await connectDb({ dbName: TEST_DB })
  // Guards the destructive cleanup below against ever touching the real database.
  expect(mongoose.connection.name).toBe(TEST_DB)
  await Promise.all(models.map(model => model.init()))
})

beforeEach(async () => {
  await Promise.all(models.map(model => model.deleteMany()))
})

afterAll(async () => {
  if (mongoose.connection.name === TEST_DB) await mongoose.connection.dropDatabase()
  await disconnectDb()
})

describe('connectDb', () => {
  it('reuses the cached connection', async () => {
    expect(await connectDb()).toBe(await connectDb())
    expect(mongoose.connection.readyState).toBe(1)
  })
})

describe('User', () => {
  it('lowercases email and applies defaults', async () => {
    const user = await UserModel.create({ email: ' Ann@Example.COM ', passwordHash: 'h' })
    expect(user.email).toBe('ann@example.com')
    expect(user.timezone).toBe('UTC')
    expect(user.reminderTimes.morning).toMatch(/^\d{2}:\d{2}$/)
  })

  it('rejects a duplicate email regardless of case', async () => {
    await UserModel.create({ email: 'a@example.com', passwordHash: 'h' })
    await expect(UserModel.create({ email: 'A@example.com', passwordHash: 'h' }))
      .rejects.toMatchObject({ code: 11000 })
  })

  it('validates timezone and reminder times', async () => {
    await expect(UserModel.create({ email: 'b@example.com', passwordHash: 'h', timezone: 'Mars/Base' }))
      .rejects.toThrow(/timezone/)
    await expect(UserModel.create({
      email: 'c@example.com',
      passwordHash: 'h',
      reminderTimes: { morning: '25:00' },
    })).rejects.toThrow(/HH:mm/)
  })

  it('keeps secrets out of JSON output', async () => {
    const user = await UserModel.create({
      email: 'd@example.com',
      passwordHash: 'h',
      passwordReset: { tokenHash: 't', expiresAt: new Date() },
    })
    const json = user.toJSON() as unknown as Record<string, unknown>
    expect(json.passwordHash).toBeUndefined()
    expect(json.passwordReset).toBeUndefined()
    expect(user.passwordReset?.tokenHash).toBe('t')
  })
})

describe('Schedule', () => {
  it('stores block ids and allows one schedule per user', async () => {
    const user = userId()
    const saved = await ScheduleModel.create({ user, blocks: [block('b1')] })
    expect(saved.blocks[0]?.id).toBe('b1')
    await expect(ScheduleModel.create({ user })).rejects.toMatchObject({ code: 11000 })
  })

  it('rejects bad times and repeated block ids', async () => {
    await expect(ScheduleModel.create({ user: userId(), blocks: [{ ...block('b1'), end: '9pm' }] }))
      .rejects.toThrow(/HH:mm/)
    await expect(ScheduleModel.create({ user: userId(), blocks: [block('b1'), block('b1')] }))
      .rejects.toThrow(/unique/)
  })
})

describe('Entry', () => {
  it('is unique per user and date, and sets updatedAt', async () => {
    const user = userId()
    const entry = await EntryModel.create({ user, date: '2026-10-31' })
    expect(entry.updatedAt).toBeInstanceOf(Date)
    expect(entry.morningAnswer).toBe('')
    await expect(EntryModel.create({ user, date: '2026-10-31' })).rejects.toMatchObject({ code: 11000 })
    await expect(EntryModel.create({ user, date: '2026-11-01' })).resolves.toBeDefined()
    await expect(EntryModel.create({ user: userId(), date: '2026-10-31' })).resolves.toBeDefined()
  })

  it('validates date and block status', async () => {
    await expect(EntryModel.create({ user: userId(), date: '2026-02-30' })).rejects.toThrow(/YYYY-MM-DD/)
    await expect(EntryModel.create({
      user: userId(),
      date: '2026-10-31',
      blockStatuses: [{ blockId: 'b1', label: 'Work', start: '09:00', end: '10:00', status: 'maybe' as 'done' }],
    })).rejects.toThrow(/status/)
  })
})

describe('PushSubscription', () => {
  const subscription = () => ({ user: userId(), endpoint: 'https://push.test/1', keys: { p256dh: 'p', auth: 'a' } })

  it('requires a unique endpoint', async () => {
    await PushSubscriptionModel.create(subscription())
    await expect(PushSubscriptionModel.create(subscription())).rejects.toMatchObject({ code: 11000 })
  })

  it('requires keys and validates reminder markers', async () => {
    await expect(PushSubscriptionModel.create({ ...subscription(), keys: { p256dh: 'p' } }))
      .rejects.toThrow(/auth/)
    await expect(PushSubscriptionModel.create({ ...subscription(), lastMorningReminderDate: 'today' }))
      .rejects.toThrow(/YYYY-MM-DD/)
  })
})
