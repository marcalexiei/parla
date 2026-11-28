# @parlajs/x18n-plugin

[Parla](https://github.com/marcalexiei/parla)'s plugin for [x18n](https://x18n.dev): it reads each
catalog under the namespace its `parla.config.ts` gives it, finds every `t.ns.key()` on a `t` from
`useParla([ns])` or a `{ t }: { t: Translations<typeof ns> }` prop, and reads params and markup
with Parla's own ICU and MF2 parsers and the config's `functions` and `markup`.

```ts
import parla from '@parlajs/x18n-plugin';
import { defineConfig } from '@x18n/cli';

export default defineConfig({
  sourceLocale: 'en',
  locales: ['en', 'it'],
  // x18n then names keys `checkout:cart.items`: with its default `.`, a dotted namespace blurs into the key.
  namespace: { separator: ':' },
  plugins: [parla()],
  usage: { include: ['src/**/*.{ts,tsx}'], exclude: ['src/parla/**'] },
});
```

| Option    | Default                    |                                                         |
| --------- | -------------------------- | ------------------------------------------------------- |
| `callees` | `['useParla']`             | Hooks that take a list of namespaces and return `{ t }` |
| `configs` | every `**/parla.config.ts` | Configs to read, relative to x18n's root                |

In `.vue`, `.svelte` and `.astro` files it reads the scripts (Astro's frontmatter) and the
template's expressions, so `{t.ns.key()}` in markup counts; add them to `usage.include`.

A namespace counts only when imported from its `namespaces/{ns}.js`, as Parla writes it. A select
whose branches need different params is left to TypeScript, which checks it per branch. A catalog
that is not JSON needs an x18n format for its extension too: x18n reads and writes it.
