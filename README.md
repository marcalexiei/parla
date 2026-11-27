<p align="center">
  <img src="./.github/assets/logo.svg" alt="Parla" width="320">
</p>

<p align="center">Type-safe i18n: one API, per-locale lazy loading, ICU and MessageFormat 2.</p>

> **Status:** experimental (`0.0.0`), not on npm yet.

```tsx
import { checkout } from './parla/namespaces/checkout.js';

const { t } = useParla([checkout]);

t.checkout.title(); // "Checkout"
t.checkout.cart.items({ count: 3 }); // "3 items"; count: number, required
t.checkout.terms({ link: (c) => <a href="/terms">{c}</a> });
```

## Documentation

[marcalexiei.github.io/parla](https://marcalexiei.github.io/parla/): guides, the CLI and config reference, the core and React API,
and how Parla compares with other libraries. Live examples there run on Parla itself.

## Quick start (React + Vite)

`locales/en/checkout.json`:

```json
{
  "title": "Checkout",
  "cart": {
    "items": ".input {$count :number}\n.match $count\none {{{$count} item}}\n* {{{$count} items}}"
  },
  "terms": "Accept the {#link}terms{/link}"
}
```

`parla.config.ts`:

```ts
import { defineConfig } from '@parlajs/compiler';

export default defineConfig({
  locales: ['en', 'it', 'de'],
  sourceLocale: 'en',
  fallbacks: { de: ['en'] },
  outDir: 'src/parla',
  namespaces: { checkout: { format: 'mf2', path: 'locales/{locale}/checkout.json' } },
});
```

`vite.config.ts`: `plugins: [parla(), react()]`, with `parla` from `@parlajs/compiler/vite`.

```tsx
import { createParla, matchLocale, ParlaProvider } from '@parlajs/react';

import { catalog } from './parla/catalog.js';

const parla = createParla({
  catalog,
  locale: matchLocale(navigator.languages, catalog.locales, catalog.sourceLocale),
});

createRoot(root).render(
  <ParlaProvider parla={parla}>
    <Suspense fallback={null}>
      <App />
    </Suspense>
  </ParlaProvider>,
);
```

## Development

```sh
pnpm install && pnpm build:packages && pnpm test
pnpm site:dev   # the docs site, from site/
pnpm pack:all   # tarballs in .packs/
```

Working example: [parla-playground](https://github.com/marcalexiei/parla-playground).

Parla is built with the help of AI coding tools.

## License

[MIT](./LICENSE)
