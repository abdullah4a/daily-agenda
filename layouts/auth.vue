<template>
  <div class="min-h-dvh">
    <div class="backdrop" aria-hidden="true"><span /></div>
    <div class="absolute right-4 top-[max(1rem,env(safe-area-inset-top))]"><ThemeToggle /></div>
    <main class="auth-main mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 pt-16">
      <p class="rise-in mb-6 text-center text-sm font-semibold uppercase tracking-[0.2em] text-muted">Daily Agenda</p>
      <GlassCard strong class="rise-in" style="animation-delay: 0.08s">
        <slot />
      </GlassCard>
    </main>
  </div>
</template>
