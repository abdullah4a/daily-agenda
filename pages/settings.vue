<script setup lang="ts">
import type { UserSettings } from '~~/server/utils/accounts'

useHead({ title: 'Settings · Daily Agenda' })

const toast = useToast()
const auth = useAuthStore()
const session = useUserSession()
const { signOut, busy: signingOut } = useSignOut()
const { data, error, refresh } = useFetch<{ settings: UserSettings }>('/api/settings', { lazy: true, server: false })

const clone = (s: UserSettings): UserSettings => JSON.parse(JSON.stringify(s))
const saved = ref<UserSettings | null>(null)
const form = ref<UserSettings | null>(null)

// Browser capabilities are read on the client only, so SSR and hydration agree.
const support = ref<PushSupport>('supported')
const permission = ref<NotificationPermission>('default')
const subscribed = ref(false)
const browserZone = ref('')
const zones = ref<string[]>([])
const ready = ref(false)

onMounted(async () => {
  support.value = pushSupport()
  if (support.value === 'supported') {
    permission.value = Notification.permission
    subscribed.value = permission.value === 'granted' && !!(await currentPushSubscription())
  }
  try {
    browserZone.value = Intl.DateTimeFormat().resolvedOptions().timeZone
    zones.value = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? []
  }
  catch { /* fall back to the saved zone only */ }
  ready.value = true
})

watch(data, (d) => {
  if (!d) return
  saved.value = clone(d.settings)
  form.value = clone(d.settings)
}, { immediate: true })

const zoneOptions = computed(() => {
  const set = new Set(zones.value)
  for (const z of [form.value?.timezone, saved.value?.timezone, browserZone.value, 'UTC']) if (z) set.add(z)
  return [...set].sort((a, b) => a.localeCompare(b))
})

const dirty = computed(() => !!form.value && JSON.stringify(form.value) !== JSON.stringify(saved.value))
useSaveBar(dirty)
onBeforeRouteLeave(() => {
  if (!session.loggedIn.value) return // Signed out: the way to /login must stay open.
  if (dirty.value && !window.confirm('You have unsaved settings. Leave without saving?')) return false
})
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value) event.preventDefault()
}
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
const usingBrowserZone = computed(() => !!browserZone.value && form.value?.timezone === browserZone.value)

// ---------- Save ----------
const saving = ref(false)
const saveError = ref('')
async function save() {
  if (!form.value || !saved.value) return
  saving.value = true
  saveError.value = ''
  const zoneChanged = form.value.timezone !== saved.value.timezone
  try {
    const res = await $fetch<{ settings: UserSettings }>('/api/settings', { method: 'PUT', body: form.value })
    saved.value = clone(res.settings)
    form.value = clone(res.settings)
    // Today derives its date from the user's timezone, so refresh the cached user.
    if (zoneChanged) await auth.fetchMe({ fresh: true })
    toast.success(zoneChanged ? 'Settings saved. Today now follows your new timezone.' : 'Settings saved.')
  }
  catch (e) {
    saveError.value = apiErrorMessage(e, 'Could not save your settings.')
  }
  finally { saving.value = false }
}
function discard() {
  if (saved.value) form.value = clone(saved.value)
  saveError.value = ''
}

// ---------- Push on this device ----------
const pushBusy = ref(false)
const pushOn = computed(() => support.value === 'supported' && permission.value === 'granted' && subscribed.value)

async function togglePush() {
  pushBusy.value = true
  try {
    if (pushOn.value) {
      await disablePush()
      subscribed.value = false
      toast.info('Reminders are off on this device.')
      return
    }
    const result = await Notification.requestPermission()
    permission.value = result
    if (result !== 'granted') {
      toast.error(result === 'denied' ? 'Notifications are blocked for this site.' : 'Notification permission was dismissed.')
      return
    }
    await enablePush()
    subscribed.value = true
    toast.success('Reminders are on for this device.')
  }
  catch (e) {
    toast.error(apiErrorMessage(e, 'Could not change notifications on this device.'))
  }
  finally { pushBusy.value = false }
}

