import { defineConfig } from '@parlajs/compiler';

export default defineConfig({
  locales: ['en', 'it', 'de'],
  sourceLocale: 'en',
  outDir: 'src/parla',
  markup: ['strong'],
  namespaces: {
    home: { format: 'mf2', path: 'locales/{locale}/home.json' },
    shopIcu: { format: 'icu', path: 'locales/{locale}/shop-icu.json' },
    shopMf2: { format: 'mf2', path: 'locales/{locale}/shop-mf2.json' },
    formats: { format: 'mf2', path: 'locales/{locale}/formats.json' },
  },
});
