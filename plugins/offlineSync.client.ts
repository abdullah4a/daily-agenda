/** Runs the offline queue on every page: follows the signed-in user and flushes on online, focus and load. */
export default defineNuxtPlugin(() => {
  const session = useUserSession()
  const sync = useSyncStore()
  const today = useTodayStore()

  sync.onReconcile(() => today.refresh())

  watch(() => session.user.value?.id, (id) => {
    if (id) void sync.start(id)
    else sync.stop()
  }, { immediate: true })

  window.addEventListener('online', () => {
    sync.setOnline(true)
    void today.refresh() // A day shown from a copy can be confirmed now.
  })
  window.addEventListener('offline', () => sync.setOnline(false))
  window.addEventListener('focus', () => void sync.trigger())
  window.addEventListener('storage', e => sync.onStorage(e.key))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void sync.trigger()
  })
})
