import { existsSync } from 'node:fs'
import { createApp, createError, createRouter, toWebHandler } from 'h3'
import mongoose from 'mongoose'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectDb, disconnectDb } from '../server/utils/db'
import { PushSubscriptionModel } from '../server/models/PushSubscription'
import { UserModel } from '../server/models/User'
import { canonicalTimezone, isAllowedPushEndpoint, parseSettingsPatch } from '../server/utils/settings'
import subscribe from '../server/api/push/subscribe.post'
import unsubscribe from '../server/api/push/unsubscribe.post'
import publicKey from '../server/api/push/public-key.get'
import getSettings from '../server/api/settings/index.get'
import putSettings from '../server/api/settings/index.put'

const TEST_DB = 'daily-agenda-test-push'

let session: { user?: { id: string } } = {}
vi.stubGlobal('clearUserSession', async () => {
  session = {}
})
vi.stubGlobal('requireUserSession', async () => {
  if (!session.user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  return session
})

const handle = toWebHandler(createApp().use(createRouter()
  .post('/sub', subscribe).post('/unsub', unsubscribe).get('/key', publicKey)
  .get('/settings', getSettings).put('/settings', putSettings)))
const call = (path: string, method: string, body?: unknown) => handle(new Request(`http://test${path}`, {
  method,
  headers: { 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
}))
const signIn = async () => {
  const user = await UserModel.create({ email: `${new mongoose.Types.ObjectId().toString()}@example.com`, passwordHash: 'x' })
  session = { user: { id: user.id } }
  return user.id as string
}
const sub = (endpoint = 'https://fcm.googleapis.com/fcm/send/abc') => ({ endpoint, keys: { p256dh: 'BPublicKey_-123', auth: 'authSecret_-1' } })

beforeAll(async () => {
  if (!process.env.MONGODB_URI && existsSync('.env')) process.loadEnvFile('.env')
  await connectDb({ dbName: TEST_DB })
  expect(mongoose.connection.name).toBe(TEST_DB)
  await Promise.all([PushSubscriptionModel.init(), UserModel.init()])
})
beforeEach(async () => {
  session = {}
  await Promise.all([PushSubscriptionModel.deleteMany(), UserModel.deleteMany()])
})
afterAll(async () => {
  if (mongoose.connection.name === TEST_DB) await mongoose.connection.dropDatabase()
  await disconnectDb()
})

describe('canonicalTimezone', () => {
  it('accepts IANA names and canonicalises case', () => {
    expect(canonicalTimezone('Europe/London')).toBe('Europe/London')
    expect(canonicalTimezone('UTC')).toBe('UTC')
    expect(canonicalTimezone('america/new_york')).toBe('America/New_York')
  })
  it.each(['+05:00', '-03:00', 'UTC+5', 'GMT-3', 'Mars/Base', '', 'x'.repeat(100), 5, null])('rejects %s', (v) => {
    expect(canonicalTimezone(v)).toBeNull()
  })
})

describe('parseSettingsPatch', () => {
  it('flattens a valid partial update', () => {
    expect(parseSettingsPatch({ timezone: 'Asia/Karachi', reminderTimes: { morning: '07:30' }, reminderEnabled: { evening: false } }))
      .toEqual({ timezone: 'Asia/Karachi', 'reminderTimes.morning': '07:30', 'reminderEnabled.evening': false })
  })
  it.each([
    [{}], [null], [{ timezone: '+02:00' }], [{ reminderTimes: { morning: '7am' } }],
    [{ reminderEnabled: { morning: 'yes' } }], [{ reminderTimes: { noon: '12:00' } }], [{ passwordHash: 'x' }],
  ])('rejects %j', (body) => {
    expect(() => parseSettingsPatch(body)).toThrow()
  })
})

describe('settings routes', () => {
  it('requires a session', async () => {
    expect((await call('/settings', 'GET')).status).toBe(401)
    expect((await call('/settings', 'PUT', { timezone: 'UTC' })).status).toBe(401)
  })
  it('returns defaults and persists updates for the current user only', async () => {
    const id = await signIn()
    const other = await UserModel.create({ email: 'other@example.com', passwordHash: 'x' })
    const first = await (await call('/settings', 'GET')).json()
    expect(first.settings.reminderEnabled).toEqual({ morning: true, evening: true })
    const res = await call('/settings', 'PUT', { timezone: 'Asia/Karachi', reminderTimes: { evening: '21:15' }, reminderEnabled: { morning: false } })
    expect(res.status).toBe(200)
    const { settings } = await res.json()
    expect(settings).toMatchObject({ timezone: 'Asia/Karachi', reminderTimes: { morning: '08:00', evening: '21:15' }, reminderEnabled: { morning: false, evening: true } })
    expect((await UserModel.findById(id))!.timezone).toBe('Asia/Karachi')
    expect((await UserModel.findById(other.id))!.timezone).toBe('UTC')
  })
  it('rejects offsets with 400 and leaves the timezone unchanged', async () => {
    const id = await signIn()
    expect((await call('/settings', 'PUT', { timezone: '+05:00' })).status).toBe(400)
    expect((await UserModel.findById(id))!.timezone).toBe('UTC')
  })
})

describe('isAllowedPushEndpoint', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/a',
    'https://android.googleapis.com/gcm/send/a',
    'https://updates.push.services.mozilla.com/wpush/v2/a',
    'https://web.push.apple.com/a',
    'https://wns2-par02p.notify.windows.com/w/?token=a',
  ])('allows %s', (url) => {
    expect(isAllowedPushEndpoint(url)).toBe(true)
  })
  it.each([
    'https://storage.googleapis.com/bucket/a',
    'https://storage.googleapis.com/fcm/send/a',
    'https://evil.googleapis.com/wp/a',
    'http://fcm.googleapis.com/fcm/send/a',
    'not a url',
    'https://fcm.googleapis.com.evil.test/fcm/send/a',
    'https://evilpush.apple.com/a',
    'https://push.apple.com.evil.test/a',
    'https://fcm.googleapis.com:8443/fcm/send/a',
    'https://127.0.0.1/fcm/send/a',
  ])('rejects %s', (url) => {
    expect(isAllowedPushEndpoint(url)).toBe(false)
  })
})

