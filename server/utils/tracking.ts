import { EntryModel, BLOCK_STATUSES, type BlockStatus, type BlockStatusValue } from '../models/Entry'
import type { ScheduleBlock } from '../models/Schedule'
import { isValidDateString, isValidTime, minutesBetween } from './date'
import { badRequest, ensureEntry } from './entries'
import { MAX_BLOCKS, MAX_ID_LENGTH, MAX_LABEL_LENGTH } from './schedule'

export const MAX_INSIGHT_DAYS = 92
/** Past the schedule's limit, as one day can hold blocks removed from the schedule that day. */
export const MAX_BLOCK_STATUSES = MAX_BLOCKS + 10
const DAY_MS = 24 * 60 * 60 * 1000

/** Accepts a status, or null / "cleared" to remove it (returns null). */
export function parseStatusBody(body: unknown): BlockStatusValue | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw badRequest('Body must be an object')
  const status = (body as Record<string, unknown>).status
  if (status === null || status === 'cleared') return null
  if (typeof status === 'string' && (BLOCK_STATUSES as readonly string[]).includes(status)) return status as BlockStatusValue
  throw badRequest('status must be "done", "skipped" or null')
}

const SNAPSHOT_KEYS = ['end', 'label', 'productive', 'start']
export type BlockSnapshot = Pick<BlockStatus, 'label' | 'start' | 'end' | 'productive'>

/**
 * The block as the client saw it when the check-off was made, or null if none was sent.
 * Rejected as a whole unless exactly right, because this text goes straight into history.
 */
export function parseBlockSnapshot(body: unknown): BlockSnapshot | null {
  const block = (body as Record<string, unknown>).block
  if (block === undefined) return null
  if (typeof block !== 'object' || block === null || Array.isArray(block)) throw badRequest('block must be an object')
  if (Object.keys(block).sort().join() !== SNAPSHOT_KEYS.join()) throw badRequest('block must have label, start, end and productive')
  const { label, start, end, productive } = block as Record<string, unknown>
  const cleanLabel = typeof label === 'string' ? label.trim() : ''
  if (cleanLabel === '' || cleanLabel.length > MAX_LABEL_LENGTH) throw badRequest(`block.label must be 1 to ${MAX_LABEL_LENGTH} characters`)
  if (!isValidTime(start) || !isValidTime(end) || start === end) throw badRequest('block.start and block.end must be different HH:mm times')
  if (typeof productive !== 'boolean') throw badRequest('block.productive must be a boolean')
  return { label: cleanLabel, start, end, productive }
}

export function parseBlockId(value: unknown): string {
  if (typeof value !== 'string' || value === '' || value.length > MAX_ID_LENGTH) throw badRequest('Invalid block id')
  return value
}

export function snapshotBlock(block: ScheduleBlock, status: BlockStatusValue): BlockStatus {
  return { blockId: block.id, label: block.label, start: block.start, end: block.end, status, productive: block.productive }
}

/**
 * Sets or clears one block's status with single-document atomic updates, so concurrent
 * check-offs on different blocks never overwrite each other. Replace-in-place is tried first,
 * then a guarded push; if a racing request pushed the same block in between, the loop retries.
 * The size limit is part of the push's filter, so concurrent check-offs cannot pass it either.
 */
export async function setBlockStatus(userId: string, date: string, blockId: string, snapshot: BlockStatus | null) {
  if (!snapshot) {
    await EntryModel.updateOne({ user: userId, date }, { $pull: { blockStatuses: { blockId } } })
    return
  }
  await ensureEntry(userId, date)
  const lastSlot = `blockStatuses.${MAX_BLOCK_STATUSES - 1}`
  for (let attempt = 0; attempt < 5; attempt++) {
    const replaced = await EntryModel.updateOne(
      { user: userId, date, 'blockStatuses.blockId': blockId },
      { $set: { 'blockStatuses.$': snapshot } },
      { runValidators: true },
    )
    if (replaced.matchedCount > 0) return
    const pushed = await EntryModel.updateOne(
      { user: userId, date, 'blockStatuses.blockId': { $ne: blockId }, [lastSlot]: { $exists: false } },
      { $push: { blockStatuses: snapshot } },
      { runValidators: true },
    )
    if (pushed.matchedCount > 0) return
    const full = await EntryModel.exists({ user: userId, date, 'blockStatuses.blockId': { $ne: blockId }, [lastSlot]: { $exists: true } })
    if (full) throw badRequest(`A day can have at most ${MAX_BLOCK_STATUSES} tracked blocks`)
  }
  throw new Error('Could not update block status')
}

export async function getBlockStatuses(userId: string, date: string): Promise<BlockStatus[]> {
  const entry = await EntryModel.findOne({ user: userId, date }, { blockStatuses: 1 }).lean()
  return (entry?.blockStatuses ?? []).map(({ blockId, label, start, end, status, productive }) => ({
    blockId, label, start, end, status, productive,
  }))
}

const toUtc = (date: string) => Date.parse(`${date}T00:00:00Z`)

export function parseRange(query: Record<string, unknown>): { from: string, to: string } {
  const { from, to } = query
  if (!isValidDateString(from) || !isValidDateString(to)) throw badRequest('from and to are required as YYYY-MM-DD')
  const span = (toUtc(to) - toUtc(from)) / DAY_MS
  if (span < 0) throw badRequest('from must not be after to')
  if (span + 1 > MAX_INSIGHT_DAYS) throw badRequest(`Range must be at most ${MAX_INSIGHT_DAYS} days`)
  return { from, to }
}

export interface DayInsight {
  date: string
  productiveMinutes: number
  done: number
  skipped: number
}

export async function computeInsights(userId: string, from: string, to: string) {
  const entries = await EntryModel.find(
    { user: userId, date: { $gte: from, $lte: to } },
    { date: 1, blockStatuses: 1 },
  ).lean()
  const byDate = new Map(entries.map(e => [e.date, e.blockStatuses ?? []]))

  const days: DayInsight[] = []
  const total = { productiveMinutes: 0, done: 0, skipped: 0 }
  for (let t = toUtc(from); t <= toUtc(to); t += DAY_MS) {
    const date = new Date(t).toISOString().slice(0, 10)
    const day: DayInsight = { date, productiveMinutes: 0, done: 0, skipped: 0 }
    for (const b of byDate.get(date) ?? []) {
      if (b.status === 'done') {
        day.done++
        if (b.productive) day.productiveMinutes += minutesBetween(b.start, b.end)
      }
      else if (b.status === 'skipped') day.skipped++
    }
    total.productiveMinutes += day.productiveMinutes
    total.done += day.done
    total.skipped += day.skipped
    days.push(day)
  }
  return { from, to, days, total }
}
