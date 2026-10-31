import { createHash } from 'node:crypto'
import { createError, setResponseHeader, type H3Event } from 'h3'
import { RateLimitModel } from '../models/RateLimit'

export interface RateLimitRule {
  scope: string
  subject: string
  limit: number
  windowMs: number
}

const DUPLICATE_KEY = 11000

function isDuplicateKey(error: unknown): boolean {
  return (error as { code?: number } | null)?.code === DUPLICATE_KEY
}

async function increment(key: string, windowMs: number) {
  const now = new Date()
  const active = { $gt: ['$expiresAt', now] }
  return RateLimitModel.findOneAndUpdate(
    { key },
    [{
      $set: {
        count: { $cond: [active, { $add: ['$count', 1] }, 1] },
        expiresAt: { $cond: [active, '$expiresAt', new Date(now.getTime() + windowMs)] },
      },
    }],
    { upsert: true, returnDocument: 'after', updatePipeline: true },
  )
}

/**
 * Fixed-window counter stored in MongoDB, because serverless instances share no
 * memory. Limits: up to twice the limit can pass across a window boundary, and
 * each call costs one database round trip. The caller must have connected.
 */
export async function consumeRateLimit(rule: RateLimitRule): Promise<{ allowed: boolean, retryAfterSeconds: number }> {
  const key = createHash('sha256').update(`${rule.scope}:${rule.subject}`).digest('hex')
  // Two first requests can both try to insert; the loser retries as an update.
  const doc = await increment(key, rule.windowMs).catch((error: unknown) => {
    if (isDuplicateKey(error)) return increment(key, rule.windowMs)
    throw error
  })
  return {
    allowed: (doc?.count ?? 0) <= rule.limit,
    retryAfterSeconds: Math.max(1, Math.ceil(((doc?.expiresAt.getTime() ?? 0) - Date.now()) / 1000)),
  }
}

/** Applies rules in order and throws 429 on the first one exceeded. */
export async function enforceRateLimits(event: H3Event, rules: RateLimitRule[]): Promise<void> {
  for (const rule of rules) {
    const { allowed, retryAfterSeconds } = await consumeRateLimit(rule)
    if (!allowed) {
      setResponseHeader(event, 'Retry-After', retryAfterSeconds)
      throw createError({ statusCode: 429, statusMessage: 'Too many attempts, please try again later' })
    }
  }
}
