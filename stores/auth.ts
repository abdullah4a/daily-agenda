import { defineStore } from 'pinia'
import { useSyncStore } from './sync'

export interface AuthUser {
  id: string
  email: string
  timezone: string
  reminderTimes: { morning: string, evening: string }
}

/** Pulls a human-readable message out of a $fetch error. */
export function apiErrorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const e = error as { data?: { data?: { message?: string }, statusMessage?: string, message?: string }, statusMessage?: string }
  return e?.data?.data?.message || e?.data?.statusMessage || e?.data?.message || e?.statusMessage || fallback
}

export const OFFLINE_SIGN_OUT = 'You are offline. Connect to the internet to sign out.'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null)
  const loading = ref(false)
  const isAuthenticated = computed(() => user.value !== null)

  async function run<T>(fn: () => Promise<T>): Promise<T> {
    loading.value = true
    try {
      return await fn()
    }
    finally {
      loading.value = false
    }
  }

  /** fresh skips the service worker's cached copy, and keeps the current user if the read fails. */
  async function fetchMe({ fresh = false } = {}) {
    try {
      // useRequestFetch forwards the session cookie during SSR.
      const res = await useRequestFetch()<{ user: AuthUser }>('/api/auth/me', fresh ? { headers: { [FRESH_HEADER]: '1' } } : {})
      user.value = res.user
    }
    catch {
      if (!fresh) user.value = null
    }
    return user.value
  }

  async function login(email: string, password: string) {
    return run(async () => {
      const res = await $fetch<{ user: AuthUser }>('/api/auth/login', { method: 'POST', body: { email, password } })
      user.value = res.user
      await useUserSession().fetch()
      warmOfflineCaches()
    })
  }

  async function signup(email: string, password: string) {
    return run(async () => {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
      const res = await $fetch<{ user: AuthUser }>('/api/auth/signup', { method: 'POST', body: { email, password, timezone } })
      user.value = res.user
      await useUserSession().fetch()
      warmOfflineCaches()
    })
  }

  /**
   * The server is asked first: until it confirms, the user is still signed in, so nothing local is
   * touched. Unsynced changes stay on this device for this account unless discardPending is set.
   */
  async function logout({ discardPending = false } = {}) {
    return run(async () => {
      if (!navigator.onLine) throw createError({ statusMessage: OFFLINE_SIGN_OUT })
      const sync = useSyncStore()
      const owner = sync.userId
      const subscription = await currentPushSubscription()
      // Stop first: nothing of this account may be sent once the cookie is gone.
      sync.stop()
      try {
        await $fetch('/api/auth/logout', { method: 'POST', body: { endpoint: subscription?.endpoint } })
      }
      catch (e) {
        if (owner) void sync.start(owner) // Still signed in: keep syncing.
        throw e
      }
      if (discardPending && owner) sync.discardFor(owner)
      await subscription?.unsubscribe().catch(() => false)
      await clearOfflineCaches()
      user.value = null
      await useUserSession().clear()
    })
  }

  function forgotPassword(email: string) {
    return run(() => $fetch('/api/auth/forgot-password', { method: 'POST', body: { email } }))
  }

  function resetPassword(token: string, password: string) {
    return run(async () => {
      await $fetch('/api/auth/reset-password', { method: 'POST', body: { token, password } })
      // The reset ended any session here, so this account's offline copies must go with it.
      await clearOfflineCaches()
      // Without this the login page bounces back to Today.
      await useUserSession().fetch()
    })
  }

  return { user, loading, isAuthenticated, fetchMe, login, signup, logout, forgotPassword, resetPassword }
})
