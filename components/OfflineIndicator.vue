<script setup lang="ts">
const online = useOnline()
</script>

<template>
  <div role="status" aria-live="polite">
    <Transition name="offline-pill">
      <div v-if="!online" class="glass-strong flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-ink">
        <svg viewBox="0 0 24 24" class="h-4 w-4 text-danger" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 2l20 20M8.5 16.4a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 5.2-2.7M19 12.9a10 10 0 0 0-2.4-1.8M2 8.8a15 15 0 0 1 4.2-2.6M22 8.8A15 15 0 0 0 12 5M12 20h.01" /></svg>
        <span>You are offline. Showing saved data.</span>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.offline-pill-enter-active, .offline-pill-leave-active { transition: opacity 0.3s var(--ease), transform 0.3s var(--ease); }
.offline-pill-enter-from, .offline-pill-leave-to { opacity: 0; transform: translateY(0.5rem); }
@media (prefers-reduced-motion: reduce) {
  .offline-pill-enter-active, .offline-pill-leave-active { transition: none; }
}
</style>
