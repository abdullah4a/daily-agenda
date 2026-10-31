<script setup lang="ts">
import type { CheckStatus } from '~/stores/today'

const props = defineProps<{ label: string, value: CheckStatus | null, pending: boolean, emphasize: boolean }>()
const emit = defineEmits<{ set: [status: CheckStatus | null] }>()

const options = [
  { status: 'done' as const, icon: 'M5 12.5l4.5 4.5L19 7.5' },
  { status: 'skipped' as const, icon: 'M5 5l8 7-8 7M15 5v14' },
]
const toggle = (status: CheckStatus) => emit('set', props.value === status ? null : status)
</script>

<template>
  <div class="flex items-center gap-1.5" role="group" :aria-label="`Mark ${label}`" :aria-busy="pending || undefined">
    <button
      v-for="o in options"
      :key="o.status"
      type="button"
      :aria-pressed="value === o.status"
      :aria-label="`${o.status === 'done' ? 'Mark done' : 'Skip'}: ${label}`"
      class="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-semibold outline outline-1 -outline-offset-1 transition duration-200 active:scale-95"
      :class="[
        value === o.status
          ? (o.status === 'done' ? 'bg-success text-accent-ink outline-success' : 'bg-ink text-accent-ink outline-ink')
          : 'glass text-ink outline-ink/20 hover:brightness-105',
        !emphasize && value !== o.status && 'opacity-70',
        pending && 'animate-pulse',
      ]"
      @click="toggle(o.status)"
    >
      <svg viewBox="0 0 24 24" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="o.icon" /></svg>
      <span class="hidden sm:inline">{{ o.status === 'done' ? 'Done' : 'Skipped' }}</span>
    </button>
    <button
      v-if="value"
      type="button"
      class="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-muted transition hover:bg-ink/10"
      :aria-label="`Clear status: ${label}`"
      @click="emit('set', null)"
    >
      <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
    </button>
  </div>
</template>
