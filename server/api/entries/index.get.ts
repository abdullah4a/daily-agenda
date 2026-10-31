import { defineEventHandler, getQuery } from 'h3'
import { EntryModel } from '../../models/Entry'
import { connectDb } from '../../utils/db'
import { badRequest, parseDateParam } from '../../utils/entries'
import { requireUser } from '../../utils/requireUser'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

function parseLimit(value: unknown): number {
  if (value === undefined || value === '') return DEFAULT_LIMIT
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : Number.NaN
  if (!Number.isInteger(n) || n < 1) throw badRequest('limit must be a positive integer')
  return Math.min(n, MAX_LIMIT)
}

/**
 * Past entries, newest first. `cursor` is the date of the last item already received;
 * the next page holds strictly older dates. Only entries with at least one non-blank
 * answer are returned. Scoped to the signed-in user and ordered by the (user, date) index.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireUser(event)
  const query = getQuery(event)
  const limit = parseLimit(query.limit)
  const cursor = query.cursor === undefined || query.cursor === '' ? null : parseDateParam(query.cursor)
  await connectDb()

  const rows = await EntryModel.find({
    user: userId,
    ...(cursor ? { date: { $lt: cursor } } : {}),
    $or: [{ morningAnswer: { $regex: /\S/ } }, { eveningAnswer: { $regex: /\S/ } }],
  })
    .sort({ date: -1 })
    .limit(limit + 1)
    .select('date morningAnswer eveningAnswer blockStatuses -_id')
    .lean()

  const page = rows.slice(0, limit)
  return {
    items: page.map(row => ({
      date: row.date,
      morningAnswer: row.morningAnswer ?? '',
      eveningAnswer: row.eveningAnswer ?? '',
      completedBlocks: (row.blockStatuses ?? [])
        .filter(b => b.status === 'done')
        .map(b => ({ blockId: b.blockId, label: b.label, start: b.start, end: b.end, productive: b.productive })),
    })),
    nextCursor: rows.length > limit ? page[page.length - 1]!.date : null,
  }
})
