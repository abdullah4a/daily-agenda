<script setup lang="ts">
const { $pwa } = useNuxtApp()
const DISMISS_KEY = 'da-install-dismissed'
const dismissed = ref(true) // hidden until storage has been read on the client
const iosHint = ref(false) // iOS has no install event: people have to be told where the option is

onMounted(() => {
  iosHint.value = isIos() && !isStandalone()
  try {
    dismissed.value = localStorage.getItem(DISMISS_KEY) === '1'
  }
  catch {
    dismissed.value = false
  }
})

const canInstall = computed(() => !!$pwa?.showInstallPrompt && !$pwa?.isPWAInstalled)
const visible = computed(() => !dismissed.value && (canInstall.value || iosHint.value))

function dismiss() {
  dismissed.value = true
  try { localStorage.setItem(DISMISS_KEY, '1') }
  catch { /* storage unavailable */ }
}
async function install() {
  await $pwa?.install()
  dismiss()
}
</script>

<template>
  <Transition name="install-rise">
    <section v-if="visible" class="glass-strong pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-glass p-4" aria-label="Install Daily Agenda">
      <img src="/icons/icon-192.png" alt="" width="44" height="44" class="h-11 w-11 shrink-0 rounded-xl">
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold">Install Daily Agenda</p>
        <p v-if="canInstall" class="text-xs text-muted">Add it to your home screen for quick, offline-ready access.</p>
        <p v-else class="text-xs text-muted">Tap Share, then Add to Home Screen.</p>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <button type="button" class="rounded-xl px-3 py-2 text-sm font-medium text-muted hover:bg-ink/10" @click="dismiss">Not now</button>
        <button v-if="canInstall" type="button" class="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-ink" @click="install">Install</button>
      </div>
    </section>
  </Transition>
</template>

<style scoped>
.install-rise-enter-active, .install-rise-leave-active { transition: opacity 0.35s var(--ease), transform 0.35s var(--ease); }
.install-rise-enter-from, .install-rise-leave-to { opacity: 0; transform: translateY(1rem); }
@media (prefers-reduced-motion: reduce) {
  .install-rise-enter-active, .install-rise-leave-active { transition: none; }
}
</style>
