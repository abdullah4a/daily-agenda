import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Each file has its own database, so files can overlap; that is what keeps a remote run short.
    maxWorkers: 4,
    // Remote MongoDB calls can stall for seconds. A test that times out is abandoned with its requests
    // still running, and they then fail against the closed client, so these must outlast a slow call.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    teardownTimeout: 60_000,
    env: { MONGODB_SELECTION_TIMEOUT_MS: '30000' },
  },
})
