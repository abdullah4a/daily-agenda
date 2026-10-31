<script setup lang="ts">
import type { ScheduleBlockData } from '~/utils/schedule'

useHead({ title: 'Schedule · Daily Agenda' })

const toast = useToast()
const { data, status, error, refresh } = useFetch<{ blocks: ScheduleBlockData[] }>('/api/schedule', { lazy: true, server: false })

const route = useRoute()
const router = useRouter()
const blocks = ref<ScheduleBlockData[]>([])
watch(data, (d) => {
  if (d) blocks.value = d.blocks.map(x => ({ ...x }))
}, { immediate: true })

const sorted = computed(() => [...blocks.value].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start)))
const productiveMinutes = computed(() => blocks.value.filter(b => b.productive).reduce((s, b) => s + blockDuration(b), 0))
const planned = computed(() => blocks.value.reduce((s, b) => s + blockDuration(b), 0))

// Editor sheet. Every change is saved as it is made; a failure keeps the sheet open with the reason.
const sheetOpen = ref(false)
const editing = ref<ScheduleBlockData | null>(null)
const editingIsNew = ref(false)
const saving = ref(false)
const sheetError = ref('')
const others = computed(() => blocks.value.filter(b => b.id !== editing.value?.id))

function openSheet(block: ScheduleBlockData, isNew: boolean) {
  editing.value = block
  editingIsNew.value = isNew
  sheetError.value = ''
  sheetOpen.value = true
}
function openEdit(id: string) {
  const b = blocks.value.find(x => x.id === id)
  if (b) openSheet({ ...b }, false)
}
function openAdd() {
  openSheet({ id: newBlockId(), label: '', productive: false, ...suggestNewBlock(blocks.value) }, true)
}

// Today's "Add your first block" lands here.
watch([data, () => route.query.add], ([d, add]) => {
  if (!d || add === undefined) return
  void router.replace({ query: {} })
  openAdd()
}, { immediate: true })

async function put(next: ScheduleBlockData[]) {
  const res = await $fetch<{ blocks: ScheduleBlockData[] }>('/api/schedule', { method: 'PUT', body: { blocks: next } })
  blocks.value = res.blocks
}
async function saveFromSheet(next: ScheduleBlockData[], done: string) {
  saving.value = true
  sheetError.value = ''
  try {
    await put(next)
    sheetOpen.value = false
    toast.success(done)
  }
  catch (e) {
    sheetError.value = apiErrorMessage(e, 'Could not save. Check your connection and try again.')
  }
  finally { saving.value = false }
}
function saveBlock(block: ScheduleBlockData) {
  const exists = blocks.value.some(b => b.id === block.id)
  const next = exists ? blocks.value.map(b => (b.id === block.id ? block : b)) : [...blocks.value, block]
  return saveFromSheet(next, exists ? `"${block.label}" saved.` : `"${block.label}" added to your schedule.`)
}
function removeBlock(id: string) {
  return saveFromSheet(blocks.value.filter(b => b.id !== id), 'Block removed.')
}

// Franklin's template, saved immediately.
const resetOpen = ref(false)
const resetting = ref(false)
async function useTemplate() {
  resetting.value = true
  try {
    await put(franklinDefaultBlocks())
    resetOpen.value = false
    toast.success('Franklin\'s daily template added.')
  }
  catch (e) {
    toast.error(apiErrorMessage(e, 'Could not add the template.'))
  }
  finally { resetting.value = false }
}
</script>

<template>
  <section class="mx-auto max-w-3xl pb-28">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-3xl">Schedule</h1>
        <p class="mt-1 text-muted">Shape the day you want to live. Tap a block to edit it.</p>
      </div>
      <div class="flex gap-2">
        <AppButton v-if="blocks.length" variant="glass" @click="resetOpen = true">Reset</AppButton>
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
      <!-- Empty -->
      <GlassCard v-if="!blocks.length" strong class="mt-6 py-12 text-center">
        <p class="text-xl font-semibold">Your day is a blank page</p>
        <p class="mx-auto mt-2 max-w-sm text-muted">Plan it your way, or start from Benjamin Franklin's routine and change anything you like.</p>
        <div class="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <AppButton @click="openAdd">Add your first block</AppButton>
          <AppButton variant="glass" :loading="resetting" @click="useTemplate">Use Franklin's daily template</AppButton>
        </div>
      </GlassCard>

      <template v-else>
        <div class="mt-6 grid grid-cols-3 gap-3">
          <GlassCard class="!p-4"><p class="text-xs text-muted">Blocks</p><p class="text-2xl font-semibold tabular-nums">{{ blocks.length }}</p></GlassCard>
          <GlassCard class="!p-4"><p class="text-xs text-muted">Productive</p><p class="text-2xl font-semibold tabular-nums text-accent">{{ scheduleDuration(productiveMinutes) }}</p></GlassCard>
          <GlassCard class="!p-4"><p class="text-xs text-muted">Planned</p><p class="text-2xl font-semibold tabular-nums">{{ scheduleDuration(planned) }}</p></GlassCard>
        </div>
        <GlassCard class="rise-in mt-6 !px-3 sm:!px-5">
          <ScheduleTimeline :blocks="sorted" @select="openEdit" />
        </GlassCard>
      </template>
    </template>

    <ScheduleBlockSheet v-model="sheetOpen" :block="editing" :is-new="editingIsNew" :others="others" :saving="saving" :error="sheetError" @save="saveBlock" @remove="removeBlock" />

    <AppModal v-model="resetOpen" title="Reset to Franklin's schedule?">
      <p class="text-muted">
        This replaces your whole schedule with Benjamin Franklin's routine and saves it right away.
      </p>
      <div class="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
        <AppButton variant="danger" block :loading="resetting" @click="useTemplate">Reset and save</AppButton>
        <AppButton variant="ghost" block :disabled="resetting" @click="resetOpen = false">Cancel</AppButton>
      </div>
    </AppModal>
  </section>
</template>
