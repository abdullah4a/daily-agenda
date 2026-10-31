<script setup lang="ts">
const props = withDefaults(defineProps<{
  label: string
  type?: string
  error?: string
  hint?: string
  autocomplete?: string
  required?: boolean
  id?: string
  strength?: boolean
}>(), { type: 'text', error: undefined, hint: undefined, autocomplete: undefined, required: false, id: undefined, strength: false })

const model = defineModel<string>({ default: '' })
const uid = useId()
const inputId = computed(() => props.id ?? `input-${uid}`)
const isPassword = computed(() => props.type === 'password')
const revealed = ref(false)
const capsLock = ref(false)
const inputType = computed(() => (isPassword.value && revealed.value ? 'text' : props.type))
const describedBy = computed(() => [props.error && `${inputId.value}-error`, props.hint && `${inputId.value}-hint`].filter(Boolean).join(' ') || undefined)

const strengthScore = computed(() => {
  const value = model.value
  if (value.length < 8) return 1
  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(pattern => pattern.test(value)).length
  if (value.length >= 12 && variety >= 3) return 3
  return variety >= 2 ? 2 : 1
})
const strengthLabel = computed(() => ['', 'Weak', 'Good', 'Strong'][strengthScore.value])
const strengthColor = computed(() => ['', 'bg-danger', 'bg-accent', 'bg-success'][strengthScore.value])

function trackCapsLock(event: KeyboardEvent) {
  capsLock.value = event.getModifierState?.('CapsLock') ?? false
}
</script>

<template>
  <div>
    <label :for="inputId" class="mb-1.5 block text-sm font-medium text-ink">{{ label }}</label>
    <div class="relative">
      <input
        :id="inputId"
        v-model="model"
        :type="inputType"
        :autocomplete="autocomplete"
        :required="required"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="describedBy"
        class="glass-strong min-h-[44px] w-full rounded-xl px-4 text-base text-ink placeholder:text-muted"
        :class="[error ? '!border-danger' : '', isPassword ? 'pr-16' : '']"
        @keydown="isPassword && trackCapsLock($event)"
        @keyup="isPassword && trackCapsLock($event)"
        @blur="capsLock = false"
      >
      <button
        v-if="isPassword"
        type="button"
        class="absolute inset-y-0 right-1 my-auto h-9 min-w-[44px] rounded-lg px-2 text-sm font-medium text-accent"
        :aria-pressed="revealed"
        :aria-label="revealed ? `Hide ${label}` : `Show ${label}`"
        @click="revealed = !revealed"
      >
        {{ revealed ? 'Hide' : 'Show' }}
      </button>
    </div>
    <p v-if="isPassword && capsLock" role="status" class="mt-1.5 text-sm font-medium text-ink">Caps Lock is on.</p>
    <div v-if="strength && model" class="mt-2 flex items-center gap-2" role="status">
      <div class="flex flex-1 gap-1" aria-hidden="true">
        <span v-for="level in 3" :key="level" class="h-1 flex-1 rounded-full" :class="level <= strengthScore ? strengthColor : 'bg-muted/25'" />
      </div>
      <span class="text-sm text-muted">{{ strengthLabel }}</span>
    </div>
    <p v-if="hint && !error" :id="`${inputId}-hint`" class="mt-1.5 text-sm text-muted">{{ hint }}</p>
    <p v-if="error" :id="`${inputId}-error`" role="alert" class="mt-1.5 text-sm font-medium text-danger">{{ error }}</p>
  </div>
</template>
