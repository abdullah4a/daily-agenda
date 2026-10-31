<script setup lang="ts">
const props = defineProps<{ label: string, value: string, hint?: string, tone?: 'accent' | 'success' | 'muted' }>()
</script>

<template>
  <div class="glass relative overflow-hidden rounded-glass p-4 sm:p-5">
    <p class="relative text-xs font-semibold uppercase tracking-[0.12em] text-muted">{{ label }}</p>
    <p class="relative mt-1 text-3xl font-semibold tabular-nums sm:text-4xl" :class="props.tone === 'success' ? 'text-success' : ''">{{ value }}</p>
    <p v-if="hint" class="relative mt-1 text-sm text-muted">{{ hint }}</p>
  </div>
</template>
