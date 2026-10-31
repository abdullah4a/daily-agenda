<script setup lang="ts">
defineProps<{ label: string, value: string, hint?: string, tone?: 'accent' | 'success' | 'muted' }>()
</script>

<template>
  <div class="glass relative overflow-hidden rounded-glass p-4 sm:p-5">
    <div
      class="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full blur-2xl"
      :class="tone === 'success' ? 'bg-success/25' : tone === 'muted' ? 'bg-ink/10' : 'bg-accent/25'"
      aria-hidden="true"
    />
    <p class="relative text-xs font-semibold uppercase tracking-[0.12em] text-muted">{{ label }}</p>
    <p class="relative mt-1 text-3xl font-semibold tabular-nums sm:text-4xl">{{ value }}</p>
    <p v-if="hint" class="relative mt-1 text-sm text-muted">{{ hint }}</p>
  </div>
</template>
