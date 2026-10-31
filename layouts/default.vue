<template>
  <div>
    <div class="backdrop" aria-hidden="true" />
    <a href="#main" class="sr-only-focusable glass-strong fixed left-4 top-4 z-[70] rounded-xl px-4 py-2 font-medium">Skip to content</a>
    <AppNav />
    <header class="glass fixed inset-x-0 top-0 z-20 flex items-center justify-between px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:hidden">
      <span class="text-base font-semibold tracking-tight">Daily Agenda</span>
      <ThemeToggle />
    </header>
    <main id="main" class="dock-room mx-auto max-w-3xl px-4 pb-32 pt-24 md:ml-72 md:max-w-none md:px-8 md:pb-12 md:pt-10">
      <slot />
    </main>
  </div>
</template>
