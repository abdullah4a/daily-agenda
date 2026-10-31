import { createError } from 'h3'
import { isValidTime, isValidTimezone } from './date'

/** Region/City style IANA names ("Europe/London", "America/Argentina/Buenos_Aires", "UTC"). */
const IANA_SHAPE = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,2}$/
/** Fixed offsets such as "+05:00", "UTC+5" or "GMT-3" are not IANA zones and do not follow DST. */
const OFFSET_SHAPE = /^(?:(?:UTC|GMT)?\s*[+-]\d|[+-])/i

/** Returns the canonical IANA name, or null for offsets, junk and unknown zones. */
export function canonicalTimezone(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64) return null
  if (!IANA_SHAPE.test(value) || OFFSET_SHAPE.test(value) || !isValidTimezone(value)) return null
  return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone
}

export interface SettingsPatch {
  timezone?: string
  'reminderTimes.morning'?: string
  'reminderTimes.evening'?: string
  'reminderEnabled.morning'?: boolean
  'reminderEnabled.evening'?: boolean
}

function bad(message: string) {
  return createError({ statusCode: 400, statusMessage: message })
}

/** Validates a partial settings update and returns a flat $set patch. Unknown keys are rejected. */
export function parseSettingsPatch(body: unknown): SettingsPatch {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw bad('Invalid settings')
  const input = body as Record<string, unknown>
  const patch: SettingsPatch = {}

  for (const key of Object.keys(input)) {
    if (!['timezone', 'reminderTimes', 'reminderEnabled'].includes(key)) throw bad(`Unknown setting "${key}"`)
  }

  if (input.timezone !== undefined) {
    const tz = canonicalTimezone(input.timezone)
    if (!tz) throw bad('Timezone must be an IANA name such as Europe/London, not a UTC offset')
    patch.timezone = tz
  }

  for (const [field, label] of [['reminderTimes', 'time'], ['reminderEnabled', 'flag']] as const) {
    const group = input[field]
    if (group === undefined) continue
    if (typeof group !== 'object' || group === null || Array.isArray(group)) throw bad(`Invalid ${field}`)
    for (const [slot, value] of Object.entries(group)) {
      if (slot !== 'morning' && slot !== 'evening') throw bad(`Unknown ${field} entry "${slot}"`)
      if (label === 'time') {
        if (!isValidTime(value)) throw bad(`${slot} reminder time must be HH:mm`)
        patch[`reminderTimes.${slot}`] = value
      }
      else {
        if (typeof value !== 'boolean') throw bad(`${slot} reminder flag must be true or false`)
        patch[`reminderEnabled.${slot}`] = value
      }
    }
  }

  if (Object.keys(patch).length === 0) throw bad('Nothing to update')
  return patch
}

export const PUSH_LIMITS = { endpoint: 2048, p256dh: 256, auth: 64, perUser: 10 } as const
const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/

export interface PushSubscriptionInput {
  endpoint: string
  keys: { p256dh: string, auth: string }
}

export function parseEndpoint(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > PUSH_LIMITS.endpoint) throw bad('A valid endpoint is required')
  let url: URL
  try { url = new URL(value) }
  catch { throw bad('A valid endpoint is required') }
  if (url.protocol !== 'https:' || url.username || url.password) throw bad('Endpoint must be an https URL')
  return value
}

/** Web push services of the browsers we support. Anything else would make the server call arbitrary hosts. */
const PUSH_HOSTS = new Set(['fcm.googleapis.com', 'android.googleapis.com', 'updates.push.services.mozilla.com'])
const PUSH_HOST_SUFFIXES = ['.push.apple.com', '.notify.windows.com']

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL
  try { url = new URL(endpoint) }
  catch { return false }
  if (url.protocol !== 'https:' || url.port) return false
  return PUSH_HOSTS.has(url.hostname) || PUSH_HOST_SUFFIXES.some(suffix => url.hostname.endsWith(suffix))
}

export function parsePushSubscription(body: unknown): PushSubscriptionInput {
  const input = (typeof body === 'object' && body !== null ? body : {}) as { endpoint?: unknown, keys?: { p256dh?: unknown, auth?: unknown } }
  const endpoint = parseEndpoint(input.endpoint)
  if (!isAllowedPushEndpoint(endpoint)) throw bad('Unsupported push service')
  const { p256dh, auth } = input.keys ?? {}
  if (typeof p256dh !== 'string' || !p256dh || p256dh.length > PUSH_LIMITS.p256dh || !BASE64URL.test(p256dh)) throw bad('Invalid p256dh key')
  if (typeof auth !== 'string' || !auth || auth.length > PUSH_LIMITS.auth || !BASE64URL.test(auth)) throw bad('Invalid auth key')
  return { endpoint, keys: { p256dh, auth } }
}
