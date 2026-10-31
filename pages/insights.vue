<script setup lang="ts">
import type { InsightsResponse } from '~/components/insights/week'
import { addDays, dayLabel, formatHours, formatHoursSpoken, formatWeekRange, weekStart } from '~/components/insights/week'

useHead({ title: 'Insights · Daily Agenda' })

const auth = useAuthStore()
const timezone = computed(() => auth.user?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone)

const todayDate = ref('')
const start = ref('')
const data = ref<InsightsResponse | null>(null)
const loading = ref(true)
const error = ref('')
let requestId = 0

const currentStart = computed(() => (todayDate.value ? weekStart(todayDate.value) : ''))
const isCurrentWeek = computed(() => !!start.value && start.value === currentStart.value)
const end = computed(() => (start.value ? addDays(start.value, 6) : ''))
const rangeLabel = computed(() => (start.value ? formatWeekRange(start.value) : ''))
const heading = computed(() => {
  if (!start.value || isCurrentWeek.value) return 'This week'
  if (start.value === addDays(currentStart.value, -7)) return 'Last week'
  return `Week of ${rangeLabel.value.split(' – ')[0]}`
})

const total = computed(() => data.value?.total ?? { productiveMinutes: 0, done: 0, skipped: 0 })
const isEmpty = computed(() => !!data.value && data.value.days.every(d => d.done === 0 && d.skipped === 0))
const bestDay = computed(() => {
  let top: InsightsResponse['days'][number] | null = null
  for (const d of data.value?.days ?? []) if (d.productiveMinutes > (top?.productiveMinutes ?? 0)) top = d
  return top
})

async function load() {
  if (!start.value) return
  const id = ++requestId
  loading.value = true
  error.value = ''
  try {
    const res = await $fetch<InsightsResponse>('/api/insights', { query: { from: start.value, to: end.value } })
    if (id === requestId) data.value = res
  }
  catch (e) {
    if (id === requestId) error.value = apiErrorMessage(e, 'We could not load your insights. Check your connection and try again.')
  }
  finally {
    if (id === requestId) loading.value = false
  }
}

onMounted(async () => {
  if (!auth.user) await auth.fetchMe()
  todayDate.value = zonedClock(timezone.value).date
  start.value = weekStart(todayDate.value)
})
watch(start, () => void load())
</script>

<template>
  <section class="space-y-6">
    <header class="glass-strong rise-in relative overflow-hidden rounded-glass p-5 sm:p-6">
      <div class="relative flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div class="min-w-0">
          <p class="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Insights</p>
          <h1 class="mt-1 text-3xl sm:text-4xl">{{ heading }}</h1>
          <p class="mt-1 min-h-6 text-muted" aria-live="polite">{{ rangeLabel }}</p>
        </div>
        <nav class="flex items-center gap-2" aria-label="Week navigation">
          <AppButton variant="glass" :disabled="!start" aria-label="Previous week" @click="start = addDays(start, -7)">
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
            <span class="hidden sm:inline">Previous</span>
          </AppButton>
          <AppButton variant="ghost" :disabled="!start || isCurrentWeek" @click="start = currentStart">Today</AppButton>
          <AppButton variant="glass" :disabled="!start || isCurrentWeek" aria-label="Next week" @click="start = addDays(start, 7)">
            <span class="hidden sm:inline">Next</span>
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
          </AppButton>
        </nav>
      </div>
    </header>

    <!-- Loading -->
    <div v-if="loading && !data && !error" aria-busy="true" aria-label="Loading insights" class="space-y-4">
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div v-for="i in 3" :key="i" class="glass h-28 animate-pulse rounded-glass" />
      </div>
      <div class="glass h-80 animate-pulse rounded-glass" />
    </div>

    <!-- Error -->
    <GlassCard v-else-if="error" role="alert" class="text-center">
      <p class="text-lg font-semibold">Insights did not load</p>
      <p class="mt-1 text-muted">{{ error }}</p>
      <AppButton class="mt-5" :loading="loading" @click="load()">Try again</AppButton>
    </GlassCard>

    <div v-else-if="data" class="space-y-6 transition-opacity duration-300" :class="loading ? 'opacity-60' : ''" :aria-busy="loading || undefined">
      <!-- Totals -->
      <div class="rise-in grid grid-cols-1 gap-4 sm:grid-cols-3">
        <InsightsStatTile
          label="Productive time"
          :value="formatHours(total.productiveMinutes)"
          :hint="bestDay ? `Best day: ${dayLabel(bestDay.date, 'long')}` : 'From focus blocks marked done'"
        />
        <InsightsStatTile label="Blocks done" :value="String(total.done)" tone="success" hint="Checked off" />
        <InsightsStatTile label="Blocks skipped" :value="String(total.skipped)" tone="muted" hint="Marked as skipped" />
      </div>

      <!-- Empty -->
      <GlassCard v-if="isEmpty" class="py-10 text-center">
        <div class="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-accent/15 text-accent">
          <svg viewBox="0 0 24 24" class="h-7 w-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>
        </div>
        <p class="font-semibold">Nothing tracked {{ isCurrentWeek ? 'yet this week' : 'this week' }}</p>
        <p class="mt-1 text-sm text-muted">Mark blocks as done or skipped on Today and your week will build up here.</p>
        <AppButton class="mt-5" to="/">Go to today</AppButton>
      </GlassCard>

      <!-- Chart -->
      <GlassCard v-else as="section" aria-labelledby="chart-heading">
        <div class="mb-5 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="chart-heading" class="text-xl">Productive hours by day</h2>
          <p class="text-sm text-muted">{{ formatHoursSpoken(total.productiveMinutes) }} total</p>
        </div>
        <InsightsWeekChart :days="data.days" :today="todayDate" />
        <ul class="mt-6 grid grid-cols-7 gap-1.5 pl-[2.5rem] text-center text-xs tabular-nums sm:gap-3 sm:text-sm" aria-hidden="true">
          <li v-for="d in data.days" :key="d.date" class="rounded-lg bg-ink/5 py-1.5">
            <span class="font-semibold text-success">{{ d.done }}</span>
            <span class="text-muted"> / {{ d.skipped }}</span>
          </li>
        </ul>
        <p class="mt-2 text-center text-xs text-muted">Done / skipped per day</p>
      </GlassCard>
    </div>
  </section>
</template>
