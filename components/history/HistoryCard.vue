<script setup lang="ts">
import type { HistoryItem } from './types'
import { formatDay, preview } from './format'

const props = defineProps<{ item: HistoryItem, index: number }>()
defineEmits<{ open: [item: HistoryItem] }>()
const day = computed(() => formatDay(props.item.date))
</script>

<template>
  <button
    type="button"
    class="glass rise-in group block w-full rounded-glass p-5 text-left transition duration-300 hover:-translate-y-0.5 hover:brightness-105 active:scale-[0.99] sm:p-6"
    :style="{ animationDelay: `${Math.min(index % 20, 10) * 40}ms` }"
    :aria-label="`Open ${day.long}`"
    @click="$emit('open', item)"
  >
    <div class="flex items-center gap-4">
      <div class="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-accent/15 text-center leading-none">
        <div>
          <div class="text-[0.65rem] font-semibold uppercase tracking-widest text-muted">{{ day.month }}</div>
          <div class="mt-0.5 text-xl font-semibold">{{ day.day }}</div>
        </div>
      </div>
      <div class="min-w-0 flex-1">
        <p class="truncate font-semibold">{{ day.weekday }}</p>
        <p class="text-sm text-muted">
          {{ day.year }}<template v-if="item.completedBlocks.length"> · {{ item.completedBlocks.length }} block{{ item.completedBlocks.length === 1 ? '' : 's' }} done</template>
        </p>
      </div>
      <svg viewBox="0 0 24 24" class="h-5 w-5 shrink-0 text-muted transition group-hover:translate-x-0.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
    </div>
    <dl class="mt-4 space-y-2 text-sm">
      <div v-if="item.morningAnswer.trim()" class="flex gap-3">
        <dt class="w-16 shrink-0 font-semibold text-accent">Morning</dt>
        <dd class="line-clamp-2 min-w-0 break-words text-muted">{{ preview(item.morningAnswer) }}</dd>
      </div>
      <div v-if="item.eveningAnswer.trim()" class="flex gap-3">
        <dt class="w-16 shrink-0 font-semibold text-accent">Evening</dt>
        <dd class="line-clamp-2 min-w-0 break-words text-muted">{{ preview(item.eveningAnswer) }}</dd>
      </div>
    </dl>
  </button>
</template>
