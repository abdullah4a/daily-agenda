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

function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padded = value + '='.repeat((4 - (value.length % 4)) % 4)
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  return (await navigator.serviceWorker.getRegistration()) ?? null
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  try {
    return (await (await registration())?.pushManager.getSubscription()) ?? null
  }
  catch {
    return null
  }
}

/** Subscribes this browser and registers it with the signed-in user (reassigning it if shared). */
export async function enablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.ready
  const existing = await reg.pushManager.getSubscription()
  const sub = existing ?? await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array((await $fetch<{ publicKey: string }>('/api/push/public-key')).publicKey),
  })
  const json = sub.toJSON()
  await $fetch('/api/push/subscribe', { method: 'POST', body: { endpoint: json.endpoint, keys: json.keys } })
}

/** Removes this browser's subscription from the server and the push service. */
export async function disablePush(): Promise<void> {
  const sub = await currentPushSubscription()
  if (!sub) return
  try {
    await $fetch('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } })
  }
  finally {
    await sub.unsubscribe().catch(() => false)
  }
}