const testing = ref(false)
async function sendTest() {
  testing.value = true
  try {
    const reg = await navigator.serviceWorker.ready
    await reg.showNotification('Daily Agenda', {
      body: 'Looks good. Your reminders will appear like this.',
      icon: '/icons/icon-192.png',
      tag: 'daily-agenda-test',
      data: { url: '/' },
    })
  }
  catch {
    toast.error('Could not show a test notification.')
  }
  finally { testing.value = false }
}

const slots = [
  { key: 'morning', title: 'Morning plan', hint: 'A nudge to set the day up.' },
  { key: 'evening', title: 'Evening review', hint: 'A prompt to reflect before bed.' },
] as const
</script>

<template>
  <section class="mx-auto max-w-2xl pb-28">
    <header>
      <h1 class="text-3xl">Settings</h1>
      <p class="mt-1 text-muted">Reminders, timezone and your account.</p>
    </header>

    <!-- Loading -->
    <div v-if="!form && !error" class="mt-8 space-y-4" aria-busy="true" aria-label="Loading settings">
      <div v-for="i in 3" :key="i" class="glass h-40 animate-pulse rounded-glass" />
    </div>

    <!-- Error -->
    <GlassCard v-else-if="error && !form" class="mt-8 text-center" role="alert">
      <p class="font-semibold">We could not load your settings.</p>
      <p class="mt-1 text-sm text-muted">{{ apiErrorMessage(error) }}</p>
      <AppButton class="mt-4" variant="glass" @click="refresh()">Try again</AppButton>
    </GlassCard>

    <form v-else-if="form" class="mt-8 space-y-5" novalidate @submit.prevent="save">
      <!-- Push on this device -->
      <GlassCard strong class="settings-hero relative overflow-hidden">
        <div class="relative flex items-start gap-4">
          <span class="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-accent/15 text-accent" aria-hidden="true">
            <svg viewBox="0 0 24 24" class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" /></svg>
          </span>
          <div class="min-w-0 flex-1">
            <h2 class="text-lg font-semibold">Push reminders</h2>
            <p class="mt-0.5 text-sm text-muted">Delivered to this device, even when the app is closed.</p>

            <p v-if="!ready" class="mt-4 text-sm text-muted">Checking this device...</p>

            <div v-else-if="support === 'ios-install'" class="mt-4 rounded-xl border border-ink/20 p-3 text-sm" role="note">
              <p class="font-semibold">Install the app first</p>
              <p class="mt-1 text-muted">On iPhone and iPad, notifications only work from the home screen. Tap Share, choose Add to Home Screen, then open Daily Agenda from there.</p>
            </div>

            <div v-else-if="support === 'unsupported'" class="mt-4 rounded-xl border border-ink/20 p-3 text-sm" role="note">
              <p class="font-semibold">Not supported in this browser</p>
              <p class="mt-1 text-muted">Try a recent version of Chrome, Edge, Firefox or Safari to receive reminders.</p>
            </div>

            <div v-else-if="permission === 'denied'" class="mt-4 rounded-xl border border-danger/50 p-3 text-sm" role="alert">
              <p class="font-semibold text-danger">Notifications are blocked</p>
              <p class="mt-1 text-muted">Allow notifications for this site in your browser or system settings, then reload this page.</p>
            </div>

            <div v-else class="mt-4 flex flex-wrap items-center gap-3">
              <AppButton :variant="pushOn ? 'glass' : 'primary'" :loading="pushBusy" @click="togglePush">
                {{ pushOn ? 'Turn off on this device' : 'Enable reminders' }}
              </AppButton>
              <AppButton v-if="pushOn" variant="ghost" :loading="testing" @click="sendTest">Send test notification</AppButton>
              <span v-if="pushOn" class="inline-flex items-center gap-1.5 text-sm font-medium text-success">
                <span class="h-2 w-2 rounded-full bg-success" aria-hidden="true" /> Active
              </span>
            </div>
          </div>
        </div>
      </GlassCard>

      <!-- Reminder times -->
      <GlassCard>
        <h2 class="text-lg font-semibold">Reminder times</h2>
        <p class="mt-0.5 text-sm text-muted">In your timezone below. Each can be switched off.</p>
        <ul class="mt-4 divide-y divide-ink/15">
          <li v-for="s in slots" :key="s.key" class="flex flex-wrap items-center gap-x-4 gap-y-3 py-4 first:pt-0 last:pb-0">
            <div class="min-w-0 flex-1 basis-40">
              <p class="font-semibold">{{ s.title }}</p>
              <p class="text-sm text-muted">{{ s.hint }}</p>
            </div>
            <label class="sr-only" :for="`time-${s.key}`">{{ s.title }} time</label>
            <input
              :id="`time-${s.key}`"
              v-model="form.reminderTimes[s.key]"
              type="time"
              required
              :disabled="!form.reminderEnabled[s.key]"
              class="glass-strong min-h-[44px] w-32 rounded-xl px-3 text-base text-ink disabled:opacity-50"
            >
            <button
              type="button"
              role="switch"
              :aria-checked="form.reminderEnabled[s.key]"
              :aria-label="`${s.title} reminder`"
              class="switch"
              :data-on="form.reminderEnabled[s.key]"
              @click="form.reminderEnabled[s.key] = !form.reminderEnabled[s.key]"
            >
              <span class="switch-thumb" />
            </button>
          </li>
        </ul>
      </GlassCard>

      <!-- Timezone -->
      <GlassCard>
        <h2 class="text-lg font-semibold">Timezone</h2>
        <p class="mt-0.5 text-sm text-muted">Decides when your day starts and when reminders fire.</p>
        <label for="timezone" class="mb-1.5 mt-4 block text-sm font-medium">Your timezone</label>
        <select id="timezone" v-model="form.timezone" class="glass-strong min-h-[44px] w-full rounded-xl px-4 text-base text-ink">
          <option v-for="z in zoneOptions" :key="z" :value="z">{{ z.replace(/_/g, ' ') }}</option>
        </select>
        <p v-if="browserZone" class="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
          <span>This device: {{ browserZone.replace(/_/g, ' ') }}</span>
          <button v-if="!usingBrowserZone" type="button" class="font-semibold text-accent underline underline-offset-2" @click="form.timezone = browserZone">Use it</button>
        </p>
      </GlassCard>

      <p v-if="saveError" role="alert" class="text-sm font-medium text-danger">{{ saveError }}</p>

      <!-- Sticky save bar -->
      <Transition name="bar">
        <div v-if="dirty" class="glass-strong fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-2xl items-center justify-between gap-3 rounded-glass p-3 md:bottom-6 md:left-72 md:right-8 md:mx-0 md:max-w-none">
          <span class="px-2 text-sm font-medium">Unsaved changes</span>
          <div class="flex gap-2">
            <AppButton variant="ghost" :disabled="saving" @click="discard">Discard</AppButton>
            <AppButton type="submit" :loading="saving">Save</AppButton>
          </div>
        </div>
      </Transition>
    </form>

    <!-- Account: outside the form so signing out works even when settings did not load. -->
    <GlassCard class="mt-5">
      <h2 class="text-lg font-semibold">Account</h2>
      <p class="mt-0.5 break-all text-sm text-muted">{{ session.user.value?.email ?? auth.user?.email }}</p>
      <AppButton class="mt-4" variant="glass" :loading="signingOut" @click="signOut">Sign out</AppButton>
    </GlassCard>
  </section>
</template>

<style scoped>
.switch {
  position: relative;
  height: 2rem;
  width: 3.25rem;
  border-radius: 9999px;
  background: rgb(var(--ink) / 0.18);
  border: 1px solid rgb(var(--hairline));
  transition: background 0.25s var(--ease);
}
.switch[data-on='true'] { background: rgb(var(--accent)); }
.switch-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  height: 1.5rem;
  width: 1.5rem;
  border-radius: 9999px;
  background: rgb(255 255 255);
  box-shadow: 0 2px 6px rgb(0 0 0 / 0.25);
  transition: transform 0.25s var(--ease);
}
.switch[data-on='true'] .switch-thumb { transform: translateX(1.2rem); }
.bar-enter-active, .bar-leave-active { transition: opacity 0.3s var(--ease), transform 0.3s var(--ease); }
.bar-enter-from, .bar-leave-to { opacity: 0; transform: translateY(0.75rem); }
@media (prefers-reduced-motion: reduce) {
  .bar-enter-active, .bar-leave-active, .switch, .switch-thumb { transition: none; }
}
</style>
