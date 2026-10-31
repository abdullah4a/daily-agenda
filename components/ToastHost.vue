<script setup lang="ts">
const { toasts, dismiss } = useToast()
</script>

<template>
  <div class="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-4 pt-[max(1rem,env(safe-area-inset-top))]" aria-live="polite">
    <div
      v-for="t in toasts"
      :key="t.id"
      :role="t.kind === 'error' ? 'alert' : 'status'"
      class="glass-strong pointer-events-auto flex !bg-[rgb(var(--glass-solid)/0.96)] w-full max-w-sm items-start gap-3 rounded-2xl px-4 py-3 text-sm font-medium"
      :class="{ 'text-danger': t.kind === 'error', 'text-success': t.kind === 'success', 'text-ink': t.kind === 'info' }"
      style="animation: rise-in 0.4s var(--ease) both"
    >
      <span class="flex-1">{{ t.message }}</span>
      <button type="button" class="-my-1 -mr-2 grid h-8 w-8 place-items-center rounded-full hover:bg-ink/10" aria-label="Dismiss notification" @click="dismiss(t.id)">
        <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>
  </div>
</template>
