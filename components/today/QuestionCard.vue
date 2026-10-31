<script setup lang="ts">
const props = defineProps<{
  eyebrow: string
  question: string
  placeholder: string
  active: boolean
  maxlength: number
}>()
const emit = defineEmits<{ focus: [], blur: [] }>()
const model = defineModel<string>({ default: '' })
const uid = useId()
const nearLimit = computed(() => model.value.length > props.maxlength * 0.9)
</script>

<template>
  <GlassCard
    as="section"
    :strong="active"
    class="relative flex flex-col gap-4 overflow-hidden transition duration-500"
    :class="active ? 'outline outline-2 -outline-offset-1 outline-accent' : ''"
    :aria-labelledby="`q-${uid}`"
  >
    <div v-if="active" class="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-accent/25 blur-3xl" aria-hidden="true" />
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
    <label class="sr-only" :for="`a-${uid}`">{{ question }}</label>
    <textarea
      :id="`a-${uid}`"
      v-model="model"
      :maxlength="maxlength"
      :placeholder="placeholder"
      rows="5"
      class="glass relative min-h-[9rem] w-full resize-y rounded-xl p-4 text-base leading-relaxed text-ink placeholder:text-muted"
      style="field-sizing: content"
      @focus="emit('focus')"
      @blur="emit('blur')"
    />
    <p v-if="nearLimit" class="relative -mt-2 text-right text-xs text-muted" aria-live="polite">
      {{ model.length }} / {{ maxlength }}
    </p>
  </GlassCard>
</template>
