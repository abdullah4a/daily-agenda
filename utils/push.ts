export type PushSupport = 'supported' | 'unsupported' | 'ios-install'

export function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

/** iOS only exposes web push to home-screen installed apps. */
export function pushSupport(): PushSupport {
  if (!import.meta.client) return 'unsupported'
  if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) return 'supported'
  return isIos() && !isStandalone() ? 'ios-install' : 'unsupported'
}

export type PushFailure = 'no-service-worker' | 'public-key-missing' | 'push-service-unavailable' | 'server-rejected' | 'permission-timeout'

const MESSAGES: Record<PushFailure, string> = {
  'no-service-worker': 'The app\'s background service worker is not running, so reminders cannot start. Reload the page and try again. Private windows and strict privacy settings can block it.',
  'public-key-missing': 'Reminders are not set up on the server yet: its push key is missing or invalid. This needs fixing by whoever runs this app.',
  'push-service-unavailable': 'This browser could not reach its push service. Check your connection, VPN or firewall and try again. In Brave, turn on "Use Google services for push messaging" in Settings, Privacy. If it still fails, this browser has no push access: use Chrome, Edge, Firefox or Safari.',
  'server-rejected': 'The server did not accept this device, so reminders are still off. Please try again.',
  'permission-timeout': 'The notification permission prompt was not answered. Try again and choose Allow.',
}

export class PushSetupError extends Error {
  constructor(readonly failure: PushFailure, detail?: string) {
    super(detail ? `${MESSAGES[failure]} (${detail})` : MESSAGES[failure])
    this.name = 'PushSetupError'
  }
}

export const PUSH_TIMEOUTS = { permission: 60_000, register: 5_000, worker: 20_000, api: 10_000, subscribe: 15_000 }

/** Rejects with `failure` if the step has not settled in time. The step itself cannot be cancelled. */
function step<T>(work: Promise<T>, ms: number, failure: PushFailure): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PushSetupError(failure)), ms)
  })
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padded = value + '='.repeat((4 - (value.length % 4)) % 4)
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** A VAPID public key is an uncompressed P-256 point: 65 bytes starting with 0x04. */
function decodePublicKey(value: unknown): Uint8Array<ArrayBuffer> {
  try {
    const key = urlBase64ToUint8Array(String(value).trim())
    if (key.length === 65 && key[0] === 4) return key
  }
  catch { /* reported below */ }
  throw new PushSetupError('public-key-missing')
}

const statusOf = (error: unknown) => (error as { statusCode?: number } | null)?.statusCode
const detailOf = (error: unknown) => (statusOf(error) ? `error ${statusOf(error)}` : 'server not reachable')

/** Asks once. A prompt left open must not keep the button spinning. */
export function askNotificationPermission(): Promise<NotificationPermission> {
  return step(Notification.requestPermission(), PUSH_TIMEOUTS.permission, 'permission-timeout')
}

/** The active worker, registering it first if the app's own registration never happened. */
export async function activeRegistration(): Promise<ServiceWorkerRegistration> {
  if (!('serviceWorker' in navigator)) throw new PushSetupError('no-service-worker')
  try {
    const found = await step(navigator.serviceWorker.getRegistration(), PUSH_TIMEOUTS.register, 'no-service-worker')
    if (!found) await step(navigator.serviceWorker.register('/sw.js', { scope: '/' }), PUSH_TIMEOUTS.register, 'no-service-worker')
  }
  catch (error) {
    throw error instanceof PushSetupError ? error : new PushSetupError('no-service-worker')
  }
  // ready never settles when a worker fails to install, so this timeout is what ends that wait.
  return step(navigator.serviceWorker.ready, PUSH_TIMEOUTS.worker, 'no-service-worker')
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  try {
    if (!('serviceWorker' in navigator)) return null
    const reg = await step(navigator.serviceWorker.getRegistration(), PUSH_TIMEOUTS.register, 'no-service-worker')
    return reg ? await step(reg.pushManager.getSubscription(), PUSH_TIMEOUTS.register, 'push-service-unavailable') : null
  }
  catch {
    return null
  }
}

async function fetchPublicKey(): Promise<Uint8Array<ArrayBuffer>> {
  try {
    const { publicKey } = await $fetch<{ publicKey: string }>('/api/push/public-key', { timeout: PUSH_TIMEOUTS.api, retry: 0 })
    return decodePublicKey(publicKey)
  }
  catch (error) {
    if (error instanceof PushSetupError) throw error
    if (statusOf(error) === 503) throw new PushSetupError('public-key-missing')
    throw new PushSetupError('server-rejected', detailOf(error))
  }
}

const sameKey = (a: ArrayBuffer | null | undefined, b: Uint8Array) => !!a && a.byteLength === b.length && new Uint8Array(a).every((v, i) => v === b[i])

async function subscribeBrowser(reg: ServiceWorkerRegistration, key: Uint8Array<ArrayBuffer>): Promise<PushSubscription> {
  const unavailable = 'push-service-unavailable'
  try {
    const existing = await step(reg.pushManager.getSubscription(), PUSH_TIMEOUTS.register, unavailable)
    if (existing && sameKey(existing.options.applicationServerKey, key)) return existing
    // Made with a key since rotated: it can never deliver, and subscribing over it would throw.
    if (existing) await step(existing.unsubscribe(), PUSH_TIMEOUTS.register, unavailable)
    return await step(reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }), PUSH_TIMEOUTS.subscribe, unavailable)
  }
  catch (error) {
    throw error instanceof PushSetupError ? error : new PushSetupError(unavailable)
  }
}

/** Subscribes this browser and registers it with the signed-in user (reassigning it if shared). */
export async function enablePush(): Promise<void> {
  const reg = await activeRegistration()
  const key = await fetchPublicKey()
  const sub = await subscribeBrowser(reg, key)
  const json = sub.toJSON()
  try {
    await $fetch('/api/push/subscribe', { method: 'POST', body: { endpoint: json.endpoint, keys: json.keys }, timeout: PUSH_TIMEOUTS.api, retry: 0 })
  }
  catch (error) {
    throw new PushSetupError('server-rejected', detailOf(error))
  }
}

/** Removes this browser's subscription from the server and the push service. */
export async function disablePush(): Promise<void> {
  const sub = await currentPushSubscription()
  if (!sub) return
  try {
    await $fetch('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint }, timeout: PUSH_TIMEOUTS.api, retry: 0 })
  }
  finally {
    await step(sub.unsubscribe(), PUSH_TIMEOUTS.register, 'push-service-unavailable').catch(() => false)
  }
}
