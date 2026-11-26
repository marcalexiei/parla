# @parlajs/compiler

The `parla` CLI and Vite plugin of [Parla](https://github.com/marcalexiei/parla). It compiles
catalogs into one JS chunk per locale × namespace, a `catalog.js` that loads them with `import()`,
and a `catalog.d.ts` that types every message.

## Vite

```ts
import { parla } from '@parlajs/compiler/vite';

export default defineConfig({ plugins: [parla(), react()] });
```

It builds on start, rebuilds when a catalog changes, and fails a production build on catalog errors.

## CLI

```
parla build [--watch]   chunks + catalog.js + catalog.d.ts
parla types             catalog.d.ts only (workspace packages)
parla check [--json]    validate without writing; exit 1 on errors
            [--strict]  warnings fail too
```

## Config

`parla.config.json`, or a `parla` field in `package.json`:

```json
{
  "locales": ["en", "it", "de"],
  "sourceLocale": "en",
  "fallbacks": { "de": ["en"] },
  "outDir": "src/parla",
  "namespaces": {
    "checkout": { "format": "mf2", "path": "locales/{locale}/checkout.json" }
  },
  "packages": ["@acme/ui"]
}
```

`packages` pulls in namespaces owned by workspace packages; each namespace has one owner.
`runtime` sets the module the generated types augment (default: `@parlajs/react` if the package
depends on it, else `@parlajs/core`).

## License

[MIT](./LICENSE)
