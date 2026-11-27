<p align="center">
  <img src="./.github/assets/logo.svg" alt="Parla" width="320">
</p>

<p align="center">Type-safe i18n: one API, per-locale lazy loading, ICU and MessageFormat 2.</p>

> **Status:** experimental (`0.0.0`), not on npm yet.

```tsx
const { t } = useParla(['checkout']);

t.checkout.title(); // "Checkout"
t.checkout.cart.items({ count: 3 }); // "3 items"; count: number, required
t.checkout.terms({ link: (c) => <a href="/terms">{c}</a> });
```

## Why

- **One way to do each thing**: `load` a list of namespaces, get `t`; every message is a typed function.
- **Typed loading**: `t` exists only once its namespaces load, and has only those.
- **Lazy per locale**: one chunk per _locale × namespace_, loaded with `import()`.
- **No flash on switch**: `setLocale` loads first, then switches.
- **ICU and MF2**, per namespace, through one data model.
- **Monorepos**: each namespace has one owner package.

## Packages

| Package               |                                                            |
| --------------------- | ---------------------------------------------------------- |
| `@parlajs/core`       | Runtime: locale state, lazy loading, `Intl`, type registry |
| `@parlajs/react`      | `ParlaProvider`, `useParla`, `useLocale`                   |
| `@parlajs/compiler`   | `parla` CLI and Vite plugin: catalogs → chunks + `.d.ts`   |
| `@parlajs/format-icu` | ICU parser                                                 |
| `@parlajs/format-mf2` | MF2 parser                                                 |

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

One function each, always with a list; `t` is keyed by namespace:

```tsx
const t = await parla.load(['checkout', 'common']); // anywhere: a route loader, the server
const { t } = useParla(['checkout', 'common']); // in a component: suspends until loaded
```

Loaded namespaces never suspend, so load in a route loader to skip the fallback. A child names
what it reads, and a parent's wider `t` satisfies it:

```tsx
function Total({ t }: { t: Translations<'checkout'> }) {
  return <p>{t.checkout.total({ amount: 39.8 })}</p>;
}
```

`useLocale()` returns `{ locale, locales, setLocale }`.

## Monorepos and polyrepos

A package owns namespaces in its `package.json`; the app lists it:

```json
{
  "name": "@acme/ui",
  "parla": {
    "namespaces": { "common": { "format": "icu", "path": "locales/{locale}/common.json" } }
  }
}
```

```ts
export default defineConfig({ packages: ['@acme/ui'] /* … */ });
```

`{ name: '@acme/i18n', namespaces: ['generic'] }` takes a subset; paths to one package add up.
`packages: 'dependencies'` instead walks the workspace-linked `dependencies`, collecting every
`parla` field; a package reached only that way gives all its namespaces, unless one lists a subset.

- Packages resolve through `node_modules`: workspace links and registry installs work alike.
- A package's config is data in `package.json`: Node strips no types under `node_modules`.
- `parla types` in a package writes only its `.d.ts`.
- A published package ships its catalogs (`"files": ["dist", "locales"]`) and peers on `@parlajs/react`.
- Two owners of one namespace fail the build.

## CLI

```
parla build [--watch]   chunks + catalog.js + catalog.d.ts + types/
parla types             catalog.d.ts + types/ only
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

Formatting uses `Intl`: no locale data to ship.

## Development

```sh
pnpm install && pnpm build && pnpm test
pnpm pack:all   # tarballs in .packs/
```

Working example: [parla-playground](https://github.com/marcalexiei/parla-playground).

## License

[MIT](./LICENSE)
