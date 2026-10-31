<script setup lang="ts">
const props = withDefaults(defineProps<{
  label: string
  type?: string
  error?: string
  hint?: string
  autocomplete?: string
  required?: boolean
  id?: string
}>(), { type: 'text', error: undefined, hint: undefined, autocomplete: undefined, required: false, id: undefined })

const model = defineModel<string>({ default: '' })
const uid = useId()
const inputId = computed(() => props.id ?? `input-${uid}`)
const describedBy = computed(() => [props.error && `${inputId.value}-error`, props.hint && `${inputId.value}-hint`].filter(Boolean).join(' ') || undefined)
</script>

<template>
  <div>
    <label :for="inputId" class="mb-1.5 block text-sm font-medium text-ink">{{ label }}</label>
    <input
      :id="inputId"
      v-model="model"
      :type="type"
      :autocomplete="autocomplete"
      :required="required"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="describedBy"
      class="glass-strong min-h-[44px] w-full rounded-xl px-4 text-base text-ink placeholder:text-muted"
      :class="error ? '!border-danger' : ''"
    >
    <p v-if="hint && !error" :id="`${inputId}-hint`" class="mt-1.5 text-sm text-muted">{{ hint }}</p>
    <p v-if="error" :id="`${inputId}-error`" role="alert" class="mt-1.5 text-sm font-medium text-danger">{{ error }}</p>
  </div>
</template>
