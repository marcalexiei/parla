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
          'packages/core/src/**': { lines: 99, statements: 99, functions: 100, branches: 97 },
          'packages/react/src/**': { lines: 100, statements: 100, functions: 100, branches: 100 },
          'packages/compiler/src/**': { lines: 96, statements: 96, functions: 97, branches: 85 },
          'packages/format-icu/src/**': { lines: 91, statements: 91, functions: 100, branches: 80 },
          'packages/x18n/src/**': { lines: 94, statements: 94, functions: 100, branches: 89 },
          'packages/format-mf2/src/**': {
            lines: 100,
            statements: 100,
            functions: 100,
            branches: 100,
          },
        },
      },
    },
  }),
);
