import { existsSync } from 'node:fs'
import bcrypt from 'bcryptjs'
import { createApp, createError, createRouter, toWebHandler, type H3Event } from 'h3'
import mongoose from 'mongoose'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectDb, disconnectDb } from '../server/utils/db'
import { RateLimitModel } from '../server/models/RateLimit'
import { PushSubscriptionModel } from '../server/models/PushSubscription'
import { UserModel } from '../server/models/User'
import { DUMMY_PASSWORD_HASH, hashAccountPassword, normaliseEmail } from '../server/utils/accounts'
import { consumeRateLimit } from '../server/utils/rateLimit'
import { requireUser } from '../server/utils/requireUser'
import login from '../server/api/auth/login.post'
import logout from '../server/api/auth/logout.post'
import me from '../server/api/auth/me.get'
import signup from '../server/api/auth/signup.post'

const TEST_DB = 'daily-agenda-test-auth'
const PASSWORD = 'correct horse'

// The session layer is a Nuxt auto-import; a variable stands in for the sealed cookie.
let session: { user?: { id: string, email: string, sessionVersion?: number } } = {}
vi.stubGlobal('replaceUserSession', async (_event: H3Event, data: typeof session) => {
  session = data
})
vi.stubGlobal('clearUserSession', async () => {
  session = {}
})
vi.stubGlobal('getUserSession', async () => session)
vi.stubGlobal('requireUserSession', async () => {
  if (!session.user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  return session
})

const router = createRouter()
  .post('/signup', signup)
  .post('/login', login)
  .post('/logout', logout)
  .get('/me', me)
const handle = toWebHandler(createApp().use(router))

let ipCounter = 0
let clientIp = ''

function send(path: string, body?: unknown, ip = clientIp) {
  return handle(new Request(`http://test${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: body === undefined ? undefined : JSON.stringify(body),
  }))
}

const credentials = (email = 'ann@example.com') => ({ email, password: PASSWORD })

beforeAll(async () => {
  if (!process.env.MONGODB_URI && existsSync('.env')) process.loadEnvFile('.env')
  await connectDb({ dbName: TEST_DB })
  // Guards the destructive cleanup below against ever touching the real database.
  expect(mongoose.connection.name).toBe(TEST_DB)
  await Promise.all([UserModel.init(), RateLimitModel.init()])
})

beforeEach(async () => {
  session = {}
  clientIp = `10.0.0.${++ipCounter}`
  await Promise.all([UserModel.deleteMany(), RateLimitModel.deleteMany()])
})

afterAll(async () => {
  if (mongoose.connection.name === TEST_DB) await mongoose.connection.dropDatabase()
  await disconnectDb()
})

describe('normaliseEmail', () => {
  it('trims and lowercases, and rejects bad input', () => {
    expect(normaliseEmail('  Ann@Example.COM ')).toBe('ann@example.com')
    expect(normaliseEmail('not-an-email')).toBeNull()
    expect(normaliseEmail({ $gt: '' })).toBeNull()
    expect(normaliseEmail(`${'a'.repeat(250)}@b.co`)).toBeNull()
  })
})

describe('dummy hash', () => {
  it('uses the same cost as real hashes', async () => {
    const real = await hashAccountPassword(PASSWORD)
    expect(bcrypt.getRounds(DUMMY_PASSWORD_HASH)).toBe(bcrypt.getRounds(real))
  })
})

describe('POST signup', () => {
  it('creates a user, signs in, and exposes no secrets', async () => {
    const response = await send('/signup', credentials(' Ann@Example.com '))
    expect(response.status).toBe(201)
    const text = await response.text()
    expect(text).not.toMatch(/passwordHash|passwordReset|\$2[aby]\$/)
    expect(JSON.parse(text).user).toMatchObject({ email: 'ann@example.com', timezone: 'UTC' })

    const stored = await UserModel.findOne({ email: 'ann@example.com' })
    expect(stored?.passwordHash).not.toBe(PASSWORD)
    expect(session.user?.id).toBe(stored?.id)
  })

  it.each([
    [{ email: 'bad', password: PASSWORD }],
    [{ email: 'a@example.com', password: 'short' }],
    [{ email: 'a@example.com', password: 'x'.repeat(73) }],
    [{ email: 'a@example.com', password: { $ne: '' } }],
    [{}],
  ])('rejects invalid input %j', async (body) => {
    expect((await send('/signup', body)).status).toBe(400)
    expect(await UserModel.countDocuments()).toBe(0)
  })

  it('returns 409 for a repeated email', async () => {
    await send('/signup', credentials())
    session = {}
    expect((await send('/signup', credentials('ANN@example.com'))).status).toBe(409)
    expect(session.user).toBeUndefined()
  })

  it('lets the unique index settle a concurrent race', async () => {
    const responses = await Promise.all([send('/signup', credentials()), send('/signup', credentials())])
    expect(responses.map(response => response.status).sort()).toEqual([201, 409])
    expect(await UserModel.countDocuments()).toBe(1)
  })
})

describe('POST login', () => {
  beforeEach(async () => {
    await UserModel.create({ email: 'ann@example.com', passwordHash: await hashAccountPassword(PASSWORD) })
  })

  it('signs in with a differently cased email', async () => {
    const response = await send('/login', credentials('ANN@example.com'))
    expect(response.status).toBe(200)
    expect(await response.text()).not.toMatch(/passwordHash|passwordReset/)
    expect(session.user?.email).toBe('ann@example.com')
  })

  it('answers identically for unknown email and wrong password', async () => {
    const unknown = await send('/login', credentials('nobody@example.com'))
    const wrong = await send('/login', { email: 'ann@example.com', password: 'wrong password' })
    expect(unknown.status).toBe(401)
    expect(wrong.status).toBe(401)
    const strip = (text: string) => { const { stack: _stack, ...rest } = JSON.parse(text); return rest }
    expect(strip(await unknown.text())).toEqual(strip(await wrong.text()))
    expect(session.user).toBeUndefined()
  })

  it('compares against the dummy hash for an unknown email', async () => {
    const compare = vi.spyOn(bcrypt, 'compare')
    await send('/login', credentials('nobody@example.com'))
    expect(compare).toHaveBeenCalledWith(PASSWORD, DUMMY_PASSWORD_HASH)
    compare.mockRestore()
  })

  it('rejects a password that matches only on its first 72 bytes', async () => {
    const base = 'p'.repeat(72)
    await UserModel.create({ email: 'long@example.com', passwordHash: await hashAccountPassword(base) })
    expect((await send('/login', { email: 'long@example.com', password: base })).status).toBe(200)
    session = {}
    expect((await send('/login', { email: 'long@example.com', password: `${base}extra` })).status).toBe(401)
  })

  it('rejects non-string credentials as a bad request', async () => {
    expect((await send('/login', { email: { $gt: '' }, password: { $gt: '' } })).status).toBe(400)
  })

  it('limits one email from one address, without revealing whether it exists', async () => {
    for (const email of ['ann@example.com', 'nobody@example.com']) {
      for (let attempt = 0; attempt < 10; attempt++) await send('/login', { email, password: 'wrong' })
      const blocked = await send('/login', { email, password: 'wrong' })
      expect(blocked.status).toBe(429)
      expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
    }
  }, 180_000)

  it('does not let one address lock the owner out from another', async () => {
    await send('/signup', credentials())
    for (let attempt = 0; attempt < 11; attempt++) await send('/login', { ...credentials(), password: 'wrong' })
    expect((await send('/login', credentials(), '10.9.9.9')).status).toBe(200)
  }, 180_000)

  it('caps one email across many addresses', async () => {
    for (let attempt = 0; attempt < 50; attempt++) {
      await send('/login', { email: 'ann@example.com', password: 'wrong' }, `10.1.${attempt}.1`)
    }
    expect((await send('/login', { email: 'ann@example.com', password: 'wrong' }, '10.2.0.1')).status).toBe(429)
  }, 180_000)

  it('limits attempts per address across emails', async () => {
    for (let attempt = 0; attempt < 30; attempt++) {
      await send('/login', { email: `u${attempt}@example.com`, password: 'wrong' })
    }
    expect((await send('/login', credentials())).status).toBe(429)
  }, 180_000)
})

describe('signup timezone', () => {
  const zoneAfter = async (timezone: unknown) => {
    await send('/signup', { ...credentials(), timezone })
    return (await UserModel.findOne({ email: 'ann@example.com' }))!.timezone
  }
  it('stores a valid browser timezone in canonical form', async () => {
    expect(await zoneAfter('asia/karachi')).toBe('Asia/Karachi')
  })
  it.each(['+05:00', 'Mars/Base', 7, undefined])('falls back to UTC for %s', async (timezone) => {
    expect(await zoneAfter(timezone)).toBe('UTC')
  })
})

describe('logout', () => {
  const endpoint = 'https://fcm.googleapis.com/fcm/send/abc'
  const keys = { p256dh: 'k', auth: 'a' }
  it('removes this device subscription with the session, and only the callers', async () => {
    await send('/signup', credentials())
    const id = session.user!.id
    const other = new mongoose.Types.ObjectId()
    await PushSubscriptionModel.deleteMany()
    await PushSubscriptionModel.create([{ user: id, endpoint, keys }, { user: other, endpoint: `${endpoint}2`, keys }])
    expect((await send('/logout', { endpoint: `${endpoint}2` })).status).toBe(200)
    expect(await PushSubscriptionModel.countDocuments({ user: other })).toBe(1)
    await send('/login', credentials())
    expect((await send('/logout', { endpoint })).status).toBe(200)
    expect(await PushSubscriptionModel.countDocuments({ user: id })).toBe(0)
    await PushSubscriptionModel.deleteMany()
  })
  it('still signs out with a junk endpoint or no session', async () => {
    await send('/signup', credentials())
    expect((await send('/logout', { endpoint: 'nope' })).status).toBe(200)
    expect(session).toEqual({})
    expect((await send('/logout', {})).status).toBe(200)
  })
})

describe('signup rate limit', () => {
  it('blocks the eleventh signup from one address', async () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      expect((await send('/signup', credentials(`u${attempt}@example.com`))).status).toBe(201)
    }
    expect((await send('/signup', credentials('u11@example.com'))).status).toBe(429)
  }, 180_000)
})

describe('consumeRateLimit', () => {
  const rule = { scope: 'test', subject: 'a', limit: 2, windowMs: 60_000 }

  it('starts a new window after expiry', async () => {
    await consumeRateLimit(rule)
    await consumeRateLimit(rule)
    expect((await consumeRateLimit(rule)).allowed).toBe(false)
    await RateLimitModel.updateMany({}, { expiresAt: new Date(Date.now() - 1000) })
    expect((await consumeRateLimit(rule)).allowed).toBe(true)
  })

  it('counts concurrent requests without loss and stores no plain subject', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => consumeRateLimit(rule)))
    expect(results.filter(result => result.allowed)).toHaveLength(2)
    const [doc] = await RateLimitModel.find()
    expect(doc?.count).toBe(6)
    expect(doc?.key).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('session routes', () => {
  it('returns the current user from me', async () => {
    await send('/signup', credentials())
    const response = await send('/me')
    expect(response.status).toBe(200)
    expect((await response.json()).user.email).toBe('ann@example.com')
  })

  it('returns 401 from me when signed out', async () => {
    expect((await send('/me')).status).toBe(401)
  })

  it('clears the session when the account no longer exists', async () => {
    await send('/signup', credentials())
    await UserModel.deleteMany()
    expect((await send('/me')).status).toBe(401)
    expect(session.user).toBeUndefined()
  })

  it('signs out', async () => {
    await send('/signup', credentials())
    expect((await send('/logout', {})).status).toBe(200)
    expect((await send('/me')).status).toBe(401)
  })
})

describe('requireUser', () => {
  it('returns the session user id', async () => {
    const user = await UserModel.create({ email: 'a@example.com', passwordHash: 'x' })
    session = { user: { id: user.id, email: user.email } }
    await expect(requireUser({} as H3Event)).resolves.toBe(user.id)
  })

  it('throws 401 without a session', async () => {
    await expect(requireUser({} as H3Event)).rejects.toMatchObject({ statusCode: 401 })
  })
})

describe('auth middleware', () => {
  const navigateTo = vi.fn((path: string) => path)
  let loggedIn = false
  let guard: (to: { path: string }) => unknown

  beforeAll(async () => {
    vi.stubGlobal('defineNuxtRouteMiddleware', (fn: typeof guard) => fn)
    vi.stubGlobal('useUserSession', () => ({ loggedIn: { value: loggedIn } }))
    vi.stubGlobal('navigateTo', navigateTo)
    guard = (await import('../middleware/auth.global')).default as unknown as typeof guard
  })

  beforeEach(() => {
    loggedIn = false
  })

  it.each(['/login', '/signup', '/forgot-password', '/reset-password', '/login/'])('allows %s signed out', (path) => {
    expect(guard({ path })).toBeUndefined()
  })

  it('redirects signed-out users away from app pages', () => {
    expect(guard({ path: '/' })).toBe('/login')
    expect(guard({ path: '/schedule' })).toBe('/login')
  })

  it('allows signed-in users', () => {
    loggedIn = true
    expect(guard({ path: '/' })).toBeUndefined()
  })
})
