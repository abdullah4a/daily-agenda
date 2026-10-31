/** Client-side schedule helpers. Mirrors the rules enforced by server/utils/schedule.ts. */
export interface ScheduleBlockData {
  id: string
  label: string
  start: string
  end: string
  productive: boolean
}

export const SCHEDULE_MAX_BLOCKS = 30
export const SCHEDULE_MAX_LABEL = 60
export const MINUTES_PER_DAY = 24 * 60

/** Benjamin Franklin's daily schedule (an optional template, same as the server's). */
export function franklinDefaultBlocks(): ScheduleBlockData[] {
  return [
    { id: 'rise-plan', label: 'Rise and plan', start: '05:00', end: '08:00', productive: false },
    { id: 'work-am', label: 'Work', start: '08:00', end: '12:00', productive: true },
    { id: 'read-eat', label: 'Read and eat', start: '12:00', end: '14:00', productive: false },
    { id: 'work-pm', label: 'Work', start: '14:00', end: '18:00', productive: true },
    { id: 'review', label: 'Review', start: '18:00', end: '22:00', productive: false },
    { id: 'sleep', label: 'Sleep', start: '22:00', end: '05:00', productive: false },
  ]
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h! * 60 + m!
}

export function isValidClock(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

export function minutesToTime(total: number): string {
  const t = ((Math.round(total) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

export function blockIsOvernight(b: Pick<ScheduleBlockData, 'start' | 'end'>): boolean {
  return timeToMinutes(b.end) < timeToMinutes(b.start)
}

export function blockDuration(b: Pick<ScheduleBlockData, 'start' | 'end'>): number {
  const s = timeToMinutes(b.start)
  const e = timeToMinutes(b.end)
  return e > s ? e - s : MINUTES_PER_DAY - s + e
}

export function scheduleDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return [h && `${h}h`, m && `${m}m`].filter(Boolean).join(' ') || '0m'
}

/** 12-hour display, e.g. 14:30 -> 2:30 PM. */
export function scheduleClock(time: string): string {
  const mins = timeToMinutes(time)
  const h = Math.floor(mins / 60)
  const m = mins % 60
  const suffix = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`
}

function spans(b: Pick<ScheduleBlockData, 'start' | 'end'>): Array<[number, number]> {
  const s = timeToMinutes(b.start)
  const e = timeToMinutes(b.end)
  return s < e ? [[s, e]] : [[s, MINUTES_PER_DAY], [0, e]]
}

/** Day segments for drawing; overnight blocks yield two. */
export function blockSegments(b: ScheduleBlockData) {
  return spans(b).map(([from, to]) => ({ from, to }))
}

export interface ScheduleIssues {
  /** Problems that apply to the whole schedule. */
  general: string[]
  /** Block ids involved in a problem, for highlighting. */
  blockIds: Set<string>
}

/** Cheap client-side check so most mistakes never need a round trip. */
export function checkSchedule(blocks: ScheduleBlockData[]): ScheduleIssues {
  const general: string[] = []
  const blockIds = new Set<string>()
  const valid = blocks.filter(b => isValidClock(b.start) && isValidClock(b.end) && b.start !== b.end)

  const overnight = valid.filter(blockIsOvernight)
  if (overnight.length > 1) {
    general.push('Only one overnight block is allowed.')
    overnight.forEach(b => blockIds.add(b.id))
  }

  const flat = valid.flatMap(b => spans(b).map(([s, e]) => ({ s, e, b })))
  flat.sort((a, b) => a.s - b.s)
  for (let i = 1; i < flat.length; i++) {
    const prev = flat[i - 1]!
    const cur = flat[i]!
    if (cur.s < prev.e && cur.b.id !== prev.b.id) {
      general.push(`"${prev.b.label}" (${prev.b.start}-${prev.b.end}) and "${cur.b.label}" (${cur.b.start}-${cur.b.end}) overlap.`)
      blockIds.add(prev.b.id)
      blockIds.add(cur.b.id)
    }
  }
  if (blocks.length > SCHEDULE_MAX_BLOCKS) general.push(`A schedule can have at most ${SCHEDULE_MAX_BLOCKS} blocks.`)
  return { general: [...new Set(general)], blockIds }
}

/** Why this block cannot sit beside the others, naming the block in the way. */
export function blockConflicts(block: ScheduleBlockData, others: ScheduleBlockData[]): string[] {
  const problems: string[] = []
  const mine = spans(block)
  for (const other of others) {
    if (!isValidClock(other.start) || !isValidClock(other.end) || other.start === other.end) continue
    if (mine.some(([s, e]) => spans(other).some(([os, oe]) => s < oe && os < e))) {
      problems.push(`This clashes with "${other.label}" (${scheduleClock(other.start)} to ${scheduleClock(other.end)}). Change the times, or edit that block first.`)
    }
  }
  const overnight = blockIsOvernight(block) ? others.find(blockIsOvernight) : undefined
  if (overnight) problems.push(`Only one block can run past midnight, and "${overnight.label}" already does.`)
  return problems
}

/** Per-field problems for a single block. */
export function checkBlockFields(b: Pick<ScheduleBlockData, 'label' | 'start' | 'end'>) {
  const errors = { label: '', start: '', end: '' }
  const label = b.label.trim()
  if (!label) errors.label = 'Give this block a name.'
  else if (label.length > SCHEDULE_MAX_LABEL) errors.label = `Keep it under ${SCHEDULE_MAX_LABEL} characters.`
  if (!isValidClock(b.start)) errors.start = 'Pick a start time.'
  if (!isValidClock(b.end)) errors.end = 'Pick an end time.'
  else if (!errors.start && b.start === b.end) errors.end = 'End must differ from start.'
  return errors
}

export function newBlockId(): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10)
  return `b-${rand}`
}

/** Suggests a start/end for a new block: the first free gap of at least an hour. */
export function suggestNewBlock(blocks: ScheduleBlockData[]): Pick<ScheduleBlockData, 'start' | 'end'> {
  const taken = blocks.filter(b => isValidClock(b.start) && isValidClock(b.end) && b.start !== b.end)
    .flatMap(spans).sort((a, b) => a[0] - b[0])
  let cursor = 0
  for (const [s, e] of taken) {
    if (s - cursor >= 60) return { start: minutesToTime(cursor), end: minutesToTime(cursor + 60) }
    cursor = Math.max(cursor, e)
  }
  if (MINUTES_PER_DAY - cursor >= 60) return { start: minutesToTime(cursor), end: minutesToTime(cursor + 60) }
  return { start: '09:00', end: '10:00' }
}
