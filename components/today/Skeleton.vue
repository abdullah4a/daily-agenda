<template>
  <div class="grid gap-4 sm:grid-cols-2" aria-busy="true" aria-label="Loading your questions">
    <div v-for="i in 2" :key="i" class="glass animate-pulse space-y-4 rounded-glass p-5 sm:p-6">
      <div class="h-3 w-24 rounded bg-ink/15" />
      <div class="h-6 w-3/4 rounded bg-ink/20" />
      <div class="h-36 rounded-xl bg-ink/10" />
    </div>
  </div>
</template>
