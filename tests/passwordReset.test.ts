import { existsSync } from 'node:fs'
import bcrypt from 'bcryptjs'
import { createApp, createError, createRouter, toWebHandler, type H3Event } from 'h3'
import mongoose from 'mongoose'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { RateLimitModel } from '../server/models/RateLimit'
import { UserModel } from '../server/models/User'
import { hashAccountPassword } from '../server/utils/accounts'
import { connectDb, disconnectDb } from '../server/utils/db'
import { escapeHtml } from '../server/utils/mail'
import { FORGOT_PASSWORD_RESPONSE, hashResetToken } from '../server/utils/passwordReset'
import { requireUser } from '../server/utils/requireUser'
import forgot from '../server/api/auth/forgot-password.post'
import login from '../server/api/auth/login.post'
import reset from '../server/api/auth/reset-password.post'

const { sendMail, createTransport } = vi.hoisted(() => {
  const sendMail = vi.fn(async (_message: { text: string, html: string }) => ({}))
  return { sendMail, createTransport: vi.fn(() => ({ sendMail, close: vi.fn() })) }
})
vi.mock('nodemailer', () => ({ default: { createTransport } }))

// A database of its own: this file wipes it while other workers may be testing.
const TEST_DB = 'daily-agenda-test-password-reset'
const EMAIL = 'ann@example.com'
const OLD_PASSWORD = 'old password'
const NEW_PASSWORD = 'new password'

