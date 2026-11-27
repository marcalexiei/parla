# @parlajs/x18n

[Parla](https://github.com/marcalexiei/parla)'s plugin for [x18n](https://x18n.dev): it reads each
catalog under the namespace its `parla.config.ts` gives it, finds every `t.ns.key()` on a `t` from
`useParla([ns])`, and reads params and markup with Parla's own ICU and MF2 parsers.

```ts
import { parla } from '@parlajs/x18n';
import { defineConfig } from '@x18n/cli';

export default defineConfig({
  sourceLocale: 'en',
  locales: ['en', 'it'],
  // Parla's keys are dotted paths inside a namespace.
  namespace: { separator: ':' },
  plugins: [parla()],
  usage: { include: ['src/**/*.{ts,tsx}'], exclude: ['src/parla/**'] },
});
```

| Option    | Default                    |                                                         |
| --------- | -------------------------- | ------------------------------------------------------- |
| `callees` | `['useParla']`             | Hooks that take a list of namespaces and return `{ t }` |
| `configs` | every `**/parla.config.ts` | Configs to read, relative to x18n's root                |

A namespace counts only when imported from its `namespaces/{ns}.js`, as Parla writes it.
