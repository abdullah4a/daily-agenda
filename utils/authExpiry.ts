import { BACKGROUND_HEADER } from './pwaProtocol'

/** True when a 401 means the session ended, rather than a wrong password or a held background sync. */
export function isSessionExpiry(url: string, status: number, headers: Headers): boolean {
  if (status !== 401 || headers.has(BACKGROUND_HEADER)) return false
  const { pathname } = new URL(url, 'http://local')
  if (!pathname.startsWith('/api/')) return false
  return pathname === '/api/auth/me' || !/^\/api\/(?:auth|_auth)\//.test(pathname)
}
