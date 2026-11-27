# @parlajs/compiler

[Parla](https://github.com/marcalexiei/parla)'s CLI and Vite plugin: catalogs → one chunk per
locale × namespace, a `catalog.js` that loads them, and a `catalog.d.ts` that types them, with
one `types/{namespace}.d.ts` per namespace.

```ts
import { parla } from '@parlajs/compiler/vite';

export default defineConfig({ plugins: [parla(), react()] }); // fails a production build on errors
```

The plugin rebuilds on every catalog change in `vite` and `vite build --watch`, namespaces added to the
config later included, so a Vite app needs no `parla build --watch`.

```
parla build [--watch]   chunks + catalog.js + catalog.d.ts + types/
parla types             catalog.d.ts + types/ only
parla check [--json]    validate; exit 1 on errors
            [--strict]  warnings fail too
```

`parla.config.ts`, loaded with Node's own TypeScript support:

```ts
import { defineConfig } from '@parlajs/compiler';

export default defineConfig({
  locales: ['en', 'it', 'de'],
  sourceLocale: 'en',
  fallbacks: { de: ['en'] },
  outDir: 'src/parla',
  namespaces: { checkout: { format: 'mf2', path: 'locales/{locale}/checkout.json' } },
  packages: ['@acme/ui'],
  functions: { capitalize: 'string' },
  markup: ['strong', 'br'],
});
```

- `packages`: workspace or installed packages whose namespaces to include; `{ name, namespaces }`
  for a subset, or `'dependencies'` to walk the workspace-linked `dependencies`.
- `functions`: message functions beyond the built-in ones, by their value's type (`string`,
  `number`, `date`); `createParla({ functions })` must implement each.
- `markup`: tags a call may leave out; `createParla({ markup })` must render each.
- `runtime`: the module the types augment; defaults to `@parlajs/react` if a dependency, else
  `@parlajs/core`.

## License

[MIT](./LICENSE)
