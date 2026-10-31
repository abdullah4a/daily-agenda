/** Sign-out with the unsynced-changes check. The confirmation lives in AppNav, on every signed-in page. */
export function useSignOut() {
  const auth = useAuthStore()
  const sync = useSyncStore()
  const today = useTodayStore()
  const toast = useToast()
  const confirming = useState('sign-out-confirming', () => false)
  const busy = useState('sign-out-busy', () => false)

  async function finish(discardPending: boolean) {
    confirming.value = false
    busy.value = true
    try {
      await auth.logout({ discardPending })
      today.reset()
      await navigateTo('/login')
    }
    catch (e) {
      toast.error(apiErrorMessage(e))
    }
    finally { busy.value = false }
  }

  async function signOut() {
    if (!navigator.onLine) return void toast.error(OFFLINE_SIGN_OUT)
    busy.value = true
    await today.flush()
    busy.value = false
    if (sync.pending) confirming.value = true
    else await finish(false)
  }

  return { signOut, finish, confirming, busy }
}
