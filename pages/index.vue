<script setup lang="ts">
const MAX_ANSWER = 5000

const auth = useAuthStore()
const today = useTodayStore()
const toast = useToast()
const signInAgain = useSessionExpiry()

const now = ref<ZonedClock | null>(null)
const timezone = computed(() => auth.user?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone)
const period = computed(() => (now.value ? periodAt(now.value.minutes) : null))

const dateLabel = computed(() => {
  if (!now.value) return ''
  // The server's day, which can differ from this device's clock.
  const [y, m, d] = (today.date || now.value.date).split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y!, m! - 1, d!)))
})
const timeLabel = computed(() => {
  if (!now.value) return ''
  const total = Math.floor(now.value.minutes)
  return formatClock(`${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`)
})
const dayPercent = computed(() => (now.value ? (now.value.minutes / 1440) * 100 : 0))

function tick() {
  const next = zonedClock(timezone.value)
  const rolled = now.value && now.value.date !== next.date
  now.value = next
  if (rolled) void today.rollover()
}

// ---------- This device is in another timezone ----------
const ZONE_DISMISS_KEY = 'da-zone-kept'
const deviceZone = ref('')
const zoneKept = ref(true) // Hidden until storage has been read on the client.
const zoneBusy = ref(false)
const zonePair = computed(() => `${deviceZone.value}|${auth.user?.timezone}`)
const zonePrompt = computed(() => !zoneKept.value && !!auth.user && zonesDiffer(deviceZone.value, auth.user.timezone))

function readZoneChoice() {
  deviceZone.value = Intl.DateTimeFormat().resolvedOptions().timeZone
  try { zoneKept.value = localStorage.getItem(ZONE_DISMISS_KEY) === zonePair.value }
  catch { zoneKept.value = false }
}
function keepZone() {
  zoneKept.value = true
  try { localStorage.setItem(ZONE_DISMISS_KEY, zonePair.value) }
  catch { /* asks again next time */ }
}
async function useDeviceZone() {
  zoneBusy.value = true
  try {
    await $fetch('/api/settings', { method: 'PUT', body: { timezone: deviceZone.value } })
    await auth.fetchMe({ fresh: true })
    void today.refresh()
  }
  catch (e) {
    toast.error(apiErrorMessage(e, 'Could not change your timezone.'))
  }
  finally { zoneBusy.value = false }
}

const templateBusy = ref(false)
async function useTemplate() {
  templateBusy.value = true
  try {
    await today.applyTemplate()
    toast.success('Franklin\'s daily template added.')
  }
  catch (e) {
    toast.error(apiErrorMessage(e, 'Could not add the template.'))
  }
  finally { templateBusy.value = false }
}

let timer: ReturnType<typeof setInterval> | null = null
function startClock() {
  if (timer) return
  tick()
  timer = setInterval(tick, 1000)
}
function stopClock() {
  if (timer) clearInterval(timer)
  timer = null
}

function onVisibility() {
  if (document.visibilityState === 'hidden') {
    stopClock()
    void today.flush()
  }
  else {
    startClock()
    void today.refresh()
  }
}
function onPageHide() {
  void today.flush()
}

onMounted(async () => {
  today.reset()
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pagehide', onPageHide)
  if (!auth.user) await auth.fetchMe()
  readZoneChoice()
  startClock()
  void today.load()
})

onBeforeUnmount(() => {
  stopClock()
  document.removeEventListener('visibilitychange', onVisibility)
  window.removeEventListener('pagehide', onPageHide)
  today.dispose()
  void today.flush()
})

useHead({ title: 'Today · Daily Agenda' })
</script>

