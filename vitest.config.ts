import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // a project does not inherit this file, so each sets the `@parlajs/source` condition it needs
    projects: [
      'packages/core/vitest.config.ts',
      'packages/format-icu/vitest.config.ts',
      'packages/format-mf2/vitest.config.ts',
      'packages/compiler/vitest.config.ts',
      'packages/react/vitest.config.ts',
      'packages/x18n-plugin/vitest.config.ts',
    ],
  },
});
