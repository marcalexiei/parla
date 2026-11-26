import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (pkg: string) => fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@parlajs/core': src('core'),
      '@parlajs/format-icu': src('format-icu'),
      '@parlajs/format-mf2': src('format-mf2'),
      '@parlajs/react': src('react'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.{ts,tsx}'],
  },
});
