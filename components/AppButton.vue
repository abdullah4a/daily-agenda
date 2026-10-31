<script setup lang="ts">
const props = withDefaults(defineProps<{
  variant?: 'primary' | 'glass' | 'ghost' | 'danger'
  type?: 'button' | 'submit' | 'reset'
  loading?: boolean
  disabled?: boolean
  block?: boolean
  to?: string
}>(), { variant: 'primary', type: 'button', loading: false, disabled: false, block: false, to: undefined })

const classes = computed(() => [
  'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-5 text-[0.95rem] font-semibold',
  'transition duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60',
  props.block && 'w-full',
  {
    primary: 'bg-accent text-accent-ink shadow-lg shadow-accent/30 hover:brightness-110',
    glass: 'glass text-ink hover:brightness-105',
    ghost: 'text-ink hover:bg-ink/10',
    danger: 'bg-danger text-accent-ink hover:brightness-110',
  }[props.variant],
])
</script>

<template>
  <NuxtLink v-if="to" :to="to" :class="classes">
    <slot />
  </NuxtLink>
  <button v-else :type="type" :class="classes" :disabled="disabled || loading" :aria-busy="loading || undefined">
    <svg v-if="loading" class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
    </svg>
    <slot />
  </button>
</template>
