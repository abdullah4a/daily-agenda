<script setup lang="ts">
import type { ScheduleBlockData } from '~/utils/schedule'

const props = defineProps<{ block: ScheduleBlockData | null, isNew: boolean, others: ScheduleBlockData[], saving: boolean, error: string }>()
const open = defineModel<boolean>({ default: false })
const emit = defineEmits<{ save: [block: ScheduleBlockData], remove: [id: string] }>()

const draft = reactive<ScheduleBlockData>({ id: '', label: '', start: '09:00', end: '10:00', productive: false })
const submitted = ref(false)
const confirmRemove = ref(false)

watch(() => [open.value, props.block] as const, ([isOpen, block]) => {
  if (isOpen && block) {
    Object.assign(draft, block)
    submitted.value = false
    confirmRemove.value = false
  }
}, { immediate: true })

const fieldErrors = computed(() => (submitted.value ? checkBlockFields(draft) : { label: '', start: '', end: '' }))
const scheduleIssues = computed(() => {
  const f = checkBlockFields(draft)
  if (f.label || f.start || f.end) return []
  return blockConflicts({ ...draft }, props.others)
})
const duration = computed(() => (isValidClock(draft.start) && isValidClock(draft.end) && draft.start !== draft.end
  ? scheduleDuration(blockDuration(draft)) + (blockIsOvernight(draft) ? ' · overnight' : '')
  : ''))

function submit() {
  submitted.value = true
  const f = checkBlockFields(draft)
  if (f.label || f.start || f.end || scheduleIssues.value.length) return
  emit('save', { ...draft, label: draft.label.trim() })
}
function remove() {
  emit('remove', draft.id)
}
</script>

<template>
  <AppModal v-model="open" :title="isNew ? 'Add a block' : 'Edit block'">
    <form class="space-y-4" novalidate @submit.prevent="submit">
      <AppInput v-model="draft.label" label="Name" autocomplete="off" required :error="fieldErrors.label" />
      <div class="grid grid-cols-2 gap-3">
        <AppInput v-model="draft.start" label="Starts" type="time" required :error="fieldErrors.start" />
        <AppInput v-model="draft.end" label="Ends" type="time" required :error="fieldErrors.end" />
      </div>
      <p v-if="duration" class="-mt-2 text-sm text-muted">{{ duration }}</p>

      <label class="glass flex min-h-[56px] cursor-pointer items-center justify-between gap-4 rounded-xl px-4 py-3">
        <span>
          <span class="block text-sm font-semibold">Productive time</span>
          <span class="block text-sm text-muted">Counts toward your productive hours.</span>
        </span>
        <input v-model="draft.productive" type="checkbox" role="switch" class="sr-only">
        <span class="switch relative h-7 w-12 shrink-0 rounded-full transition" aria-hidden="true" />
      </label>

      <ul v-if="submitted && scheduleIssues.length" role="alert" class="space-y-1 rounded-xl bg-danger/10 px-4 py-3 text-sm font-medium text-danger">
        <li v-for="issue in scheduleIssues" :key="issue">{{ issue }}</li>
      </ul>

      <p v-if="error" role="alert" class="rounded-xl bg-danger/10 px-4 py-3 text-sm font-medium text-danger">{{ error }}</p>

      <div class="flex flex-col gap-2 pt-2 sm:flex-row-reverse">
        <AppButton type="submit" block :loading="saving">{{ isNew ? 'Add block' : 'Save' }}</AppButton>
        <AppButton v-if="!isNew && !confirmRemove" variant="ghost" block @click="confirmRemove = true">Remove</AppButton>
        <AppButton v-if="confirmRemove" variant="danger" block :loading="saving" @click="remove">Yes, remove it</AppButton>
      </div>
    </form>
  </AppModal>
</template>

<style scoped>
.switch { background: rgb(var(--ink) / 0.22); }
.switch::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  height: 22px;
  width: 22px;
  border-radius: 9999px;
  background: rgb(var(--glass-solid));
  box-shadow: 0 2px 6px rgb(0 0 0 / 0.3);
  transition: transform 0.25s var(--ease);
}
input:checked + .switch { background: rgb(var(--accent)); }
input:checked + .switch::after { transform: translateX(20px); }
input:focus-visible + .switch { outline: 3px solid rgb(var(--accent)); outline-offset: 2px; }
</style>
