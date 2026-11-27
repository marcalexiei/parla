import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    include: ['./tests/*.spec.ts'],
  },
  /*
   * Read sibling packages' TypeScript rather than their build, so a stale `build/` cannot
   * pass or fail a test. Vitest resolves through the ssr graph, hence both.
   * Keep the condition in sync with `tsconfig.base.json#customConditions`.
   */
  resolve: {
    conditions: ['@parlajs/source'],
  },
  ssr: {
    resolve: {
      conditions: ['@parlajs/source'],
    },
  },
});
