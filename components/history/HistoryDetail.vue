<script setup lang="ts">
import type { HistoryItem } from './types'

const props = defineProps<{ item: HistoryItem }>()
const sections = computed(() => [
  { key: 'Morning', text: props.item.morningAnswer },
  { key: 'Evening', text: props.item.eveningAnswer },
])
</script>

<template>
  <div class="space-y-5">
    <section v-for="s in sections" :key="s.key">
      <h3 class="text-xs font-semibold uppercase tracking-widest text-accent">{{ s.key }}</h3>
      <p v-if="s.text.trim()" class="mt-2 whitespace-pre-wrap break-words rounded-2xl bg-ink/5 p-4 text-[0.95rem] leading-relaxed">{{ s.text }}</p>
      <p v-else class="mt-2 text-sm text-muted">No answer.</p>
    </section>
    <section>
      <h3 class="text-xs font-semibold uppercase tracking-widest text-accent">Completed blocks</h3>
      <ul v-if="item.completedBlocks.length" class="mt-2 space-y-2">
        <li v-for="b in item.completedBlocks" :key="b.blockId" class="flex items-center gap-3 rounded-2xl bg-ink/5 px-4 py-3 text-sm">
          <svg viewBox="0 0 24 24" class="h-4 w-4 shrink-0 text-success" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 13l4 4L19 7" /></svg>
          <span class="min-w-0 flex-1 truncate font-medium">{{ b.label }}</span>
          <span class="shrink-0 tabular-nums text-muted">{{ b.start }}-{{ b.end }}</span>
        </li>
      </ul>
      <p v-else class="mt-2 text-sm text-muted">No blocks completed.</p>
    </section>
  </div>
</template>
