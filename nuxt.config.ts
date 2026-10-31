export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: false },
  modules: ['@nuxtjs/tailwindcss', '@pinia/nuxt', '@nuxt/eslint', 'nuxt-auth-utils', '@vite-pwa/nuxt'],
  css: ['~/assets/css/main.css'],
  tailwindcss: { cssPath: false },
  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      title: 'Daily Agenda',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'color-scheme', content: 'light dark' },
        { key: 'theme-color-light', name: 'theme-color', media: '(prefers-color-scheme: light)', content: '#4f46e5' },
        { key: 'theme-color-dark', name: 'theme-color', media: '(prefers-color-scheme: dark)', content: '#080b16' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-title', content: 'Daily Agenda' },
      ],
      link: [
        { rel: 'icon', type: 'image/png', href: '/favicon.png' },
        { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' },
      ],
    },
  },
  nitro: { preset: 'vercel' },
  pwa: {
    strategies: 'injectManifest',
    srcDir: 'service-worker',
    filename: 'sw.ts',
    registerType: 'prompt',
    manifest: {
      name: 'Daily Agenda',
      short_name: 'Agenda',
      description: 'Plan your day, track your schedule and reflect each evening.',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#080b16',
      theme_color: '#4f46e5',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    injectManifest: {
      globPatterns: ['**/*.{js,css,png,svg,ico,webmanifest,woff2}', 'offline.html', '_nuxt/builds/meta/*.json'],
      // vite-pwa adds manifest.webmanifest itself; a second entry makes the worker's install fail.
      globIgnores: ['sw.js', 'manifest.webmanifest'],
      // vite-pwa 'cleans' offline.html to 'offline'; keep the real path so it can be fetched on Vercel too.
      manifestTransforms: [
        async entries => ({ manifest: entries.map(e => (e.url === 'offline' ? { ...e, url: 'offline.html' } : e)), warnings: [] }),
      ],
    },
    client: { installPrompt: true },
    devOptions: { enabled: false },
  },
})
