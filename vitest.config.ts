import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Test files share the daily-agenda-test database and clean it up, so they cannot overlap.
    fileParallelism: false,
  },
})
