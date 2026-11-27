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

## Why

- **One way to do each thing**: `load` a list of namespaces, get `t`; every message is a typed function.
- **Typed loading**: `t` exists only once its namespaces load, and has only those.
- **Namespaces are imports**: the bundler ships what the app imports, and the types match.
- **Lazy per locale**: one chunk per _locale × namespace_, loaded with `import()`.
- **No flash on switch**: `setLocale` loads first, then switches.
- **ICU and MF2**, per namespace, through one data model.
- **Monorepos**: each namespace has one owner package, which other packages import from.

## Packages

| Package               |                                                          |
| --------------------- | -------------------------------------------------------- |
| `@parlajs/core`       | Runtime: locale state, lazy loading, `Intl`              |
| `@parlajs/react`      | `ParlaProvider`, `useParla`, `useLocale`                 |
| `@parlajs/compiler`   | `parla` CLI and Vite plugin: catalogs → typed namespaces |
| `@parlajs/format-icu` | ICU parser                                               |
| `@parlajs/format-mf2` | MF2 parser                                               |

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

## Loading

Each namespace compiles to `<outDir>/namespaces/<name>.js`. Import it, and pass a list; `t` is
keyed by name:

```tsx
import { checkout } from './parla/namespaces/checkout.js';
import { common } from './parla/namespaces/common.js';

const t = await parla.load([checkout, common]); // anywhere: a route loader, the server
const { t } = useParla([checkout, common]); // in a component: suspends until loaded
```

Loaded namespaces never suspend, so load in a route loader to skip the fallback. A child names
what it reads, and a parent's wider `t` satisfies it:

```tsx
function Total({ t }: { t: Translations<typeof checkout> }) {
  return <p>{t.checkout.total({ amount: 39.8 })}</p>;
}
```

`useLocale()` returns `{ locale, locales, setLocale }`. To load by name from data, keep a map:
`{ checkout, common }[name]`.

## Monorepos and polyrepos

One package owns each namespace and builds it; every other package imports its built objects.
Usually one package owns them all, with `parla.config.ts` and `locales/` beside its `package.json`:

```json
{
  "name": "@acme/i18n",
  "exports": {
    "./catalog.js": "./src/parla/catalog.js",
    "./namespaces/*": "./src/parla/namespaces/*"
  }
}
```

An app then builds nothing; `parla({ root: '../../packages/i18n' })` in its `vite.config.ts`
rebuilds the owner on every catalog change:

```ts
import { catalog } from '@acme/i18n/catalog.js';
import { checkout } from '@acme/i18n/namespaces/checkout.js';

const parla = createParla({ catalog });
```

- Import each namespace from its own module: the bundler then ships exactly those chunks, and
  type-checks only those `.d.ts`.
- The owner's catalog carries its locales, functions and markup, so `createParla` asks for each.
  An app that owns namespaces too builds its own catalog: declare the owner's functions and markup
  in its config as well.
- Outside Vite, build the owner first (`dependsOn: ['^build']`).
- The owner fixes locales and fallbacks: an app may have fewer locales, not more. A namespace
  built without one of the app's locales fails in types and at its first `load`.
- A second object with the same name, such as from a second copy of the owner, is skipped with a
  warning.
- A published owner ships its `outDir` and peers on `@parlajs/react` or `@parlajs/core`.

## CLI

```
parla build [--watch]   catalog.js, namespaces/, messages/
parla check [--json]    validate; exit 1 on errors
            [--strict]  warnings fail too
```

## Message features

|              | ICU                                       | MF2                                                     |
| ------------ | ----------------------------------------- | ------------------------------------------------------- |
| Placeholders | `{name}`                                  | `{$name}`                                               |
| Plural       | `{n, plural, =0 {…} one {# …} other {…}}` | `.input {$n :number}` `.match $n`                       |
| Ordinal      | `selectordinal`                           | `:number select=ordinal`                                |
| Select       | `{g, select, …}`                          | `:string`, multiple selectors                           |
| Numbers      | `number`, `::currency/EUR`, `percent`     | `:number`, `:integer`, `:currency`, `:percent`, `:unit` |
| Dates        | `date`, `time`                            | `:date`, `:time`, `:datetime`                           |
| Rich text    | `<link>…</link>`                          | `{#link}…{/link}`, `{#br/}`                             |

A select's params are typed per branch: `{ context: 'part_one' }` needs only what that branch
reads, and any other value needs the `other` branch's.

Formatting uses `Intl`: no locale data to ship.

## Development

```sh
pnpm install && pnpm build && pnpm test
pnpm pack:all   # tarballs in .packs/
```

Working example: [parla-playground](https://github.com/marcalexiei/parla-playground).

## License

[MIT](./LICENSE)