<template>
  <section class="space-y-8">
    <!-- Hero: date, live clock, day progress, save state -->
    <header class="glass-strong rise-in relative overflow-hidden rounded-glass p-5 sm:p-6">
      <div class="relative flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div class="min-w-0">
          <p class="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Today</p>
          <h1 class="mt-1 text-3xl sm:text-4xl">
            <span v-if="dateLabel">{{ dateLabel }}</span>
            <span v-else class="inline-block h-9 w-56 animate-pulse rounded-lg bg-ink/15 align-middle" aria-hidden="true" />
          </h1>
        </div>
        <div class="text-right">
          <p class="text-2xl font-semibold tabular-nums sm:text-3xl" aria-hidden="true">{{ timeLabel || '—' }}</p>
          <p class="text-xs text-muted">{{ timezone }}</p>
        </div>
      </div>
      <div class="relative mt-5 h-1.5 overflow-hidden rounded-full bg-ink/15" aria-hidden="true">
        <div class="h-full rounded-full bg-accent transition-[width] duration-1000 ease-linear" :style="{ width: `${dayPercent}%` }" />
      </div>
      <div class="relative mt-3 flex flex-wrap items-center justify-end gap-x-3">
        <span v-if="today.dayNotice" class="text-xs text-muted" role="status">New day started</span>
        <span v-if="today.offlineCopy" class="rounded-full border border-ink/25 px-2.5 py-0.5 text-xs font-semibold text-muted" role="status">Offline copy</span>
        <TodaySaveStatus :state="today.saveState" :error="today.saveError" :pending="today.unsaved" @retry="today.flush()" @reauth="signInAgain" />
      </div>
    </header>

    <GlassCard v-if="zonePrompt" class="rise-in !p-4" role="region" aria-label="Timezone">
      <p class="text-sm">
        This device is in <strong>{{ deviceZone.replace(/_/g, ' ') }}</strong>, but your agenda follows <strong>{{ auth.user?.timezone.replace(/_/g, ' ') }}</strong>.
      </p>
      <div class="mt-3 flex flex-wrap gap-2">
        <AppButton :loading="zoneBusy" @click="useDeviceZone">Use this device's timezone</AppButton>
        <AppButton variant="ghost" :disabled="zoneBusy" @click="keepZone">Keep {{ auth.user?.timezone.replace(/_/g, ' ') }}</AppButton>
      </div>
    </GlassCard>

    <TodayParkedNotice />

    <p v-if="period === 'late-night'" class="text-sm text-muted">It is late. Both questions will keep until morning.</p>

    <!-- Questions -->
    <TodaySkeleton v-if="today.entryStatus === 'loading'" />

    <GlassCard v-else-if="today.entryStatus === 'error'" role="alert" class="text-center">
      <p class="text-lg font-semibold">Today did not load</p>
      <p class="mt-1 text-muted">{{ today.entryError }}</p>
      <AppButton class="mt-5" @click="today.loadEntry()">Try again</AppButton>
    </GlassCard>

    <div v-else class="rise-in grid gap-4 sm:grid-cols-2">
      <TodayQuestionCard
        :model-value="today.drafts.morningAnswer"
        :status="today.fieldStatus('morningAnswer')"
        eyebrow="Morning"
        question="What good shall I do this day?"
        placeholder="Set your intention for today…"
        :active="period === 'morning'"
        :maxlength="MAX_ANSWER"
        @update:model-value="today.setDraft('morningAnswer', $event)"
        @save="today.flush()"
        @retry="today.flush()"
        @reauth="signInAgain"
        @focus="today.startEditing('morningAnswer')"
        @blur="today.stopEditing()"
      />
      <TodayQuestionCard
        :model-value="today.drafts.eveningAnswer"
        :status="today.fieldStatus('eveningAnswer')"
        eyebrow="Evening"
        question="What good have I done today?"
        placeholder="Reflect on how the day went…"
        :active="period === 'evening'"
        :maxlength="MAX_ANSWER"
        @update:model-value="today.setDraft('eveningAnswer', $event)"
        @save="today.flush()"
        @retry="today.flush()"
        @reauth="signInAgain"
        @focus="today.startEditing('eveningAnswer')"
        @blur="today.stopEditing()"
      />
    </div>

    <TodaySchedule
      :status="today.scheduleStatus"
      :error="today.scheduleError"
      :blocks="today.blocks"
      :minutes="now?.minutes ?? null"
      :can-use-template="!today.offlineCopy"
      :template-busy="templateBusy"
      @retry="today.loadSchedule()"
      @template="useTemplate"
    >
      <template #block-actions="{ block, status }">
        <TodayBlockChecks
          :label="block.label"
          :value="today.checks[block.id] ?? null"
          :pending="false"
          :emphasize="status !== 'upcoming'"
          @set="today.setCheck(block.id, $event)"
        />
      </template>
    </TodaySchedule>
  </section>
</template>
