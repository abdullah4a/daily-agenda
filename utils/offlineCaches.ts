/** Drops cached per-user pages and API reads (and tells the service worker to do the same). */
export async function clearOfflineCaches(): Promise<void> {
  if (!import.meta.client) return
  try {
    // The worker first: it must stop in-flight reads from writing back into what is deleted here.
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined
    reg?.active?.postMessage({ type: 'CLEAR_USER_CACHES' })
    if ('caches' in window) await Promise.all([PAGES_CACHE, API_CACHE].map(name => caches.delete(name)))
  }
  catch { /* best effort */ }
}

/** Has the service worker store Today and its data now, so it opens offline straight after signing in. */
export function warmOfflineCaches(): void {
  if (!import.meta.client || !('serviceWorker' in navigator)) return
  void navigator.serviceWorker.ready
    .then(reg => reg.active?.postMessage({ type: 'WARM_USER_CACHES' }))
    .catch(() => undefined)
}
