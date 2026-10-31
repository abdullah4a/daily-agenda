<script setup lang="ts">
const props = withDefaults(defineProps<{ title: string, size?: 'md' | 'lg' }>(), { size: 'md' })
const open = defineModel<boolean>({ default: false })
const uid = useId()
const panel = ref<HTMLElement | null>(null)
let previous: HTMLElement | null = null

function close() { open.value = false }

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') return close()
  if (e.key !== 'Tab' || !panel.value) return
  const focusable = panel.value.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])')
  if (!focusable.length) return
  const first = focusable[0]!
  const last = focusable[focusable.length - 1]!
  const active = document.activeElement
  // The panel itself holds focus on open: Shift+Tab from it must wrap, not escape.
  if (e.shiftKey && (active === first || active === panel.value)) { e.preventDefault(); last.focus() }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
}

watch(open, async (value) => {
  if (!import.meta.client) return
  if (value) {
    previous = document.activeElement as HTMLElement | null
    document.body.style.overflow = 'hidden'
    await nextTick()
    panel.value?.focus()
  }
  else {
    document.body.style.overflow = ''
    previous?.focus()
  }
})
onBeforeUnmount(() => { if (import.meta.client) document.body.style.overflow = '' })
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-end justify-center sm:items-center" @keydown="onKeydown">
      <div class="absolute inset-0 bg-black/40" style="animation: fade-in 0.2s both" aria-hidden="true" @click="close" />
      <div
        ref="panel"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="`modal-${uid}`"
        tabindex="-1"
        class="glass-strong relative max-h-[90dvh] w-full overflow-y-auto rounded-t-[1.75rem] p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:rounded-glass"
        :class="props.size === 'lg' ? 'sm:max-w-md md:max-w-2xl lg:max-w-3xl' : 'sm:max-w-md'"
        style="animation: sheet-in 0.4s var(--ease) both"
      >
        <div class="mb-4 flex items-start justify-between gap-4">
          <h2 :id="`modal-${uid}`" class="text-xl">{{ title }}</h2>
          <button type="button" class="-mr-2 -mt-1 grid h-11 w-11 place-items-center rounded-full hover:bg-ink/10" aria-label="Close dialog" @click="close">
            <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <slot />
      </div>
    </div>
  </Teleport>
</template>
