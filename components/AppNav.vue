<script setup lang="ts">
const links = [
  { to: '/', label: 'Today', icon: 'M8 2v3M16 2v3M3 9h18M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z' },
  { to: '/schedule', label: 'Schedule', icon: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z' },
  { to: '/history', label: 'History', icon: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2' },
  { to: '/insights', label: 'Insights', icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2' },
  { to: '/settings', label: 'Settings', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1' },
]

const sync = useSyncStore()
const { signOut, finish, confirming, busy } = useSignOut()
</script>

<template>
  <!-- Desktop: side rail -->
  <aside class="glass fixed inset-y-4 left-4 z-30 hidden w-60 flex-col rounded-glass p-4 md:flex">
    <NuxtLink to="/" class="mb-6 px-3 pt-2 text-lg font-semibold tracking-tight">Daily Agenda</NuxtLink>
    <nav aria-label="Primary" class="flex flex-1 flex-col gap-1">
      <NuxtLink
        v-for="l in links"
        :key="l.to"
        :to="l.to"
        class="nav-link flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-[0.95rem] font-medium text-muted hover:bg-ink/10 hover:text-ink"
      >
        <svg viewBox="0 0 24 24" class="h-5 w-5 shrink-0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="l.icon" /></svg>
        {{ l.label }}
      </NuxtLink>
    </nav>
    <div class="flex flex-col gap-2">
      <ThemeToggle />
      <AppButton variant="ghost" block :loading="busy" @click="signOut">Sign out</AppButton>
    </div>
  </aside>

  <!-- Mobile: bottom glass nav -->
  <nav aria-label="Primary" class="glass-strong fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 flex rounded-[1.75rem] p-1.5 md:hidden">
    <NuxtLink
      v-for="l in links"
      :key="l.to"
      :to="l.to"
      class="nav-link flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl text-[0.7rem] font-medium text-muted"
    >
      <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="l.icon" /></svg>
      {{ l.label }}
    </NuxtLink>
  </nav>

  <AppModal v-model="confirming" title="Unsynced changes">
    <p class="text-muted">
      {{ sync.pending }} {{ sync.pending === 1 ? 'change has' : 'changes have' }} not reached the server yet.
      If you keep them, they stay on this device and sync the next time this account signs in here.
      If you discard them, they are lost.
    </p>
    <div class="mt-5 flex flex-col gap-2">
      <AppButton block @click="finish(false)">Sign out and keep on this device</AppButton>
      <AppButton variant="ghost" block @click="finish(true)">Sign out and discard</AppButton>
      <AppButton variant="ghost" block @click="confirming = false">Stay signed in</AppButton>
    </div>
  </AppModal>
</template>

<style scoped>
.nav-link.router-link-exact-active { background: rgb(var(--accent) / 0.16); color: rgb(var(--ink)); font-weight: 600; }
</style>
