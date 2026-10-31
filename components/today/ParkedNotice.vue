<script setup lang="ts">
import type { ParkedAnswer } from '~/stores/today'

const today = useTodayStore()
const sync = useSyncStore()
const toast = useToast()

/** The exact version the user saw, so a newer edit from another tab is never discarded unseen. */
const confirming = ref<(SyncOp & ParkedAnswer) | null>(null)
const open = computed({
  get: () => !!confirming.value,
  set: (value) => { if (!value) confirming.value = null },
})

function fieldLabel(op: ParkedAnswer) {
  return op.field === 'morningAnswer' ? 'Morning' : 'Evening'
}

function dayLabel(date: string) {
  const [y, m, d] = date.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y!, m! - 1, d!)))
}

async function copy(op: ParkedAnswer) {
  try {
    await navigator.clipboard.writeText(op.value)
    toast.success('Copied.')
  }
  catch {
    toast.error('Could not copy. Select the text and copy it by hand.')
  }
}

function discard() {
  const op = confirming.value
  confirming.value = null
  if (op && !sync.discardOp(op)) toast.info('This answer changed, so it was kept. Check it and try again.')
}
</script>

<template>
  <div v-if="today.strandedOps.length" class="space-y-4">
    <GlassCard v-for="op in today.strandedOps" :key="op.key" class="rise-in !p-4" role="region" :aria-label="`Unsaved answer for ${op.date}`">
      <p class="text-sm font-semibold">{{ fieldLabel(op) }} answer for {{ dayLabel(op.date) }} was not saved</p>
      <p class="mt-1 text-sm text-muted">Text from two devices is too long to fit, and this day can no longer be edited here. Copy what you want to keep.</p>
      <textarea
        :value="op.value"
        readonly
        rows="5"
        :aria-label="`${fieldLabel(op)} answer for ${op.date}`"
        class="glass-strong mt-3 w-full resize-y rounded-xl p-3 text-sm text-ink"
      />
      <div class="mt-3 flex flex-wrap gap-2">
        <AppButton variant="glass" @click="copy(op)">Copy</AppButton>
        <AppButton variant="ghost" @click="confirming = op">Discard</AppButton>
      </div>
    </GlassCard>

    <AppModal v-model="open" title="Discard this answer?">
      <p class="text-muted">This text is only on this device. If you discard it, it is lost.</p>
      <div class="mt-5 flex flex-col gap-2">
        <AppButton variant="danger" block @click="discard">Discard</AppButton>
        <AppButton variant="ghost" block @click="open = false">Keep it</AppButton>
      </div>
    </AppModal>
  </div>
</template>
