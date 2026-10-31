/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from 'workbox-precaching'
import { registerRoute, setCatchHandler } from 'workbox-routing'
import { NetworkFirst, NetworkOnly } from 'workbox-strategies'
import type { WorkboxPlugin } from 'workbox-core'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'
import { API_CACHE, CACHE_HEADER, FRESH_HEADER, PAGES_CACHE } from '../utils/pwaProtocol'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string, revision: string | null }> }

/** Per-user caches. They are wiped on login, signup and logout so data never crosses accounts. */
const USER_CACHES = [PAGES_CACHE, API_CACHE]
const OFFLINE_URL = '/offline.html'
const WARM_TIMEOUT_MS = 8000
const APP_PAGES = new Set(['/', '/schedule', '/history', '/insights', '/settings'])
const API_READS = ['/api/entries/today', '/api/schedule', '/api/auth/me']

/** Bumped by every wipe. A read that began under an older generation must not store its answer. */
let cacheGeneration = 0

async function clearUserCaches() {
  cacheGeneration++
  await Promise.all(USER_CACHES.map(name => caches.delete(name)))
}

/** Stops an in-flight read from repopulating a user cache wiped while it was on the network. */
const generationGuard = (): WorkboxPlugin => ({
  requestWillFetch: async ({ request, state }) => {
    if (state) state.generation = cacheGeneration
    return request
  },
  cacheWillUpdate: async ({ response, state }) => (state?.generation === cacheGeneration ? response : null),
  // The wipe can also land between the check above and the write finishing.
  cacheDidUpdate: async ({ cacheName, state }) => {
    if (state?.generation !== cacheGeneration) await caches.delete(cacheName)
  },
})

/** Lets the page tell a cached answer from a live one. */
const markCached: WorkboxPlugin = {
  cachedResponseWillBeUsed: async ({ cachedResponse }) => {
    if (!cachedResponse) return null
    const headers = new Headers(cachedResponse.headers)
    headers.set(CACHE_HEADER, '1')
    return new Response(cachedResponse.body, { status: cachedResponse.status, statusText: cachedResponse.statusText, headers })
  },
}

/** True once the answer is stored. */
async function storeForOffline(cacheName: string, path: string): Promise<boolean> {
  const generation = cacheGeneration
  const response = await fetch(path, { credentials: 'same-origin', redirect: 'follow', signal: AbortSignal.timeout(WARM_TIMEOUT_MS) })
  // A signed-out visit redirects to /login or answers 401: neither is worth keeping.
  if (response.status !== 200 || response.redirected || generation !== cacheGeneration) return false
  await (await caches.open(cacheName)).put(path, response)
  if (generation === cacheGeneration) return true
  await caches.delete(cacheName)
  return false
}

/** Stores Today and its reads, so the app opens offline without needing a visit first. */
async function warmUserCaches() {
  await Promise.allSettled([
    storeForOffline(PAGES_CACHE, '/'),
    ...API_READS.map(path => storeForOffline(API_CACHE, path)),
  ])
}

/**
 * A new build's first load. The old Today page stays until its replacement is stored, so failing
 * here leaves the page offline users already had. Other pages are not fetched: they come back on
 * the next visit.
 */
async function refreshAfterUpdate() {
  const stored = await storeForOffline(PAGES_CACHE, '/').catch(() => false)
  await Promise.allSettled(API_READS.map(path => storeForOffline(API_CACHE, path)))
  if (!stored) return
  const cache = await caches.open(PAGES_CACHE)
  const home = new URL('/', self.location.origin).href
  await Promise.all((await cache.keys()).filter(r => r.url !== home).map(r => cache.delete(r)))
}

