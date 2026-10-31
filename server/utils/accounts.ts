import bcrypt from 'bcryptjs'
import { createError, getRequestIP, type H3Event } from 'h3'
import type { HydratedDocument } from 'mongoose'
import { UserModel, type UserDoc } from '../models/User'
import type { RateLimitRule } from './rateLimit'
import { canonicalTimezone } from './settings'

const BCRYPT_COST = 10
const MIN_PASSWORD_LENGTH = 8
/** bcrypt ignores everything past 72 bytes. */
const MAX_PASSWORD_BYTES = 72
const MAX_EMAIL_LENGTH = 254
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MINUTE = 60_000

/**
 * Hash of a discarded random value. Must keep BCRYPT_COST, or unknown emails
 * become distinguishable by timing. It is a constant so that the first login on
 * a cold instance does not take longer than the rest.
 */
export const DUMMY_PASSWORD_HASH = '$2b$10$X5ayYztxZbWnv0meSdYLJ.mnsg3KnBPzNe9RsaUlPfl3GaIiArWbW'

export const INVALID_CREDENTIALS = 'Invalid email or password'

export type UserDocument = HydratedDocument<UserDoc>

export interface PublicUser {
  id: string
  email: string
  timezone: string
  reminderTimes: { morning: string, evening: string }
}

export interface Credentials {
  email: string
  password: string
}

function badRequest(statusMessage: string) {
  return createError({ statusCode: 400, statusMessage })
}

export function normaliseEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return email.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(email) ? email : null
}

function passwordBytes(password: string): number {
  return Buffer.byteLength(password, 'utf8')
}

export function assertValidPassword(password: unknown): asserts password is string {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  }
  if (passwordBytes(password) > MAX_PASSWORD_BYTES) {
    throw badRequest(`Password must be at most ${MAX_PASSWORD_BYTES} bytes`)
  }
}

export interface SignupInput extends Credentials {
  timezone: string
}

/** A timezone the server cannot use must never block signup: it falls back to UTC. */
export function parseSignup(body: unknown): SignupInput {
  const { email: rawEmail, password, timezone } = (body ?? {}) as Record<string, unknown>
  const email = normaliseEmail(rawEmail)
  if (!email) throw badRequest('A valid email is required')
  assertValidPassword(password)
  return { email, password, timezone: canonicalTimezone(timezone) ?? 'UTC' }
}

export function parseLogin(body: unknown): Credentials {
  const { email: rawEmail, password } = (body ?? {}) as Record<string, unknown>
  const email = normaliseEmail(rawEmail)
  if (!email || typeof password !== 'string' || !password) {
    throw badRequest('Email and password are required')
  }
  return { email, password }
}

export function hashAccountPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST)
}

/** Always runs one bcrypt comparison, whether or not the account exists. */
export async function authenticate({ email, password }: Credentials): Promise<UserDocument | null> {
  const user = await UserModel.findOne({ email })
  const matches = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH)
  // An overlong password would otherwise match on its first 72 bytes alone.
  return user && matches && passwordBytes(password) <= MAX_PASSWORD_BYTES ? user : null
}

export function toSessionUser(user: UserDocument) {
  return { id: user.id, email: user.email, sessionVersion: user.sessionVersion ?? 0 }
}

/** Explicit allow-list: anything secret added to the model stays private by default. */
export function toPublicUser(user: UserDocument): PublicUser {
  return {
    id: user.id,
    email: user.email,
    timezone: user.timezone,
    reminderTimes: {
      morning: user.reminderTimes.morning,
      evening: user.reminderTimes.evening,
    },
  }
}

export interface UserSettings {
  timezone: string
  reminderTimes: { morning: string, evening: string }
  reminderEnabled: { morning: boolean, evening: boolean }
}

export function toSettings(user: UserDocument): UserSettings {
  return {
    timezone: user.timezone,
    reminderTimes: { morning: user.reminderTimes.morning, evening: user.reminderTimes.evening },
    reminderEnabled: {
      morning: user.reminderEnabled?.morning ?? true,
      evening: user.reminderEnabled?.evening ?? true,
    },
  }
}

function clientIp(event: H3Event): string {
  return getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
}

/**
 * The tight limit is per email and address, so a stranger on one address cannot lock someone out
 * of their own account. The higher email-only cap stops one account being attacked from many
 * addresses, and an attacker with enough addresses can still use it to block that account's logins
 * until the window ends.
 */
export function loginRateLimits(event: H3Event, email: string): RateLimitRule[] {
  const ip = clientIp(event)
  return [
    { scope: 'login:ip', subject: ip, limit: 30, windowMs: 15 * MINUTE },
    { scope: 'login:email-ip', subject: `${email}|${ip}`, limit: 10, windowMs: 15 * MINUTE },
    { scope: 'login:email', subject: email, limit: 50, windowMs: 15 * MINUTE },
  ]
}

export function forgotPasswordRateLimits(event: H3Event, email: string | null): RateLimitRule[] {
  const rules = [{ scope: 'forgot:ip', subject: clientIp(event), limit: 10, windowMs: 60 * MINUTE }]
  return email ? [...rules, { scope: 'forgot:email', subject: email, limit: 5, windowMs: 60 * MINUTE }] : rules
}

export function resetPasswordRateLimits(event: H3Event): RateLimitRule[] {
  return [{ scope: 'reset:ip', subject: clientIp(event), limit: 20, windowMs: 15 * MINUTE }]
}

export function signupRateLimits(event: H3Event): RateLimitRule[] {
  return [{ scope: 'signup:ip', subject: clientIp(event), limit: 10, windowMs: 60 * MINUTE }]
}
