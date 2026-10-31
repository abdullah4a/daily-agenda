/** Reactive navigator.onLine. Assumes online during SSR and until the client mounts. */
export function useOnline() {
  const online = useState('pwa-online', () => true)
  if (import.meta.client) {
    onMounted(() => {
      online.value = navigator.onLine
      const up = () => { online.value = true }
      const down = () => { online.value = false }
      window.addEventListener('online', up)
      window.addEventListener('offline', down)
      onBeforeUnmount(() => {
        window.removeEventListener('online', up)
        window.removeEventListener('offline', down)
      })
    })
  }
  return online
}
