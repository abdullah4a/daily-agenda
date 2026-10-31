<script setup lang="ts">
import type { DayBlock } from '~/composables/todayTime'

const props = defineProps<{
  status: 'loading' | 'ready' | 'error'
  error: string
  blocks: DayBlock[]
  minutes: number | null
  /** False on an offline copy: it may only look empty, and the template would replace the real schedule. */
  canUseTemplate: boolean
  templateBusy: boolean
}>()
const emit = defineEmits<{ retry: [], template: [] }>()

const rows = computed(() => sortBlocks(props.blocks).map(block => ({
  block,
  ...(props.minutes === null
    ? { status: 'upcoming' as const, progress: 0, remaining: 0 }
    : blockState(block, props.minutes)),
})))
</script>

<template>
  <section aria-labelledby="schedule-heading">
    <h2 id="schedule-heading" class="mb-4 text-xl">Today's schedule</h2>

    <ul v-if="status === 'loading'" class="space-y-3" aria-busy="true" aria-label="Loading schedule">
      <li v-for="i in 4" :key="i" class="glass h-[84px] animate-pulse rounded-xl" />
    </ul>

    <GlassCard v-else-if="status === 'error'" class="text-center" role="alert">
      <p class="font-medium text-danger">{{ error }}</p>
      <AppButton class="mt-4" variant="glass" @click="emit('retry')">Try again</AppButton>
    </GlassCard>

    <GlassCard v-else-if="!blocks.length" class="text-center">
      <p class="font-medium">Your day is a blank page</p>
      <p class="mt-1 text-sm text-muted">Add what you plan to do, or start from Benjamin Franklin's routine.</p>
      <div class="mt-4 flex flex-col justify-center gap-2 sm:flex-row">
        <AppButton to="/schedule?add=1">Add your first block</AppButton>
        <AppButton v-if="canUseTemplate" variant="glass" :loading="templateBusy" @click="emit('template')">Use Franklin's daily template</AppButton>
      </div>
    </GlassCard>

    <ol v-else>
      <TodayBlockItem v-for="r in rows" :key="r.block.id" v-bind="r">
        <template #actions="slotProps"><slot name="block-actions" v-bind="slotProps" /></template>
      </TodayBlockItem>
    </ol>
  </section>
</template>
