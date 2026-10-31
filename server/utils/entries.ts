import { createError } from 'h3'
import { EntryModel } from '../models/Entry'
import { isValidDateString } from './date'

export const MAX_ANSWER_LENGTH = 5000
export const ANSWER_FIELDS = ['morningAnswer', 'eveningAnswer'] as const
export type AnswerField = (typeof ANSWER_FIELDS)[number]

const DUPLICATE_KEY = 11000

export function badRequest(message: string) {
  return createError({ statusCode: 400, statusMessage: message })
}

export function parseDateParam(value: unknown): string {
  if (!isValidDateString(value)) throw badRequest('Invalid date, expected YYYY-MM-DD')
  return value
}

function parseTimestamp(value: unknown, label: string): Date {
  const date = typeof value === 'string' || typeof value === 'number' ? new Date(value) : new Date(Number.NaN)
  if (Number.isNaN(date.getTime())) throw badRequest(`Invalid ${label}`)
  return date
}

export interface EntryPatch {
  /** Only the answers the client sent, each with the time that write is stamped with. */
  fields: Partial<Record<AnswerField, { value: string, at: Date }>>
}

/**
 * Validates a PUT body. clientUpdatedAt may be one ISO string/epoch for the whole
 * entry or an object keyed by field. Times are clamped to `now` so a client with
 * a fast clock cannot make its write unbeatable.
 */
export function parseEntryPatch(body: unknown, now: Date = new Date()): EntryPatch {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw badRequest('Body must be an object')
  const input = body as Record<string, unknown>
  const clientAt = input.clientUpdatedAt
  const perField = typeof clientAt === 'object' && clientAt !== null && !Array.isArray(clientAt)
    ? clientAt as Record<string, unknown>
    : null
  const entryAt = clientAt !== undefined && clientAt !== null && !perField
    ? parseTimestamp(clientAt, 'clientUpdatedAt')
    : null

  const fields: EntryPatch['fields'] = {}
  for (const field of ANSWER_FIELDS) {
    const value = input[field]
    if (value === undefined) continue
    if (typeof value !== 'string') throw badRequest(`${field} must be a string`)
    if (value.length > MAX_ANSWER_LENGTH) throw badRequest(`${field} must be at most ${MAX_ANSWER_LENGTH} characters`)
    const raw = perField ? perField[field] : undefined
    const at = raw !== undefined && raw !== null ? parseTimestamp(raw, `clientUpdatedAt.${field}`) : entryAt ?? now
    fields[field] = { value, at: at > now ? now : at }
  }
  if (Object.keys(fields).length === 0) throw badRequest('Provide morningAnswer or eveningAnswer')
  return { fields }
}

interface EntryLike {
  date: string
  morningAnswer: string
  eveningAnswer: string
  morningAnswerAt?: Date | null
  eveningAnswerAt?: Date | null
  updatedAt?: Date | null
}

export function toPublicEntry(date: string, entry: EntryLike | null) {
  return {
    date,
    morningAnswer: entry?.morningAnswer ?? '',
    eveningAnswer: entry?.eveningAnswer ?? '',
    morningAnswerAt: entry?.morningAnswerAt?.toISOString() ?? null,
    eveningAnswerAt: entry?.eveningAnswerAt?.toISOString() ?? null,
    updatedAt: entry?.updatedAt?.toISOString() ?? null,
  }
}

export async function findEntry(userId: string, date: string) {
  return toPublicEntry(date, await EntryModel.findOne({ user: userId, date }).lean())
}

/** Creates the row if missing; two concurrent first writes race on the unique index, and the loser just proceeds. */
export async function ensureEntry(userId: string, date: string) {
  const attempt = () => EntryModel.updateOne(
    { user: userId, date },
    { $setOnInsert: { user: userId, date } },
    { upsert: true, runValidators: true },
  )
  try {
    await attempt()
  }
  catch (error) {
    if ((error as { code?: number }).code !== DUPLICATE_KEY) throw error
    await attempt()
  }
}

/** Last-write-wins per field: a write older than the stored timestamp is ignored. */
export async function saveEntry(userId: string, date: string, patch: EntryPatch) {
  await ensureEntry(userId, date)
  for (const field of ANSWER_FIELDS) {
    const change = patch.fields[field]
    if (!change) continue
    const stamp = `${field}At`
    await EntryModel.updateOne(
      { user: userId, date, $or: [{ [stamp]: null }, { [stamp]: { $lte: change.at } }] },
      { $set: { [field]: change.value, [stamp]: change.at } },
      { runValidators: true },
    )
  }
  return findEntry(userId, date)
}