describe('push routes', () => {
  it('requires a session', async () => {
    expect((await call('/sub', 'POST', sub())).status).toBe(401)
    expect((await call('/unsub', 'POST', { endpoint: sub().endpoint })).status).toBe(401)
    expect((await call('/key', 'GET')).status).toBe(401)
  })
  it('serves the public key only', async () => {
    await signIn()
    vi.stubEnv('VAPID_PUBLIC_KEY', 'pub-key')
    vi.stubEnv('VAPID_PRIVATE_KEY', 'secret')
    const text = await (await call('/key', 'GET')).text()
    vi.unstubAllEnvs()
    expect(JSON.parse(text)).toEqual({ publicKey: 'pub-key' })
    expect(text).not.toContain('secret')
  })
  it('upserts by endpoint and reassigns it to the new user, resetting reminder dates', async () => {
    const first = await signIn()
    expect((await call('/sub', 'POST', sub())).status).toBe(200)
    await PushSubscriptionModel.updateOne({ endpoint: sub().endpoint }, { lastMorningReminderDate: '2026-01-01' })
    const second = await signIn()
    expect((await call('/sub', 'POST', { ...sub(), keys: { p256dh: 'BNewKey', auth: 'newAuth' } })).status).toBe(200)
    const docs = await PushSubscriptionModel.find().lean()
    expect(docs).toHaveLength(1)
    expect(String(docs[0]!.user)).toBe(second)
    expect(String(docs[0]!.user)).not.toBe(first)
    expect(docs[0]!.keys.p256dh).toBe('BNewKey')
    expect(docs[0]!.lastMorningReminderDate).toBeUndefined()
  })
  it.each([
    ['http endpoint', { ...sub(), endpoint: 'http://push.example.com/x' }],
    ['not a url', { ...sub(), endpoint: 'nope' }],
    ['credentials in url', { ...sub(), endpoint: 'https://u:p@push.example.com/x' }],
    ['huge endpoint', { ...sub(), endpoint: `https://fcm.googleapis.com/fcm/send/${'a'.repeat(3000)}` }],
    ['unknown push host', { ...sub(), endpoint: 'https://push.example.com/abc' }],
    ['missing keys', { endpoint: sub().endpoint }],
    ['oversized key', { endpoint: sub().endpoint, keys: { p256dh: 'A'.repeat(300), auth: 'x' } }],
    ['bad auth chars', { endpoint: sub().endpoint, keys: { p256dh: 'abc', auth: 'a b!' } }],
  ])('rejects %s', async (_name, body) => {
    await signIn()
    expect((await call('/sub', 'POST', body)).status).toBe(400)
    expect(await PushSubscriptionModel.countDocuments()).toBe(0)
  })
  it('keeps at most 10 subscriptions per user', async () => {
    await signIn()
    for (let i = 0; i < 12; i++) await call('/sub', 'POST', sub(`https://fcm.googleapis.com/fcm/send/${i}`))
    expect(await PushSubscriptionModel.countDocuments()).toBe(10)
  })
  it('unsubscribe removes only the callers own subscription', async () => {
    const owner = await signIn()
    await call('/sub', 'POST', sub())
    await signIn()
    await call('/unsub', 'POST', { endpoint: sub().endpoint })
    expect(await PushSubscriptionModel.countDocuments({ user: owner })).toBe(1)
    session = { user: { id: owner } }
    expect((await call('/unsub', 'POST', { endpoint: sub().endpoint })).status).toBe(200)
    expect(await PushSubscriptionModel.countDocuments()).toBe(0)
  })
})
