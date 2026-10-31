import type { NitroConfig } from 'nitropack/types'

// Nuxt leaves this extension point empty in the generated types, which rejects nitro.preset.
declare module '@nuxt/schema' {
  interface NitroTypes {
    config: NitroConfig
  }
}