// ---------- Lifecycle ----------
self.addEventListener('message', (event) => {
  const type = (event.data as { type?: string } | null)?.type
  if (type === 'SKIP_WAITING') void self.skipWaiting()
  if (type === 'CLEAR_USER_CACHES') event.waitUntil(clearUserCaches())
  if (type === 'WARM_USER_CACHES') event.waitUntil(warmUserCaches())
})
// A worker activates only when its version changed. Cached pages point at the old build's assets,
// which precaching has just removed, so they are replaced. This runs beside activation, not inside
// its waitUntil: a slow network must not hold back every request of the new worker.
self.addEventListener('activate', () => {
  cacheGeneration++
  void refreshAfterUpdate().catch(() => undefined)
})
// A new version waits for the page's "Update ready" prompt, which sends SKIP_WAITING.
clientsClaim()
cleanupOutdatedCaches()

// ---------- App shell + static assets (precached at build time) ----------
precacheAndRoute(self.__WB_MANIFEST, { cleanURLs: false })

// ---------- Auth writes: never cached; account switches purge user caches ----------
// Registered as a route with its own handler so the cache is cleared before the response
// reaches the page. A failed logout changes nothing: the user is still signed in.
registerRoute(
  ({ url, request }) => request.method === 'POST' && /^\/api\/auth\/(login|signup|logout|reset-password)$/.test(url.pathname),
  async ({ request }) => {
    const response = await fetch(request)
    if (response.ok) await clearUserCaches()
    return response
  },
  'POST',
)

// ---------- API reads: network first, cached fallback ----------
registerRoute(
  ({ url, request }) => request.method === 'GET'
    && url.origin === self.location.origin
    && API_READS.includes(url.pathname)
    && !request.headers.has(FRESH_HEADER),
  new NetworkFirst({
    cacheName: API_CACHE,
    networkTimeoutSeconds: 4,
    plugins: [
      generationGuard(),
      markCached,
      new CacheableResponsePlugin({ statuses: [200] }), // never persist 401s or errors
      new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 7 }),
    ],
  }),
  'GET',
)

// ---------- Navigation: network first, cached page, then offline page ----------
// Only 200 non-redirected responses for known app pages are stored, so a redirect to /login
// is never cached: a logged-out visit cannot poison the cache and no redirect loop can form.
registerRoute(
  ({ request, url }) => request.mode === 'navigate' && APP_PAGES.has(url.pathname.replace(/(.)\/+$/, '$1')),
  new NetworkFirst({
    cacheName: PAGES_CACHE,
    networkTimeoutSeconds: 4,
    plugins: [
      generationGuard(),
      { cacheWillUpdate: async ({ response }) => (response.status === 200 && !response.redirected ? response : null) },
      new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 7 }),
    ],
  }),
)

// Other navigations (login, signup, ...) are network-only but still reach the catch handler offline.
registerRoute(({ request }) => request.mode === 'navigate', new NetworkOnly())

// Any navigation that fails (offline, no cached copy) falls back to the static offline page.
setCatchHandler(async ({ request }) => {
  if (request.mode === 'navigate') {
    const fallback = await matchPrecache(OFFLINE_URL)
    if (fallback) return fallback
  }
  return Response.error()
})


// ---------- Web push ----------
interface PushPayload { title?: string, body?: string, url?: string, tag?: string }

self.addEventListener('push', (event) => {
  let payload: PushPayload
  try {
    payload = (event.data?.json() ?? {}) as PushPayload
  }
  catch {
    payload = { body: event.data?.text() }
  }
  event.waitUntil(self.registration.showNotification(payload.title || 'Daily Agenda', {
    body: payload.body || 'Open your agenda for today.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: payload.tag || 'daily-agenda',
    data: { url: payload.url || '/' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  // Only same-origin paths, so a crafted payload cannot open an arbitrary site.
  const raw = (event.notification.data as { url?: string } | null)?.url ?? '/'
  const target = new URL(raw, self.location.origin)
  const path = target.origin === self.location.origin ? target.pathname + target.search : '/'
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existing = windows.find(c => new URL(c.url).origin === self.location.origin)
    if (existing) {
      await existing.focus()
      if ('navigate' in existing && new URL(existing.url).pathname !== target.pathname) await existing.navigate(path)
      return
    }
    await self.clients.openWindow(path)
  })())
})
