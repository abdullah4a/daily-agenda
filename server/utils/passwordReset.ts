import { createHash, randomBytes } from 'node:crypto'
import { createError, getRequestURL, type H3Event } from 'h3'
import { assertValidPassword } from './accounts'
import { escapeHtml, sendMail } from './mail'

export const RESET_TOKEN_TTL_MS = 60 * 60_000
export const FORGOT_PASSWORD_RESPONSE = { message: 'If that email has an account, a reset link is on its way.' }
export const INVALID_RESET_TOKEN = 'This reset link is invalid or has expired'

/** 32 random bytes in base64url. */
const TOKEN_PATTERN = /^[\w-]{43}$/

export function createResetToken(): string {
  return randomBytes(32).toString('base64url')
}

/** A fast hash is enough: the token is 256 random bits, so it cannot be guessed offline. */
export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function parseResetPassword(body: unknown): { token: string, password: string } {
  const { token, password } = (body ?? {}) as Record<string, unknown>
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) {
    throw createError({ statusCode: 400, statusMessage: INVALID_RESET_TOKEN })
  }
  assertValidPassword(password)
  return { token, password }
}

/**
 * APP_BASE_URL wins. Production never falls back to the request, whose Host header
 * the sender controls: a forged host would mail victims a link to the attacker's site.
 * Returns null when no trustworthy origin exists.
 */
export function resetBaseUrl(event: H3Event): string | null {
  const configured = process.env.APP_BASE_URL
  if (configured) {
    try {
      const { origin, protocol } = new URL(configured)
      return protocol === 'https:' || protocol === 'http:' ? origin : null
    }
    catch {
      return null
    }
  }
  return process.env.NODE_ENV === 'production' ? null : getRequestURL(event).origin
}

export function resetLink(baseUrl: string, token: string): string {
  return `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`
}

/** Failures are logged here: the caller has already committed to its generic response. */
export async function sendResetEmail(to: string, link: string): Promise<void> {
  const minutes = RESET_TOKEN_TTL_MS / 60_000
  try {
    const sent = await sendMail({
      to,
      subject: 'Reset your Daily Agenda password',
      text: `Reset your password with this link, which expires in ${minutes} minutes:\n\n${link}\n\nIf you did not ask for this, ignore this email.`,
      html: `<p>Reset your password with the link below. It expires in ${minutes} minutes.</p>
<p><a href="${escapeHtml(link)}">Reset password</a></p>
<p>If you did not ask for this, ignore this email.</p>`,
    })
    if (!sent && process.env.NODE_ENV === 'development') {
      console.info(`[password-reset] Development reset link: ${link}`)
    }
  }
  catch (error) {
    console.error('[password-reset] Sending the reset email failed:', (error as Error).message)
  }
}

type WaitUntil = (promise: Promise<unknown>) => void

function platformWaitUntil(event: H3Event): WaitUntil | undefined {
  if (event.context.waitUntil) return event.context.waitUntil
  // Nitro's Vercel Node entry does not pass waitUntil on; this is where the platform exposes it.
  const key = Symbol.for('@vercel/request-context')
  const store = (globalThis as unknown as Record<symbol, { get?: () => { waitUntil?: WaitUntil } } | undefined>)[key]
  return store?.get?.()?.waitUntil
}

/**
 * Keeps slow work out of the response time, so that a real account cannot be told
 * from an unknown one by timing. Where the platform cannot keep the function alive,
 * delivery wins and the task is awaited.
 */
export async function runAfterResponse(event: H3Event, task: () => Promise<void>): Promise<void> {
  const waitUntil = platformWaitUntil(event)
  if (waitUntil) waitUntil(task())
  else await task()
}
