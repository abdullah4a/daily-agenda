<script setup lang="ts">
const lifted = useSaveBarActive()
const dock = ref<HTMLElement | null>(null)

// Pages leave room for the dock, so it never sits on the last thing on a page.
let observer: ResizeObserver | null = null
onMounted(() => {
  if (!dock.value || typeof ResizeObserver === 'undefined') return
  observer = new ResizeObserver(([entry]) => {
    const height = entry?.contentRect.height ?? 0
    document.documentElement.style.setProperty('--dock-room', `${height ? height + 16 : 0}px`)
  })
  observer.observe(dock.value)
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <!-- Under the save bars (z-40) and modals (z-50). -->
  <div ref="dock" class="dock pointer-events-none fixed inset-x-4 z-[35] flex flex-col items-center gap-2 md:left-auto md:right-6 md:items-end" :data-lifted="lifted">
    <OfflineIndicator />
    <PwaUpdatePrompt v-show="!lifted" />
    <PwaInstallPrompt v-show="!lifted" />
  </div>
</template>

<style scoped>
.dock { bottom: calc(5.5rem + env(safe-area-inset-bottom)); transition: bottom 0.3s var(--ease); }
.dock[data-lifted='true'] { bottom: calc(10.5rem + env(safe-area-inset-bottom)); }
@media (min-width: 768px) {
  .dock { bottom: 1.5rem; }
  .dock[data-lifted='true'] { bottom: 6.5rem; }
}
</style>
