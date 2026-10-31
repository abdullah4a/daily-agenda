<script setup lang="ts">
withDefaults(defineProps<{ as?: string, strong?: boolean, padded?: boolean }>(), { as: 'div', strong: false, padded: true })
</script>

<template>
  <component :is="as" class="rounded-glass" :class="[strong ? 'glass-strong' : 'glass', padded && 'p-5 sm:p-6']">
    <slot />
  </component>
</template>
