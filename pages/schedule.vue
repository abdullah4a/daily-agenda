<script setup lang="ts">
import type { ScheduleBlockData } from '~/utils/schedule'

useHead({ title: 'Schedule · Daily Agenda' })

const toast = useToast()
const { data, status, error, refresh } = useFetch<{ blocks: ScheduleBlockData[] }>('/api/schedule', { lazy: true, server: false })

const clone = (b: ScheduleBlockData[]) => b.map(x => ({ ...x }))
const blocks = ref<ScheduleBlockData[]>([])
const saved = ref<ScheduleBlockData[]>([])
watch(data, (d) => {
  if (!d) return
  saved.value = clone(d.blocks)
  blocks.value = clone(d.blocks)
}, { immediate: true })

const sorted = computed(() => [...blocks.value].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start)))
const dirty = computed(() => JSON.stringify(blocks.value) !== JSON.stringify(saved.value))
const issues = computed(() => checkSchedule(blocks.value))
useSaveBar(dirty)
const productiveMinutes = computed(() => blocks.value.filter(b => b.productive).reduce((s, b) => s + blockDuration(b), 0))
const planned = computed(() => blocks.value.reduce((s, b) => s + blockDuration(b), 0))

// Server validation error, shown until the next edit.
const serverError = ref('')
const serverIds = computed(() => new Set(
  [...serverError.value.matchAll(/"([^"]+)"/g)].map(m => m[1]!).filter(id => blocks.value.some(b => b.id === id)),
))
const flagged = computed(() => new Set([...issues.value.blockIds, ...serverIds.value]))
watch(blocks, () => { serverError.value = '' })

// Editor sheet
const sheetOpen = ref(false)
const editing = ref<ScheduleBlockData | null>(null)
const editingIsNew = ref(false)
const others = computed(() => blocks.value.filter(b => b.id !== editing.value?.id))

function openEdit(id: string) {
  const b = blocks.value.find(x => x.id === id)
  if (!b) return
  editing.value = { ...b }
  editingIsNew.value = false
  sheetOpen.value = true
}
function openAdd() {
  editing.value = { id: newBlockId(), label: '', productive: false, ...suggestNewBlock(blocks.value) }
  editingIsNew.value = true
  sheetOpen.value = true
}
function applyBlock(block: ScheduleBlockData) {
  blocks.value = blocks.value.some(b => b.id === block.id)
    ? blocks.value.map(b => (b.id === block.id ? block : b))
    : [...blocks.value, block]
}
function removeBlock(id: string) {
  blocks.value = blocks.value.filter(b => b.id !== id)
}

// Saving
const saving = ref(false)
async function put(next: ScheduleBlockData[]) {
  const res = await $fetch<{ blocks: ScheduleBlockData[] }>('/api/schedule', { method: 'PUT', body: { blocks: next } })
  saved.value = clone(res.blocks)
  blocks.value = clone(res.blocks)
}
async function save() {
  if (issues.value.general.length) return
  saving.value = true
  try {
    await put(blocks.value)
    toast.success('Schedule saved.')
  }
  catch (e) {
    // Set after the blocks watcher has had no chance to clear it (blocks unchanged on failure).
    serverError.value = apiErrorMessage(e, 'Could not save your schedule.')
  }
  finally { saving.value = false }
}
function discard() {
  blocks.value = clone(saved.value)
}

// Reset to Franklin's defaults, saved immediately through PUT.
const resetOpen = ref(false)
const resetting = ref(false)
async function resetDefaults() {
  resetting.value = true
  try {
    await put(franklinDefaultBlocks())
    resetOpen.value = false
    toast.success('Franklin\'s schedule restored.')
  }
  catch (e) {
    toast.error(apiErrorMessage(e, 'Could not reset your schedule.'))
  }
  finally { resetting.value = false }
}

// Unsaved-changes guards
onBeforeRouteLeave(() => {
  if (dirty.value && !window.confirm('You have unsaved schedule changes. Leave without saving?')) return false
})
function beforeUnload(e: BeforeUnloadEvent) {
  if (dirty.value) { e.preventDefault(); e.returnValue = '' }
}
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
</script>

