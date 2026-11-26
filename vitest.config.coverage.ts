import { defineConfig, mergeConfig } from 'vitest/config';

import root from './vitest.config.ts';

export default mergeConfig(
  root,
  defineConfig({
    test: {
      coverage: {
        enabled: true,
        // every source file, so one no test imports counts as uncovered rather than unseen
        include: ['packages/*/src/**/*.{ts,tsx}'],
        // runs only as a process
        exclude: ['packages/compiler/src/cli.ts'],
        // floors just under what each package reaches, so a drop fails CI
        thresholds: {
          'packages/core/src/**': { lines: 98, statements: 98, functions: 100, branches: 93 },
          'packages/react/src/**': { lines: 100, statements: 100, functions: 100, branches: 90 },
          'packages/compiler/src/**': { lines: 82, statements: 82, functions: 82, branches: 70 },
          'packages/format-icu/src/**': { lines: 91, statements: 91, functions: 100, branches: 80 },
          'packages/format-mf2/src/**': { lines: 91, statements: 91, functions: 100, branches: 50 },
        },
      },
    },
  }),
);
