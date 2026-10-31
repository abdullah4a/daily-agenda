<script setup lang="ts">
import type { BlockStatus, DayBlock } from '~/composables/todayTime'

const props = defineProps<{ block: DayBlock, status: BlockStatus, progress: number, remaining: number }>()
const percent = computed(() => Math.round(props.progress * 100))
</script>

<template>
  <li class="group relative flex gap-3 sm:gap-4" :aria-current="status === 'current' ? 'time' : undefined">
    <div class="flex w-5 shrink-0 flex-col items-center pt-5" aria-hidden="true">
      <span
        class="z-10 h-3.5 w-3.5 rounded-full border-2 transition"
        :class="{
          'border-accent bg-accent shadow-[0_0_0_5px_rgb(var(--accent)/0.18)]': status === 'current',
          'border-success bg-success': status === 'past',
          'border-muted bg-transparent': status === 'upcoming',
        }"
      />
      <span class="-mb-4 mt-1 w-px flex-1 bg-ink/20 group-last:hidden" />
    </div>
    <div
      class="mb-3 min-w-0 flex-1 rounded-xl border p-4 transition duration-500"
      :class="status === 'current'
        ? 'glass-strong outline outline-2 -outline-offset-1 outline-accent/80'
        : status === 'past' ? 'glass border-transparent opacity-80' : 'glass border-transparent'"
    >
      <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div class="min-w-0">
          <p class="flex flex-wrap items-center gap-2 font-semibold">
            <span class="truncate">{{ block.label }}</span>
            <span v-if="status === 'current'" class="rounded-full bg-accent px-2 py-0.5 text-xs text-accent-ink">Now</span>
            <span v-else-if="status === 'past'" class="sr-only">(finished)</span>
            <span v-if="block.productive" class="rounded-full border border-ink/25 px-2 py-0.5 text-xs font-medium text-muted">Focus</span>
          </p>
          <p class="mt-0.5 text-sm text-muted">{{ formatClock(block.start) }} – {{ formatClock(block.end) }}</p>
        </div>
        <!-- On phones the check-offs get their own row, so long labels keep their width. -->
        <div class="flex min-h-[44px] min-w-[44px] shrink-0 items-center sm:justify-end" data-slot="block-actions">
          <slot name="actions" :block="block" :status="status" />
        </div>
      </div>
      <div v-if="status === 'current'" class="mt-3">
        <div class="h-2 overflow-hidden rounded-full bg-ink/15" role="progressbar" :aria-valuenow="percent" aria-valuemin="0" aria-valuemax="100" :aria-label="`${block.label} progress`">
          <div class="h-full rounded-full bg-accent transition-[width] duration-1000 ease-linear" :style="{ width: `${progress * 100}%` }" />
        </div>
        <p class="mt-1.5 text-sm text-muted">{{ percent }}% · {{ formatDuration(remaining) }} left</p>
      </div>
    </div>
  </li>
</template>
