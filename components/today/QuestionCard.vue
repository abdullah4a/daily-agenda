<script setup lang="ts">
import type { FieldStatus } from '~/stores/today'

const props = defineProps<{
  eyebrow: string
  question: string
  placeholder: string
  active: boolean
  maxlength: number
  status: FieldStatus
}>()
const emit = defineEmits<{ focus: [], blur: [], save: [], retry: [], reauth: [] }>()
const model = defineModel<string>({ default: '' })
const uid = useId()
const nearLimit = computed(() => model.value.length > props.maxlength * 0.9)

/** A saved answer is shown as text until the user asks to change it. */
const editing = ref(false)
/** Typed in since loading, so the status line has something to report. */
const touched = ref(false)
const reading = computed(() => !editing.value && !!model.value.trim())
const field = useTemplateRef<HTMLTextAreaElement>('field')

const STATUS: Record<FieldStatus, string> = {
  saved: 'Saved',
  saving: 'Saving…',
  offline: 'Kept on this device. Saves when you are back online.',
  error: 'Not saved yet. Could not reach the server.',
  auth: 'Not saved. Sign in again to save this.',
  rejected: 'Not saved. The server rejected this answer.',
}
const failed = computed(() => props.status === 'error' || props.status === 'auth' || props.status === 'rejected')

async function edit() {
  editing.value = true
  await nextTick()
  field.value?.focus()
}
function save() {
  editing.value = false
  touched.value = true
  emit('save')
}
</script>

<template>
  <GlassCard
    as="section"
    :strong="active"
    class="relative flex flex-col gap-4 overflow-hidden transition duration-500"
    :class="active ? 'outline outline-2 -outline-offset-1 outline-accent' : ''"
    :aria-labelledby="`q-${uid}`"
  >
    <header class="relative flex items-center justify-between gap-3">
      <p class="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{{ eyebrow }}</p>
      <span
        v-if="active"
        class="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-accent-ink"
      >
        <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-ink" aria-hidden="true" />
        Now
      </span>
    </header>
    <h2 :id="`q-${uid}`" class="relative text-xl leading-snug sm:text-2xl">{{ question }}</h2>

    <p v-if="reading" class="relative whitespace-pre-wrap break-words text-base leading-relaxed">{{ model }}</p>
    <template v-else>
      <label class="sr-only" :for="`a-${uid}`">{{ question }}</label>
      <textarea
        :id="`a-${uid}`"
        ref="field"
        v-model="model"
        :maxlength="maxlength"
        :placeholder="placeholder"
        rows="5"
        class="glass relative min-h-[9rem] w-full resize-y rounded-xl p-4 text-base leading-relaxed text-ink placeholder:text-muted"
        style="field-sizing: content"
        @input="touched = true"
        @focus="editing = true; emit('focus')"
        @blur="emit('blur')"
      />
      <p v-if="nearLimit" class="relative -mt-2 text-right text-xs text-muted" aria-live="polite">
        {{ model.length }} / {{ maxlength }}
      </p>
    </template>

    <div class="relative flex flex-wrap items-center justify-between gap-2">
      <p class="min-w-0 flex-1 basis-40 text-sm font-medium" role="status" aria-live="polite">
        <span v-if="reading || touched" :class="status === 'saved' ? 'text-success' : failed ? 'text-danger' : 'text-muted'">
          <template v-if="status === 'saved'">&#10003; </template>{{ STATUS[status] }}
        </span>
      </p>
      <button v-if="status === 'error'" type="button" class="min-h-[44px] px-2 text-sm font-semibold text-accent underline" @click="emit('retry')">Retry</button>
      <button v-if="status === 'auth'" type="button" class="min-h-[44px] px-2 text-sm font-semibold text-accent underline" @click="emit('reauth')">Sign in</button>
      <AppButton v-if="reading" variant="glass" @click="edit">Edit</AppButton>
      <AppButton v-else :disabled="!touched && !model.trim()" @click="save">Save</AppButton>
    </div>
  </GlassCard>
</template>
