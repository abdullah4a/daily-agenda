<script setup lang="ts">
import type { DayBlock } from '~/composables/todayTime'

const props = defineProps<{
  status: 'loading' | 'ready' | 'error'
  error: string
  blocks: DayBlock[]
  minutes: number | null
}>()
const emit = defineEmits<{ retry: [] }>()

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
      <p class="font-medium">No blocks scheduled</p>
      <p class="mt-1 text-sm text-muted">Add blocks on the Schedule page to see your day take shape here.</p>
      <AppButton class="mt-4" variant="glass" to="/schedule">Edit schedule</AppButton>
    </GlassCard>

    <ol v-else>
      <TodayBlockItem v-for="r in rows" :key="r.block.id" v-bind="r">
        <template #actions="slotProps"><slot name="block-actions" v-bind="slotProps" /></template>
      </TodayBlockItem>
    </ol>
  </section>
</template>
