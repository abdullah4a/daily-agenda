<script setup lang="ts">
const { $pwa } = useNuxtApp()
const saveBarActive = useSaveBarActive()
const applying = ref(false)
const APPLY_TIMEOUT_MS = 10000
let applyTimer: ReturnType<typeof setTimeout> | null = null

/** The new worker takes over and the page reloads, so nothing may be waiting in a save bar. */
async function apply() {
  if (saveBarActive.value || applying.value) return
  applying.value = true
  // A working update reloads the page first. If it stalls, the button must come back.
  applyTimer = setTimeout(() => { applying.value = false }, APPLY_TIMEOUT_MS)
  await $pwa?.updateServiceWorker(true)
}

onBeforeUnmount(() => { if (applyTimer) clearTimeout(applyTimer) })
</script>

<template>
  <Transition name="update-rise">
    <section v-if="$pwa?.needRefresh" class="glass-strong pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-glass p-4" aria-label="Update ready" role="status">
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold">Update ready</p>
        <p class="text-xs text-muted">A new version of Daily Agenda is available.</p>
      </div>
      <button type="button" class="shrink-0 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-60" :disabled="applying" @click="apply">Update</button>
    </section>
  </Transition>
</template>

<style scoped>
.update-rise-enter-active, .update-rise-leave-active { transition: opacity 0.35s var(--ease), transform 0.35s var(--ease); }
.update-rise-enter-from, .update-rise-leave-to { opacity: 0; transform: translateY(1rem); }
@media (prefers-reduced-motion: reduce) {
  .update-rise-enter-active, .update-rise-leave-active { transition: none; }
}
</style>
