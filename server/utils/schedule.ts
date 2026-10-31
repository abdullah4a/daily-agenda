import { isValidTime } from './date'
import type { ScheduleBlock, ScheduleModel } from '../models/Schedule'

export const MAX_BLOCKS = 30
export const MAX_LABEL_LENGTH = 60
export const MAX_ID_LENGTH = 64

const MINUTES_PER_DAY = 24 * 60

/**
 * Benjamin Franklin's daily schedule, an optional template nothing applies by itself. The sleep block runs overnight (22:00 to 05:00);
 * the Schedule model stores start/end as plain strings, so it needs no special support.
 */
export function franklinDefaults(): ScheduleBlock[] {
  return [
    { id: 'rise-plan', label: 'Rise and plan', start: '05:00', end: '08:00', productive: false },
    { id: 'work-am', label: 'Work', start: '08:00', end: '12:00', productive: true },
    { id: 'read-eat', label: 'Read and eat', start: '12:00', end: '14:00', productive: false },
    { id: 'work-pm', label: 'Work', start: '14:00', end: '18:00', productive: true },
    { id: 'review', label: 'Review', start: '18:00', end: '22:00', productive: false },
    { id: 'sleep', label: 'Sleep', start: '22:00', end: '05:00', productive: false },
  ]
}

export function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h! * 60 + m!
}

/** A block whose end is before its start wraps past midnight. */
export function isOvernight(block: Pick<ScheduleBlock, 'start' | 'end'>): boolean {
  return toMinutes(block.end) < toMinutes(block.start)
}

function intervals(block: ScheduleBlock): Array<[number, number]> {
  const start = toMinutes(block.start)
  const end = toMinutes(block.end)
  return start < end ? [[start, end]] : [[start, MINUTES_PER_DAY], [0, end]]
}

export type ValidationResult
  = { ok: true, blocks: ScheduleBlock[] }
    | { ok: false, message: string }

const fail = (message: string): ValidationResult => ({ ok: false, message })

/** Validates an untrusted blocks payload and returns clean, trimmed blocks. */
export function validateBlocks(input: unknown): ValidationResult {
  if (!Array.isArray(input)) return fail('blocks must be an array')
  if (input.length > MAX_BLOCKS) return fail(`A schedule can have at most ${MAX_BLOCKS} blocks`)

  const blocks: ScheduleBlock[] = []
  const ids = new Set<string>()
  let overnight = 0

  for (const [i, raw] of input.entries()) {
    const where = `blocks[${i}]`
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail(`${where} must be an object`)
    const { id, label, start, end, productive } = raw as Record<string, unknown>

    if (typeof id !== 'string' || id.trim() === '' || id.length > MAX_ID_LENGTH) {
      return fail(`${where}.id must be a non-empty string of at most ${MAX_ID_LENGTH} characters`)
    }
    if (ids.has(id)) return fail(`${where}.id "${id}" is not unique`)
    ids.add(id)

    const cleanLabel = typeof label === 'string' ? label.trim() : ''
    if (cleanLabel === '' || cleanLabel.length > MAX_LABEL_LENGTH) {
      return fail(`${where}.label must be 1 to ${MAX_LABEL_LENGTH} characters`)
    }
    if (!isValidTime(start)) return fail(`${where}.start must be a valid HH:mm time`)
    if (!isValidTime(end)) return fail(`${where}.end must be a valid HH:mm time`)
    if (productive !== undefined && typeof productive !== 'boolean') return fail(`${where}.productive must be a boolean`)
    if (start === end) return fail(`${where} must start before it ends`)

    const block: ScheduleBlock = { id, label: cleanLabel, start, end, productive: productive ?? false }
    if (isOvernight(block)) {
      overnight++
      if (overnight > 1) return fail('Only one block can run past midnight')
    }
    blocks.push(block)
  }

  const spans = blocks.flatMap((block, index) => intervals(block).map(([s, e]) => ({ s, e, index })))
  spans.sort((a, b) => a.s - b.s)
  for (let i = 1; i < spans.length; i++) {
    if (spans[i]!.s < spans[i - 1]!.e) {
      const a = blocks[spans[i - 1]!.index]!
      const b = blocks[spans[i]!.index]!
      return fail(`"${b.label}" (${b.start}-${b.end}) clashes with "${a.label}" (${a.start}-${a.end})`)
    }
  }

  return { ok: true, blocks }
}

/** The user's stored blocks. New accounts have none: nothing is created until they save. */
export async function findScheduleBlocks(model: typeof ScheduleModel, userId: string): Promise<ScheduleBlock[]> {
  const schedule = await model.findOne({ user: userId }, { blocks: 1 }).lean()
  return schedule?.blocks ?? []
}
