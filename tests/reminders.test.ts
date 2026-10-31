import { existsSync } from 'node:fs'
import { createApp, createRouter, toWebHandler } from 'h3'
import mongoose from 'mongoose'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectDb, disconnectDb } from '../server/utils/db'
import { EntryModel } from '../server/models/Entry'
import { PushSubscriptionModel } from '../server/models/PushSubscription'
import { UserModel } from '../server/models/User'
import { dueReminderDate, isAuthorizedCron, reminderPayload, sendDueReminders } from '../server/utils/reminders'
import cronGet from '../server/api/cron/reminders.get'
import cronPost from '../server/api/cron/reminders.post'

const { sendNotification, setVapidDetails } = vi.hoisted(() => ({
  sendNotification: vi.fn(),
  setVapidDetails: vi.fn(),
}))
vi.mock('web-push', () => ({ default: { sendNotification, setVapidDetails } }))

const TEST_DB = 'daily-agenda-test-reminders'
const NOON_UTC = new Date('2026-06-15T12:05:00Z')
const LATER = new Date('2026-06-15T12:10:00Z')

const handle = toWebHandler(createApp().use(createRouter().get('/cron', cronGet).post('/cron', cronPost)))
const call = (method: string, authorization?: string) => handle(new Request('http://test/cron', {
  method,
  headers: authorization ? { authorization } : {},
}))

let endpointCounter = 0
function device(user: { _id: unknown }, extra: Record<string, unknown> = {}) {
  return new PushSubscriptionModel({
    user: user._id,
    endpoint: `https://fcm.googleapis.com/fcm/send/${++endpointCounter}`,
    keys: { p256dh: 'p', auth: 'a' },
    ...extra,
  }).save()
}
const makeUser = (extra: Record<string, unknown> = {}) => UserModel.create({
  email: `${new mongoose.Types.ObjectId().toString()}@example.com`,
  passwordHash: 'x',
  timezone: 'UTC',
  reminderTimes: { morning: '12:00', evening: '20:00' },
  ...extra,
})
const statusError = (statusCode: number) => Object.assign(new Error('push'), { statusCode })

beforeAll(async () => {
  if (!process.env.MONGODB_URI && existsSync('.env')) process.loadEnvFile('.env')
  await connectDb({ dbName: TEST_DB })
  expect(mongoose.connection.name).toBe(TEST_DB)
  await Promise.all([PushSubscriptionModel.init(), UserModel.init(), EntryModel.init()])
})
beforeEach(async () => {
  sendNotification.mockReset().mockResolvedValue({ statusCode: 201 })
  setVapidDetails.mockReset()
  await Promise.all([PushSubscriptionModel.deleteMany(), UserModel.deleteMany(), EntryModel.deleteMany()])
})
afterAll(async () => {
  if (mongoose.connection.name === TEST_DB) await mongoose.connection.dropDatabase()
  await disconnectDb()
})

