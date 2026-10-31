export type ThemePreference = 'system' | 'light' | 'dark'

/** Theme preference persisted in a cookie so SSR renders the right attribute (no flash). */
export function useTheme() {
  const preference = useCookie<ThemePreference>('theme', { default: () => 'system', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })

  useHead({
    htmlAttrs: { 'data-theme': computed(() => (preference.value === 'system' ? undefined : preference.value)) },
  })

  function cycle() {
    const order: ThemePreference[] = ['system', 'light', 'dark']
    preference.value = order[(order.indexOf(preference.value) + 1) % order.length]!
  }

  return { preference, cycle }
}
