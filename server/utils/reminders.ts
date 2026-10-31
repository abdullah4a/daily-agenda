import { createHash, timingSafeEqual } from 'node:crypto'
import { createError, getHeader, setResponseHeader, type H3Event } from 'h3'
import webpush from 'web-push'
import { EntryModel } from '../models/Entry'
import { PushSubscriptionModel, type PushSubscriptionDoc } from '../models/PushSubscription'
import { UserModel } from '../models/User'
import { connectDb } from './db'
import { isValidTimezone, localDateString, parseTime } from './date'
import { isAllowedPushEndpoint } from './settings'

export const REMINDER_TOLERANCE_MINUTES = 15
const MS_PER_MINUTE = 60_000
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE

const USER_BATCH_SIZE = 500
const SEND_CONCURRENCY = 10
/** No new sends start after this; with the send timeout, a run ends inside a 10s function limit. */
const RUN_BUDGET_MS = 6_000
const SEND_TIMEOUT_MS = 3_000
const PUSH_TTL_SECONDS = 60 * 60

export const REMINDER_SLOTS = ['morning', 'evening'] as const
export type ReminderSlot = (typeof REMINDER_SLOTS)[number]

const SLOT_CONFIG = {
  morning: { claimField: 'lastMorningReminderDate', answerField: 'morningAnswer', body: 'What good shall I do this day?' },
  evening: { claimField: 'lastEveningReminderDate', answerField: 'eveningAnswer', body: 'What good have I done today?' },
} as const

export function reminderPayload(slot: ReminderSlot) {
  return { title: 'Daily Agenda', body: SLOT_CONFIG[slot].body, url: '/', tag: `${slot}-reminder` }
}

// ---------- Due logic ----------

const formatters = new Map<string, Intl.DateTimeFormat>()

function zoneFormatter(timezone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timezone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
    formatters.set(timezone, formatter)
  }
  return formatter
}

/** Milliseconds the zone is ahead of UTC at an instant. */
function zoneOffset(timezone: string, instant: number): number {
  const parts: Record<string, number> = {}
  for (const { type, value } of zoneFormatter(timezone).formatToParts(instant)) parts[type] = Number(value)
  const wall = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!)
  return wall - Math.floor(instant / 1000) * 1000
}

/**
 * The instants at which a wall clock reads this date and time. A time repeated by
 * a DST fall-back gives two; one skipped by spring-forward gives the moment it
 * would have been on the old offset, so 02:30 fires at 03:30.
 */
export function localTimeInstants(date: string, hours: number, minutes: number, timezone: string): number[] {
  const wall = Date.parse(`${date}T00:00:00Z`) + (hours * 60 + minutes) * MS_PER_MINUTE
  const before = zoneOffset(timezone, wall - MS_PER_DAY)
  const after = zoneOffset(timezone, wall + MS_PER_DAY)
  const matches = [...new Set([before, after])]
    .map(offset => wall - offset)
    .filter(instant => instant + zoneOffset(timezone, instant) === wall)
    .sort((a, b) => a - b)
  return matches.length ? matches : [wall - before]
}

/**
 * The local date a reminder at `time` is due for, or null. Yesterday is checked
 * too: a 23:55 reminder picked up at 00:05 still belongs to the day before.
 */
export function dueReminderDate(time: string, timezone: string, now: Date): string | null {
  const parsed = parseTime(time)
  if (!parsed) return null
  const today = localDateString(timezone, now)
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - MS_PER_DAY).toISOString().slice(0, 10)
  const toleranceMs = REMINDER_TOLERANCE_MINUTES * MS_PER_MINUTE
  for (const date of [today, yesterday]) {
    const instants = localTimeInstants(date, parsed.hours, parsed.minutes, timezone)
    if (instants.some(at => now.getTime() >= at && now.getTime() < at + toleranceMs)) return date
  }
  return null
}

// ---------- Claim, send, release ----------

export interface ReminderSummary {
  usersChecked: number
  invalidUsers: number
  due: number
  skippedAnswered: number
  alreadySent: number
  sent: number
  removed: number
  failed: number
  deferred: number
}

export interface ReminderRunOptions {
  now?: Date
  budgetMs?: number
  concurrency?: number
  batchSize?: number
}

interface ReminderUser {
  _id: unknown
  timezone?: string
  reminderTimes?: { morning?: string, evening?: string }
  reminderEnabled?: { morning?: boolean, evening?: boolean }
}

interface DueReminder { userId: string, slot: ReminderSlot, date: string }

interface SendJob extends DueReminder {
  subscription: { _id: unknown, endpoint: string, keys: { p256dh: string, auth: string } }
}

const DEFAULT_TIMES = { morning: '08:00', evening: '20:00' }

function dueRemindersFor(user: ReminderUser, now: Date): DueReminder[] | null {
  const timezone = user.timezone ?? 'UTC'
  if (!isValidTimezone(timezone)) return null
  const due: DueReminder[] = []
  for (const slot of REMINDER_SLOTS) {
    if (user.reminderEnabled?.[slot] === false) continue
    const time = user.reminderTimes?.[slot] ?? DEFAULT_TIMES[slot]
    if (!parseTime(time)) return null
    const date = dueReminderDate(time, timezone, now)
    if (date) due.push({ userId: String(user._id), slot, date })
  }
  return due
}

/** Takes the device's slot for the day. Exactly one of any overlapping runs succeeds. */
async function claim(job: SendJob) {
  const field = SLOT_CONFIG[job.slot].claimField
  return PushSubscriptionModel.findOneAndUpdate(
    { _id: job.subscription._id, user: job.userId, [field]: { $ne: job.date } },
    { $set: { [field]: job.date } },
    { returnDocument: 'before', projection: { [field]: 1 } },
  ).lean()
}

