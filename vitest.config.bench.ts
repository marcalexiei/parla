import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    benchmark: { include: ['bench/*.bench.ts'] },
    // a bench sharing the CPU with another times both
    fileParallelism: false,
    testTimeout: 120_000,
  },
  resolve: { conditions: ['@parlajs/source'] },
  ssr: { resolve: { conditions: ['@parlajs/source'] } },
});
