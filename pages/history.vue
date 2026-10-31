<script setup lang="ts">
import type { HistoryItem, HistoryPage } from '~/components/history/types'
import { formatDay } from '~/components/history/format'

useHead({ title: 'History · Daily Agenda' })

const toast = useToast()
const items = ref<HistoryItem[]>([])
const nextCursor = ref<string | null>(null)
const loading = ref(true)
const loadingMore = ref(false)
const error = ref('')
const selected = ref<HistoryItem | null>(null)
const modalOpen = computed({
  get: () => selected.value !== null,
  set: (v) => { if (!v) selected.value = null },
})
const sentinel = ref<HTMLElement | null>(null)

async function load(more = false) {
  if (more && loadingMore.value) return
  if (more) loadingMore.value = true
  else { loading.value = true; error.value = '' }
  try {
    const page = await $fetch<HistoryPage>('/api/entries', {
      query: { limit: 20, cursor: more ? nextCursor.value ?? undefined : undefined },
    })
    items.value = more ? [...items.value, ...page.items] : page.items
    nextCursor.value = page.nextCursor
  }
  catch (e) {
    const message = apiErrorMessage(e)
    if (more) toast.error(message)
    else error.value = message
  }
  finally {
    loading.value = false
    loadingMore.value = false
  }
}

let observer: IntersectionObserver | null = null
onMounted(() => {
  load()
  if (typeof IntersectionObserver === 'undefined') return
  observer = new IntersectionObserver((entries) => {
    if (entries.some(e => e.isIntersecting) && nextCursor.value && !loading.value && !loadingMore.value && !error.value) load(true)
  }, { rootMargin: '400px' })
  watch(sentinel, (el, old) => {
    if (old) observer?.unobserve(old)
    if (el) observer?.observe(el)
  }, { immediate: true })
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <section>
    <h1 class="text-3xl">History</h1>
    <p class="mt-1 text-muted">Look back at your past days.</p>

    <div v-if="loading" class="mt-6 grid gap-4 lg:grid-cols-2" aria-busy="true" aria-label="Loading history">
      <div v-for="n in 4" :key="n" class="glass h-36 animate-pulse rounded-glass" />
    </div>

    <GlassCard v-else-if="error" class="mt-6 text-center" role="alert">
      <p class="font-semibold">Could not load your history</p>
      <p class="mt-1 text-sm text-muted">{{ error }}</p>
      <AppButton class="mt-4" @click="load()">Try again</AppButton>
    </GlassCard>

    <GlassCard v-else-if="!items.length" class="mt-6 py-10 text-center">
      <div class="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-accent/15 text-accent">
        <svg viewBox="0 0 24 24" class="h-7 w-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2" /></svg>
      </div>
      <p class="font-semibold">No history yet</p>
      <p class="mt-1 text-sm text-muted">Answer your morning or evening prompt and your days will show up here.</p>
      <AppButton class="mt-5" to="/">Go to today</AppButton>
    </GlassCard>

    <template v-else>
      <ul class="mt-6 grid gap-4 lg:grid-cols-2">
        <li v-for="(item, i) in items" :key="item.date">
          <HistoryCard :item="item" :index="i" @open="selected = $event" />
        </li>
      </ul>
      <div ref="sentinel" class="mt-6 flex min-h-[44px] justify-center">
        <AppButton v-if="nextCursor" variant="glass" :loading="loadingMore" @click="load(true)">Load more</AppButton>
        <p v-else class="text-sm text-muted">You have reached the beginning.</p>
      </div>
    </template>

    <AppModal v-model="modalOpen" size="lg" :title="selected ? formatDay(selected.date).long : ''">
      <HistoryDetail v-if="selected" :item="selected" />
    </AppModal>
  </section>
</template>