<template>
  <section class="mx-auto max-w-3xl pb-28">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-3xl">Schedule</h1>
        <p class="mt-1 text-muted">Shape the day you want to live. Tap a block to edit it.</p>
      </div>
      <div class="flex gap-2">
        <AppButton variant="glass" :disabled="!data" @click="resetOpen = true">Reset</AppButton>
        <AppButton :disabled="!data || blocks.length >= SCHEDULE_MAX_BLOCKS" @click="openAdd">
          <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          Add block
        </AppButton>
      </div>
    </header>

    <!-- Loading -->
    <div v-if="!data && !error" class="mt-6 space-y-3" aria-busy="true" aria-live="polite">
      <span class="sr-only">Loading your schedule</span>
      <div v-for="n in 4" :key="n" class="glass h-24 animate-pulse rounded-glass" />
    </div>

    <!-- Load error -->
    <GlassCard v-else-if="!data" role="alert" class="mt-6 text-center">
      <p class="text-lg font-semibold">Your schedule did not load</p>
      <p class="mt-1 text-muted">{{ apiErrorMessage(error, 'Could not load your schedule.') }}</p>
      <AppButton class="mt-5" variant="glass" :loading="status === 'pending'" @click="refresh()">Try again</AppButton>
    </GlassCard>

    <template v-else>
      <!-- Validation banner -->
      <div v-if="serverError || issues.general.length" role="alert" class="alert-banner mt-6 rounded-glass border border-danger/40 px-5 py-4">
        <p class="text-sm font-semibold text-danger">{{ serverError ? 'The server rejected this schedule' : 'Fix these before saving' }}</p>
        <ul class="mt-1 list-inside list-disc space-y-0.5 text-sm text-danger">
          <li v-if="serverError">{{ serverError }}</li>
          <li v-for="g in issues.general" :key="g">{{ g }}</li>
        </ul>
      </div>

      <!-- Summary -->
      <div class="mt-6 grid grid-cols-3 gap-3">
        <GlassCard class="!p-4"><p class="text-xs text-muted">Blocks</p><p class="text-2xl font-semibold tabular-nums">{{ blocks.length }}</p></GlassCard>
        <GlassCard class="!p-4"><p class="text-xs text-muted">Productive</p><p class="text-2xl font-semibold tabular-nums text-accent">{{ scheduleDuration(productiveMinutes) }}</p></GlassCard>
        <GlassCard class="!p-4"><p class="text-xs text-muted">Planned</p><p class="text-2xl font-semibold tabular-nums">{{ scheduleDuration(planned) }}</p></GlassCard>
      </div>

      <!-- Empty -->
      <GlassCard v-if="!blocks.length" strong class="mt-6 py-12 text-center">
        <p class="text-xl font-semibold">Your day is a blank page</p>
        <p class="mx-auto mt-2 max-w-sm text-muted">Add your first block, or start from Benjamin Franklin's famous routine.</p>
        <div class="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <AppButton @click="openAdd">Add a block</AppButton>
          <AppButton variant="glass" @click="resetOpen = true">Use Franklin's schedule</AppButton>
        </div>
      </GlassCard>

      <GlassCard v-else class="rise-in mt-6 !px-3 sm:!px-5">
        <ScheduleTimeline :blocks="sorted" :flagged="flagged" @select="openEdit" />
      </GlassCard>
    </template>

    <!-- Unsaved-changes bar, above the mobile nav -->
    <Transition name="bar">
      <div v-if="dirty" class="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-xl md:bottom-6 md:left-72">
        <div class="glass-strong flex items-center justify-between gap-3 rounded-[1.5rem] p-3 pl-5">
          <p class="text-sm font-semibold" role="status">Unsaved changes</p>
          <div class="flex gap-2">
            <AppButton variant="ghost" :disabled="saving" @click="discard">Discard</AppButton>
            <AppButton :loading="saving" :disabled="issues.general.length > 0" @click="save">Save</AppButton>
          </div>
        </div>
      </div>
    </Transition>

    <ScheduleBlockSheet v-model="sheetOpen" :block="editing" :is-new="editingIsNew" :others="others" @apply="applyBlock" @remove="removeBlock" />

    <AppModal v-model="resetOpen" title="Reset to Franklin's schedule?">
      <p class="text-muted">
        This replaces your whole schedule with Benjamin Franklin's routine and saves it right away.
        <template v-if="dirty"> Your unsaved changes will be lost.</template>
      </p>
      <div class="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
        <AppButton variant="danger" block :loading="resetting" @click="resetDefaults">Reset and save</AppButton>
        <AppButton variant="ghost" block :disabled="resetting" @click="resetOpen = false">Cancel</AppButton>
      </div>
    </AppModal>
  </section>
</template>

<style scoped>
.bar-enter-active, .bar-leave-active { transition: opacity 0.3s var(--ease), transform 0.3s var(--ease); }
.bar-enter-from, .bar-leave-to { opacity: 0; transform: translateY(16px); }
</style>
