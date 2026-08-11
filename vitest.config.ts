import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Proof-free circuit simulation is still hash-heavy at depth 8.
    testTimeout: 60_000,
  },
});
