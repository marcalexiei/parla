<p align="center">
  <img src="./logo/parla-lockup.svg" alt="Parla" width="320">
</p>

<p align="center">Type-safe i18n with one accessor API, per-locale lazy loading, ICU and MessageFormat 2.</p>

> **Status:** experimental (`0.0.0`). APIs will change; nothing is published to npm yet.

```tsx
const t = useT('checkout');

t.title();                     // "Checkout"
t.cart.items({ count: 3 });    // "3 items"       — count: number, required
t.terms({ link: (c) => <a href="/terms">{c}</a> });
```

## Why

- **One API.** Every message is a typed function on an accessor. No string keys, no second way to do it.
- **Only what's needed is downloaded.** Catalogs compile to one chunk per *locale × namespace*, loaded with `import()`. A German user never downloads French.
- **Switch locale without a flash.** `setLocale` loads the namespaces in use first, then switches.
- **ICU and MessageFormat 2.** Pick per namespace. Both compile through the MF2 data model, so types, rich text and runtime behave the same.
- **Built for monorepos.** Each namespace has one owner package; apps compose them.
- **Framework-agnostic core.** `@parlajs/react` today; other adapters build on the same core.

## Packages

| Package | |
|---|---|
| `@parlajs/core` | Runtime: locale state, lazy loading, `Intl` formatting, type registry |
| `@parlajs/react` | `ParlaProvider`, `useT`, `useLocale`; re-exports the core |
| `@parlajs/compiler` | `parla` CLI and Vite plugin: catalogs → chunks + `.d.ts` |
| `@parlajs/format-icu` | ICU MessageFormat parser (via `messageformat`) |
| `@parlajs/format-mf2` | MessageFormat 2 parser (via `messageformat`) |

## Quick start (React + Vite)

**1. Catalogs:** `locales/{locale}/{namespace}.json`, nested keys allowed.

```jsonc
// locales/en/checkout.json  (mf2)
{
  "title": "Checkout",
  "cart": { "items": ".input {$count :number}\n.match $count\none {{{$count} item}}\n* {{{$count} items}}" },
  "terms": "Accept the {#link}terms{/link}"
}
```

**2. Config:** `parla.config.json` next to your `package.json`.

```json
{
  "locales": ["en", "it", "de"],
  "sourceLocale": "en",
  "fallbacks": { "de": ["en"] },
  "outDir": "src/parla",
  "namespaces": {
    "checkout": { "format": "mf2", "path": "locales/{locale}/checkout.json" },
    "account": { "format": "icu", "path": "locales/{locale}/account.json" }
  }
}
```

**3. Vite plugin:** builds on start and on every catalog change.

```ts
import { parla } from '@parlajs/compiler/vite';

export default defineConfig({ plugins: [parla(), react()] });
```

**4. App**

```tsx
import { createParla, matchLocale, ParlaProvider, useLocale, useT } from '@parlajs/react';
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

`useT(namespace)` suspends until that namespace's chunk for the current locale is loaded.

## Monorepos

A package declares the namespaces it owns in its `package.json`:

```json
{
  "name": "@acme/ui",
  "parla": {
    "namespaces": { "common": { "format": "icu", "path": "locales/{locale}/common.json" } }
  }
}
```

The app lists the packages it uses, and the compiler pulls their catalogs in:

```json
{ "packages": ["@acme/ui"] }
```

Two packages owning the same namespace is a build error. Inside a package, `parla types` writes only the `.d.ts`, so the package type-checks on its own.

## CLI

```
parla build [--watch]   chunks + catalog.js + catalog.d.ts
parla types             catalog.d.ts only (workspace packages)
parla check [--json]    validate without writing; exit 1 on errors
            [--strict]  warnings fail too
```

Checks: invalid syntax, unknown functions, missing files and translations (filled from the fallback chain at build time), keys not in the source locale, params or markup the source message doesn't have, and key conflicts.

## Supported message features

| | ICU | MF2 |
|---|---|---|
| Placeholders | `{name}` | `{$name}` |
| Plural, exact match, offset | `{n, plural, =0 {…} one {# …} other {…}}` | `.input {$n :number}` `.match $n` |
| Ordinal | `selectordinal` | `:number select=ordinal` |
| Select | `{g, select, …}` | `:string` selector, multiple selectors |
| Numbers | `number`, `::currency/EUR`, `percent` | `:number`, `:integer`, `:currency`, `:percent`, `:unit` |
| Dates | `date`, `time` | `:date`, `:time`, `:datetime` |
| Rich text | `<link>…</link>` | `{#link}…{/link}`, `{#br/}` |

Formatting uses `Intl`, so there's no locale data to ship.

## Development

```sh
pnpm install
pnpm build
pnpm test
pnpm pack:all   # tarballs in .packs/, for trying Parla in another project
```

See [parla-playground](https://github.com/marcalexiei/parla-playground) for a working monorepo.

## License

[MIT](./LICENSE)
