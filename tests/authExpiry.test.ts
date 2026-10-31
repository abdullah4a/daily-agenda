import { describe, expect, it } from 'vitest'
import { isSessionExpiry } from '../utils/authExpiry'
import { BACKGROUND_HEADER } from '../utils/pwaProtocol'

const none = new Headers()

describe('isSessionExpiry', () => {
  it('treats a 401 on a page read as the end of the session', () => {
    expect(isSessionExpiry('/api/entries/today', 401, none)).toBe(true)
    expect(isSessionExpiry('/api/settings', 401, none)).toBe(true)
    expect(isSessionExpiry('/api/auth/me', 401, none)).toBe(true)
    expect(isSessionExpiry('http://localhost:3469/api/schedule', 401, none)).toBe(true)
  })
  it('leaves a wrong password to the form', () => {
    expect(isSessionExpiry('/api/auth/login', 401, none)).toBe(false)
    expect(isSessionExpiry('/api/auth/signup', 401, none)).toBe(false)
    expect(isSessionExpiry('/api/_auth/session', 401, none)).toBe(false)
  })
  it('leaves background sync to hold the queue and offer Sign in', () => {
    const headers = new Headers({ [BACKGROUND_HEADER]: '1' })
    expect(isSessionExpiry('/api/auth/me', 401, headers)).toBe(false)
    expect(isSessionExpiry('/api/entries/2026-10-31', 401, headers)).toBe(false)
  })
  it('ignores other statuses', () => {
    expect(isSessionExpiry('/api/settings', 403, none)).toBe(false)
    expect(isSessionExpiry('/api/settings', 500, none)).toBe(false)
  })
})
