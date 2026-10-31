<script setup lang="ts">
import type { SaveState } from '~/stores/today'

const props = defineProps<{ state: SaveState, error: string, pending: number }>()
const emit = defineEmits<{ retry: [], reauth: [] }>()

// The offline queue is read from localStorage before hydration finishes, so the server markup
// (always empty) must be rendered first and the real state applied after mount.
const mounted = ref(false)
onMounted(() => { mounted.value = true })
const state = computed(() => (mounted.value ? props.state : 'idle'))
const pending = computed(() => (mounted.value ? props.pending : 0))

const label = computed(() => {
  const n = pending.value
  const changes = `${n} ${n === 1 ? 'change' : 'changes'}`
  switch (state.value) {
    case 'saved': return 'Synced'
    case 'pending': return `${changes} pending`
    case 'saving': return `Syncing ${changes}…`
    case 'offline': return `Offline · ${changes} pending`
    case 'error': return `Not synced · ${changes} pending`
    case 'auth': return `Signed out · ${changes} pending`
    default: return 'All changes saved'
  }
})
const warn = computed(() => state.value === 'error' || state.value === 'auth')
</script>

<template>
  <div class="inline-flex items-center gap-2 text-sm font-medium" role="status" aria-live="polite">
    <span
      class="h-2.5 w-2.5 rounded-full transition-colors"
      :class="{
        'bg-muted/50': state === 'idle',
        'bg-accent': state === 'pending' || state === 'offline',
        'animate-pulse bg-accent': state === 'saving',
        'bg-success': state === 'saved',
        'bg-danger': warn,
      }"
      aria-hidden="true"
    />
    <span :class="warn ? 'text-danger' : 'text-muted'">{{ label }}</span>
    <button v-if="state === 'error'" type="button" class="min-h-[44px] px-2 font-semibold text-accent underline" :title="error" @click="emit('retry')">
      Retry
    </button>
    <button v-if="state === 'auth'" type="button" class="min-h-[44px] px-2 font-semibold text-accent underline" @click="emit('reauth')">
      Sign in
    </button>
  </div>
</template>
