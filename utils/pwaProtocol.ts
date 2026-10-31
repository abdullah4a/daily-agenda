// Shared by the app and the service worker. No Nuxt imports so both can bundle it.

/** Set by the service worker on anything answered from its cache. */
export const CACHE_HEADER = 'x-da-from-cache'
/** Asks the service worker to stay out of this read, so the answer can only come from the network. */
export const FRESH_HEADER = 'x-da-fresh'
/** Marks background reads and writes: a 401 here holds the queue instead of redirecting. */
export const BACKGROUND_HEADER = 'x-da-background'

export const PAGES_CACHE = 'da-pages-v1'
export const API_CACHE = 'da-api-v1'