describe('dueReminderDate', () => {
  const due = (time: string, tz: string, iso: string) => dueReminderDate(time, tz, new Date(iso))

  it('is due from the minute itself until just before the tolerance ends', () => {
    expect(due('08:00', 'UTC', '2026-06-15T07:59:59Z')).toBeNull()
    expect(due('08:00', 'UTC', '2026-06-15T08:00:00Z')).toBe('2026-06-15')
    expect(due('08:00', 'UTC', '2026-06-15T08:14:59Z')).toBe('2026-06-15')
    expect(due('08:00', 'UTC', '2026-06-15T08:15:00Z')).toBeNull()
  })

  it('uses the local time of the zone, including half-hour offsets', () => {
    expect(due('08:00', 'Asia/Kolkata', '2026-06-15T02:35:00Z')).toBe('2026-06-15')
    expect(due('08:00', 'America/New_York', '2026-06-15T12:05:00Z')).toBe('2026-06-15')
    expect(due('08:00', 'America/New_York', '2026-06-15T08:05:00Z')).toBeNull()
  })

  it('keeps the date of the reminder when the window crosses local midnight', () => {
    expect(due('23:55', 'Asia/Tokyo', '2026-06-15T15:05:00Z')).toBe('2026-06-15')
    expect(due('23:55', 'UTC', '2027-01-01T00:05:00Z')).toBe('2026-12-31')
  })

  it('follows the offset on each side of a DST change', () => {
    expect(due('08:00', 'America/New_York', '2026-03-07T13:05:00Z')).toBe('2026-03-07')
    expect(due('08:00', 'America/New_York', '2026-03-08T12:05:00Z')).toBe('2026-03-08')
    expect(due('08:00', 'America/New_York', '2026-03-08T13:05:00Z')).toBeNull()
  })

  it('fires a time skipped by spring-forward one hour later on the wall clock', () => {
    // New York jumps from 02:00 to 03:00 at 07:00Z.
    expect(due('02:30', 'America/New_York', '2026-03-08T07:29:00Z')).toBeNull()
    expect(due('02:30', 'America/New_York', '2026-03-08T07:35:00Z')).toBe('2026-03-08')
  })

  it('treats a time repeated by fall-back as due in both passes, leaving dedupe to send once', () => {
    expect(due('01:30', 'America/New_York', '2026-11-01T05:35:00Z')).toBe('2026-11-01')
    expect(due('01:30', 'America/New_York', '2026-11-01T06:00:00Z')).toBeNull()
    expect(due('01:30', 'America/New_York', '2026-11-01T06:35:00Z')).toBe('2026-11-01')
  })

  it('handles a half-hour DST shift', () => {
    // Lord Howe moves from +10:30 to +11:00 on 2026-10-04.
    expect(due('08:00', 'Australia/Lord_Howe', '2026-10-03T21:05:00Z')).toBe('2026-10-04')
    expect(due('08:00', 'Australia/Lord_Howe', '2026-10-03T21:35:00Z')).toBeNull()
  })
})

describe('isAuthorizedCron', () => {
  it('fails closed when the secret is empty', () => {
    expect(isAuthorizedCron('Bearer x', '')).toBe(false)
    expect(isAuthorizedCron('Bearer ', '')).toBe(false)
  })
  it('accepts only the exact bearer value', () => {
    expect(isAuthorizedCron('Bearer s3cret', 's3cret')).toBe(true)
    expect(isAuthorizedCron('Bearer wrong', 's3cret')).toBe(false)
    expect(isAuthorizedCron('s3cret', 's3cret')).toBe(false)
    expect(isAuthorizedCron(undefined, 's3cret')).toBe(false)
  })
})