async function release(job: SendJob, previous: string | undefined) {
  const field = SLOT_CONFIG[job.slot].claimField
  await PushSubscriptionModel.updateOne(
    { _id: job.subscription._id, user: job.userId, [field]: job.date },
    previous === undefined ? { $unset: { [field]: '' } } : { $set: { [field]: previous } },
  )
}

async function runJob(job: SendJob, summary: ReminderSummary) {
  let claimed = false
  let previous: string | undefined
  try {
    const before = await claim(job)
    if (!before) {
      summary.alreadySent++
      return
    }
    claimed = true
    previous = (before as Partial<PushSubscriptionDoc>)[SLOT_CONFIG[job.slot].claimField]

    await webpush.sendNotification(
      { endpoint: job.subscription.endpoint, keys: job.subscription.keys },
      JSON.stringify(reminderPayload(job.slot)),
      { TTL: PUSH_TTL_SECONDS, timeout: SEND_TIMEOUT_MS },
    )
    summary.sent++
  }
  catch (error) {
    const status = (error as { statusCode?: number }).statusCode
    try {
      if (claimed && (status === 404 || status === 410)) {
        await PushSubscriptionModel.deleteOne({ _id: job.subscription._id, user: job.userId })
        summary.removed++
        return
      }
      if (claimed) await release(job, previous)
    }
    catch {
      // The claim stays: this device misses the reminder rather than risking a second one.
    }
    summary.failed++
  }
}

async function processBatch(users: ReminderUser[], summary: ReminderSummary, now: Date, deadline: number, concurrency: number) {
  summary.usersChecked += users.length
  const due: DueReminder[] = []
  for (const user of users) {
    const reminders = dueRemindersFor(user, now)
    if (reminders) due.push(...reminders)
    else summary.invalidUsers++
  }
  summary.due += due.length
  if (due.length === 0) return

  const userIds = [...new Set(due.map(d => d.userId))]
  const [entries, stored] = await Promise.all([
    EntryModel.find({ user: { $in: userIds }, date: { $in: [...new Set(due.map(d => d.date))] } })
      .select('user date morningAnswer eveningAnswer').lean(),
    PushSubscriptionModel.find({ user: { $in: userIds } }).lean(),
  ])
  // Rows from before the allow-list, or from a host since dropped: the server must not call them.
  const subscriptions = stored.filter(s => isAllowedPushEndpoint(s.endpoint))
  const blocked = stored.filter(s => !isAllowedPushEndpoint(s.endpoint)).map(s => s._id)
  if (blocked.length) summary.removed += (await PushSubscriptionModel.deleteMany({ _id: { $in: blocked } })).deletedCount

  const entryByDay = new Map(entries.map(e => [`${String(e.user)}|${e.date}`, e]))

  const jobs: SendJob[] = []
  for (const reminder of due) {
    const config = SLOT_CONFIG[reminder.slot]
    const answer = entryByDay.get(`${reminder.userId}|${reminder.date}`)?.[config.answerField]
    if (answer?.trim()) {
      summary.skippedAnswered++
      continue
    }
    for (const subscription of subscriptions) {
      if (String(subscription.user) !== reminder.userId) continue
      if (subscription[config.claimField] === reminder.date) summary.alreadySent++
      else jobs.push({ ...reminder, subscription })
    }
  }

  let next = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    while (next < jobs.length && Date.now() < deadline) await runJob(jobs[next++]!, summary)
  }))
  summary.deferred += jobs.length - next
}

/**
 * Walks users in pages and sends what is due. Work cut off by the deadline is
 * left unclaimed, so a later run inside the tolerance window picks it up.
 */
export async function sendDueReminders(options: ReminderRunOptions = {}): Promise<ReminderSummary> {
  const { now = new Date(), budgetMs = RUN_BUDGET_MS, concurrency = SEND_CONCURRENCY, batchSize = USER_BATCH_SIZE } = options
  const deadline = Date.now() + budgetMs
  const summary: ReminderSummary = {
    usersChecked: 0, invalidUsers: 0, due: 0, skippedAnswered: 0, alreadySent: 0, sent: 0, removed: 0, failed: 0, deferred: 0,
  }

  const cursor = UserModel.find({})
    .select('timezone reminderTimes reminderEnabled').sort({ _id: 1 }).lean().cursor({ batchSize })
  let batch: ReminderUser[] = []
  for await (const user of cursor) {
    batch.push(user as unknown as ReminderUser)
    if (batch.length < batchSize) continue
    await processBatch(batch, summary, now, deadline, concurrency)
    batch = []
    if (Date.now() >= deadline) break
  }
  if (batch.length) await processBatch(batch, summary, now, deadline, concurrency)
  return summary
}

// ---------- Cron endpoint ----------

function digest(value: string) {
  return createHash('sha256').update(value).digest()
}

/** Constant-time check. An unset secret rejects every request. */
export function isAuthorizedCron(header: string | undefined, secret = process.env.CRON_SECRET): boolean {
  if (!secret || !header) return false
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`))
}

function configureVapid() {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey } = process.env
  try {
    if (!publicKey || !privateKey) throw new Error('missing')
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:noreply@example.com', publicKey, privateKey)
  }
  catch {
    throw createError({ statusCode: 503, statusMessage: 'Push notifications are not configured' })
  }
}

export async function handleReminderCron(event: H3Event) {
  if (!isAuthorizedCron(getHeader(event, 'authorization'))) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  setResponseHeader(event, 'cache-control', 'no-store')
  configureVapid()
  await connectDb()
  return sendDueReminders()
}