type Session = { user?: { id: string, email: string, sessionVersion?: number } }
let session: Session = {}
vi.stubGlobal('replaceUserSession', async (_event: H3Event, data: Session) => {
  session = data
})
vi.stubGlobal('clearUserSession', async () => {
  session = {}
})
vi.stubGlobal('requireUserSession', async () => {
  if (!session.user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  return session
})

const handle = toWebHandler(createApp().use(createRouter()
  .post('/forgot', forgot)
  .post('/reset', reset)
  .post('/login', login)))

let ipCounter = 0
let clientIp = ''

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return handle(new Request(`http://app.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': clientIp, ...headers },
    body: JSON.stringify(body),
  }))
}

function configureSmtp() {
  vi.stubEnv('SMTP_HOST', 'smtp.invalid')
  vi.stubEnv('SMTP_PORT', '587')
  vi.stubEnv('SMTP_FROM', 'Agenda <no-reply@example.invalid>')
}

/** Requests a reset and returns the token from the mailed link. */
async function requestToken(): Promise<string> {
  configureSmtp()
  sendMail.mockClear()
  expect((await post('/forgot', { email: EMAIL })).status).toBe(200)
  const token = /token=([\w-]+)/.exec(sendMail.mock.calls[0]?.[0].text ?? '')?.[1]
  expect(token).toBeTruthy()
  return token as string
}

beforeAll(async () => {
  if (!process.env.MONGODB_URI && existsSync('.env')) process.loadEnvFile('.env')
  await connectDb({ dbName: TEST_DB })
  expect(mongoose.connection.name).toBe(TEST_DB)
  await Promise.all([UserModel.init(), RateLimitModel.init()])
})

beforeEach(async () => {
  session = {}
  clientIp = `10.9.0.${++ipCounter}`
  sendMail.mockReset()
  sendMail.mockResolvedValue({})
  createTransport.mockClear()
  await Promise.all([UserModel.deleteMany(), RateLimitModel.deleteMany()])
  await UserModel.create({ email: EMAIL, passwordHash: await hashAccountPassword(OLD_PASSWORD) })
  for (const name of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_FROM', 'APP_BASE_URL']) vi.stubEnv(name, '')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

afterAll(async () => {
  if (mongoose.connection.name === TEST_DB) await mongoose.connection.dropDatabase()
  await disconnectDb()
})

describe('POST forgot-password', () => {
  it('stores only a hash, expiring in about an hour', async () => {
    const token = await requestToken()
    const stored = await UserModel.findOne({ email: EMAIL })
    expect(stored?.passwordReset?.tokenHash).toBe(hashResetToken(token))
    expect(JSON.stringify(stored?.toObject())).not.toContain(token)
    const remaining = (stored?.passwordReset?.expiresAt?.getTime() ?? 0) - Date.now()
    expect(remaining).toBeGreaterThan(59 * 60_000)
    expect(remaining).toBeLessThanOrEqual(60 * 60_000)
  })

  it('answers identically for known, unknown and invalid emails', async () => {
    configureSmtp()
    const bodies = [{ email: EMAIL }, { email: 'nobody@example.com' }, { email: 'bad' }, { email: { $gt: '' } }, {}]
    for (const body of bodies) {
      const response = await post('/forgot', body)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual(FORGOT_PASSWORD_RESPONSE)
    }
    expect(sendMail).toHaveBeenCalledTimes(1)
  })

  it('succeeds, warns and sends nothing without SMTP, and hides the link outside development', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    expect((await post('/forgot', { email: EMAIL })).status).toBe(200)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('SMTP is not configured'))
    expect(createTransport).not.toHaveBeenCalled()
    expect(info).not.toHaveBeenCalled()
  })

  it('logs the link in development when SMTP is missing', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    await post('/forgot', { email: EMAIL })
    expect(info).toHaveBeenCalledWith(expect.stringMatching(/https?:\/\/\S+\/reset-password\?token=[\w-]{43}$/))
  })

  it('keeps the generic response when sending fails', async () => {
    configureSmtp()
    sendMail.mockRejectedValue(new Error('refused'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await post('/forgot', { email: EMAIL })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(FORGOT_PASSWORD_RESPONSE)
    expect(error).toHaveBeenCalled()
  })

  it('ignores a forged host in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('APP_BASE_URL', 'https://agenda.example.com/ignored')
    configureSmtp()
    await post('/forgot', { email: EMAIL }, { 'host': 'evil.example', 'x-forwarded-host': 'evil.example' })
    const message = sendMail.mock.calls[0]?.[0]
    expect(message?.text).toContain('https://agenda.example.com/reset-password?token=')
    expect(`${message?.text}${message?.html}`).not.toContain('evil.example')
  })

  it('sends nothing in production without a base URL', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    configureSmtp()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await post('/forgot', { email: EMAIL })
    expect(await response.json()).toEqual(FORGOT_PASSWORD_RESPONSE)
    expect(sendMail).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(expect.stringContaining('APP_BASE_URL'))
  })

  it('limits requests per email and per address, for unknown emails too', async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      clientIp = `10.8.${attempt}.1`
      await post('/forgot', { email: 'nobody@example.com' })
    }
    clientIp = '10.8.9.1'
    expect((await post('/forgot', { email: 'nobody@example.com' })).status).toBe(429)

    clientIp = '10.8.10.1'
    for (let attempt = 0; attempt < 10; attempt++) await post('/forgot', { email: `u${attempt}@example.com` })
    expect((await post('/forgot', { email: 'bad' })).status).toBe(429)
  }, 120_000)
})

describe('POST reset-password', () => {
  it('changes the password, once only', async () => {
    const token = await requestToken()
    expect((await post('/reset', { token, password: NEW_PASSWORD })).status).toBe(200)
    const stored = await UserModel.findOne({ email: EMAIL })
    expect(await bcrypt.compare(NEW_PASSWORD, stored?.passwordHash ?? '')).toBe(true)
    expect(stored?.passwordReset?.tokenHash).toBeUndefined()
    expect((await post('/reset', { token, password: 'another password' })).status).toBe(400)
  })

  it('lets only one of two concurrent uses win', async () => {
    const token = await requestToken()
    const responses = await Promise.all([
      post('/reset', { token, password: NEW_PASSWORD }),
      post('/reset', { token, password: 'another password' }),
    ])
    expect(responses.map(response => response.status).sort()).toEqual([200, 400])
    expect((await UserModel.findOne({ email: EMAIL }))?.sessionVersion).toBe(1)
  })

  it('rejects an expired token', async () => {
    const token = await requestToken()
    await UserModel.updateOne({ email: EMAIL }, { 'passwordReset.expiresAt': new Date(Date.now() - 1000) })
    expect((await post('/reset', { token, password: NEW_PASSWORD })).status).toBe(400)
    const stored = await UserModel.findOne({ email: EMAIL })
    expect(await bcrypt.compare(OLD_PASSWORD, stored?.passwordHash ?? '')).toBe(true)
  })

  it('invalidates an earlier link when a new one is requested', async () => {
    const first = await requestToken()
    await requestToken()
    expect((await post('/reset', { token: first, password: NEW_PASSWORD })).status).toBe(400)
  })

  it.each([
    [{ token: { $ne: '' }, password: NEW_PASSWORD }],
    [{ token: 'short', password: NEW_PASSWORD }],
    [{ password: NEW_PASSWORD }],
  ])('rejects malformed token %j', async (body) => {
    expect((await post('/reset', body)).status).toBe(400)
  })

  it('applies the signup password rules and keeps the token usable', async () => {
    const token = await requestToken()
    expect((await post('/reset', { token, password: 'short' })).status).toBe(400)
    expect((await post('/reset', { token, password: 'x'.repeat(73) })).status).toBe(400)
    expect((await post('/reset', { token, password: NEW_PASSWORD })).status).toBe(200)
  })

  it('limits attempts per address', async () => {
    const token = 'a'.repeat(43)
    for (let attempt = 0; attempt < 20; attempt++) await post('/reset', { token, password: NEW_PASSWORD })
    expect((await post('/reset', { token, password: NEW_PASSWORD })).status).toBe(429)
  }, 120_000)
})

describe('session revocation', () => {
  it('rejects a session from before the reset and accepts a new login', async () => {
    await post('/login', { email: EMAIL, password: OLD_PASSWORD })
    expect(session.user?.sessionVersion).toBe(0)
    await expect(requireUser({} as H3Event)).resolves.toBe(session.user?.id)

    const token = await requestToken()
    await post('/reset', { token, password: NEW_PASSWORD })

    await expect(requireUser({} as H3Event)).rejects.toMatchObject({ statusCode: 401 })
    expect(session.user).toBeUndefined()

    expect((await post('/login', { email: EMAIL, password: OLD_PASSWORD })).status).toBe(401)
    expect((await post('/login', { email: EMAIL, password: NEW_PASSWORD })).status).toBe(200)
    expect(session.user?.sessionVersion).toBe(1)
    await expect(requireUser({} as H3Event)).resolves.toBe(session.user?.id)
  })

  it('accepts a legacy session on a legacy account', async () => {
    const user = await UserModel.findOne({ email: EMAIL })
    await UserModel.collection.updateOne({ email: EMAIL }, { $unset: { sessionVersion: '' } })
    session = { user: { id: String(user?.id), email: EMAIL } }
    await expect(requireUser({} as H3Event)).resolves.toBe(user?.id)
  })
})

describe('escapeHtml', () => {
  it('neutralises markup', () => {
    expect(escapeHtml('"><script>&\'')).toBe('&quot;&gt;&lt;script&gt;&amp;&#39;')
  })
})