describe('sendDueReminders', () => {
  it('sends the payload to every device of a due user', async () => {
    const user = await makeUser()
    await device(user)
    await device(user)
    await device(await makeUser({ reminderTimes: { morning: '09:00', evening: '20:00' } }))

    const summary = await sendDueReminders({ now: NOON_UTC })

    expect(summary).toMatchObject({ usersChecked: 2, due: 1, sent: 2, failed: 0 })
    expect(JSON.parse(sendNotification.mock.calls[0]![1])).toEqual({
      title: 'Daily Agenda', body: 'What good shall I do this day?', url: '/', tag: 'morning-reminder',
    })
    expect(reminderPayload('evening').body).toBe('What good have I done today?')
  })

  it('treats missing reminderEnabled as on and respects an explicit false', async () => {
    const legacy = await makeUser()
    await UserModel.collection.updateOne({ _id: legacy._id }, { $unset: { reminderEnabled: '' } })
    const expected = await device(legacy)
    await device(await makeUser({ reminderEnabled: { morning: false, evening: true } }))

    expect((await sendDueReminders({ now: NOON_UTC })).sent).toBe(1)
    expect(sendNotification.mock.calls[0]![0].endpoint).toBe(expected.endpoint)
  })

  it('skips an already answered slot, ignoring blank answers', async () => {
    const answered = await makeUser()
    await device(answered)
    await EntryModel.create({ user: answered._id, date: '2026-06-15', morningAnswer: 'Call mum' })
    const blank = await makeUser()
    await device(blank)
    await EntryModel.create({ user: blank._id, date: '2026-06-15', morningAnswer: '   ' })

    expect(await sendDueReminders({ now: NOON_UTC })).toMatchObject({ skippedAnswered: 1, sent: 1 })
  })

  it('checks the answer against the reminder date across midnight', async () => {
    const user = await makeUser({ reminderTimes: { morning: '08:00', evening: '23:55' } })
    await device(user)
    await EntryModel.create({ user: user._id, date: '2026-06-15', eveningAnswer: 'Helped out' })

    const summary = await sendDueReminders({ now: new Date('2026-06-16T00:05:00Z') })
    expect(summary).toMatchObject({ skippedAnswered: 1, sent: 0 })
  })

  it('does not send twice on a later run the same day', async () => {
    await device(await makeUser())
    await sendDueReminders({ now: NOON_UTC })
    expect(await sendDueReminders({ now: LATER })).toMatchObject({ sent: 0, alreadySent: 1 })
    expect(sendNotification).toHaveBeenCalledTimes(1)
  })

  it('dedupes per device, so a new device still gets the reminder', async () => {
    const user = await makeUser()
    await device(user, { lastMorningReminderDate: '2026-06-15' })
    await device(user)
    expect(await sendDueReminders({ now: NOON_UTC })).toMatchObject({ sent: 1, alreadySent: 1 })
  })

  it('sends once across overlapping runs', async () => {
    const user = await makeUser()
    await device(user)
    await device(user)
    await device(await makeUser())

    const runs = await Promise.all(Array.from({ length: 6 }, () => sendDueReminders({ now: NOON_UTC })))

    expect(sendNotification).toHaveBeenCalledTimes(3)
    expect(runs.reduce((total, r) => total + r.sent, 0)).toBe(3)
  })

  it('claims before sending', async () => {
    const sub = await device(await makeUser())
    let storedDuringSend: string | undefined
    sendNotification.mockImplementation(async () => {
      storedDuringSend = (await PushSubscriptionModel.findById(sub._id))?.lastMorningReminderDate
    })
    await sendDueReminders({ now: NOON_UTC })
    expect(storedDuringSend).toBe('2026-06-15')
  })

  it.each([404, 410])('removes a subscription on %i', async (status) => {
    const sub = await device(await makeUser())
    sendNotification.mockRejectedValue(statusError(status))

    expect(await sendDueReminders({ now: NOON_UTC })).toMatchObject({ removed: 1, failed: 0, sent: 0 })
    expect(await PushSubscriptionModel.findById(sub._id)).toBeNull()
  })

  it.each([
    ['server error', statusError(503)],
    ['rate limit', statusError(429)],
    ['network failure', new Error('socket hang up')],
  ])('releases the claim after a %s so a later run retries', async (_label, error) => {
    const sub = await device(await makeUser())
    sendNotification.mockRejectedValueOnce(error)

    expect(await sendDueReminders({ now: NOON_UTC })).toMatchObject({ failed: 1, sent: 0 })
    const stored = await PushSubscriptionModel.findById(sub._id).lean()
    expect(stored).not.toBeNull()
    expect(stored?.lastMorningReminderDate).toBeUndefined()

    expect((await sendDueReminders({ now: LATER })).sent).toBe(1)
  })

  it('restores the previous date when releasing', async () => {
    const sub = await device(await makeUser(), { lastMorningReminderDate: '2026-06-14' })
    sendNotification.mockRejectedValueOnce(statusError(500))
    await sendDueReminders({ now: NOON_UTC })
    expect((await PushSubscriptionModel.findById(sub._id))?.lastMorningReminderDate).toBe('2026-06-14')
  })

  it('does not stop other devices when one fails', async () => {
    const user = await makeUser()
    await device(user)
    await device(user)
    sendNotification.mockRejectedValueOnce(statusError(500))
    expect(await sendDueReminders({ now: NOON_UTC, concurrency: 1 })).toMatchObject({ failed: 1, sent: 1 })
  })

  it('caps concurrent sends', async () => {
    const user = await makeUser()
    for (let i = 0; i < 6; i++) await device(user)
    let active = 0
    let peak = 0
    // The first send waits for the second, as a fixed delay can end first when the database is slow.
    let release = () => {}
    const overlapped = new Promise<void>((resolve) => { release = resolve })
    sendNotification.mockImplementation(async () => {
      peak = Math.max(peak, ++active)
      if (active >= 2) release()
      await overlapped
      await new Promise(resolve => setTimeout(resolve, 10))
      active--
    })
    expect((await sendDueReminders({ now: NOON_UTC, concurrency: 2, budgetMs: 60_000 })).sent).toBe(6)
    expect(peak).toBe(2)
  })

  it('pages through users across batches', async () => {
    for (let i = 0; i < 5; i++) await device(await makeUser())
    expect(await sendDueReminders({ now: NOON_UTC, batchSize: 2 })).toMatchObject({ usersChecked: 5, sent: 5 })
  })

  it('leaves work unclaimed once the deadline has passed', async () => {
    const sub = await device(await makeUser())
    expect(await sendDueReminders({ now: NOON_UTC, budgetMs: 0 })).toMatchObject({ sent: 0, deferred: 1 })
    expect((await PushSubscriptionModel.findById(sub._id))?.lastMorningReminderDate).toBeUndefined()
  })

  it('skips a user whose stored settings are unusable, without failing the run', async () => {
    const broken = await makeUser()
    await UserModel.collection.updateOne({ _id: broken._id }, { $set: { timezone: 'Mars/Base' } })
    await device(broken)
    await device(await makeUser())
    expect(await sendDueReminders({ now: NOON_UTC })).toMatchObject({ invalidUsers: 1, sent: 1 })
  })
})

