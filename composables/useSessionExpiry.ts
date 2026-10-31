let expiring: Promise<void> | null = null

/**
 * Ends the local copy of a session the server no longer accepts: offline caches go, the sync
 * queue stays for when this account signs in again. Safe to call from many failing requests.
 */
export function useSessionExpiry() {
  const nuxtApp = useNuxtApp()
  const session = useUserSession()
  const auth = useAuthStore()
  const today = useTodayStore()

  async function expire() {
    await clearOfflineCaches()
    await session.clear().catch(() => { session.session.value = null })
    auth.user = null
    today.reset()
    await nuxtApp.runWithContext(() => navigateTo('/login'))
  }

  return () => (expiring ??= expire().finally(() => { expiring = null }))
}