describe('cron endpoint', () => {
  const env = { ...process.env }
  beforeEach(() => {
    process.env.CRON_SECRET = 'cron-secret'
    process.env.VAPID_PUBLIC_KEY = 'public'
    process.env.VAPID_PRIVATE_KEY = 'private'
    delete process.env.VAPID_SUBJECT
  })
  afterAll(() => {
    process.env = env
  })

  it('rejects a missing or wrong token', async () => {
    expect((await call('GET')).status).toBe(401)
    expect((await call('POST', 'Bearer nope')).status).toBe(401)
    expect(sendNotification).not.toHaveBeenCalled()
  })

  it('fails closed when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET
    expect((await call('GET', 'Bearer undefined')).status).toBe(401)
  })

  it.each(['GET', 'POST'])('runs on %s and returns only counts', async (method) => {
    const response = await call(method, 'Bearer cron-secret')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    for (const value of Object.values(await response.json())) expect(typeof value).toBe('number')
  })

  it('returns 503 without VAPID keys', async () => {
    delete process.env.VAPID_PRIVATE_KEY
    expect((await call('GET', 'Bearer cron-secret')).status).toBe(503)
  })

  it('uses VAPID_SUBJECT, with a fallback', async () => {
    await call('GET', 'Bearer cron-secret')
    expect(setVapidDetails).toHaveBeenLastCalledWith('mailto:noreply@example.com', 'public', 'private')
    process.env.VAPID_SUBJECT = 'mailto:me@example.org'
    await call('GET', 'Bearer cron-secret')
    expect(setVapidDetails).toHaveBeenLastCalledWith('mailto:me@example.org', 'public', 'private')
  })
})

describe('stored endpoints off the allow-list', () => {
  it('are deleted and never called', async () => {
    const user = await makeUser()
    const good = await device(user)
    const bad = await device(user, { endpoint: 'https://internal.example.com/push' })
    sendNotification.mockClear()
    sendNotification.mockResolvedValue({})
    const summary = await sendDueReminders({ now: NOON_UTC })
    expect(sendNotification).toHaveBeenCalledTimes(1)
    expect(sendNotification.mock.calls[0]![0].endpoint).toBe(good.endpoint)
    expect(summary).toMatchObject({ sent: 1, removed: 1 })
    expect(await PushSubscriptionModel.findById(bad._id)).toBeNull()
  })
})
