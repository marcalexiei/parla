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

- **Typed loading**: `t` has only the namespaces you loaded.
- **Params from the message**: plurals, selects per branch, rich text.
- **Lazy per locale**: one chunk per locale and namespace; `setLocale` loads, then switches.
- **ICU and MF2**, formatted with `Intl`: no locale data to ship.

**[Documentation](https://marcalexiei.github.io/parla/)** ·
[Playground](https://github.com/marcalexiei/parla-playground) ·
[Benchmarks](https://github.com/marcalexiei/parla-benchmark)

## Packages

|                   | Package                                        |                                         |
| ----------------- | ---------------------------------------------- | --------------------------------------- |
| Core              | [`@parlajs/core`](packages/core)               | Runtime: locale state, loading, `Intl`  |
|                   | [`@parlajs/compiler`](packages/compiler)       | CLI and Vite plugin: catalogs → modules |
| Format adapter    | [`@parlajs/format-icu`](packages/format-icu)   | ICU                                     |
|                   | [`@parlajs/format-mf2`](packages/format-mf2)   | MessageFormat 2                         |
| Framework adapter | [`@parlajs/react`](packages/react)             | `useParla`, `useParlaLoaded`            |
| Tooling           | [`@parlajs/x18n-plugin`](packages/x18n-plugin) | [x18n](https://x18n.dev) plugin         |

## Development

```sh
pnpm install && pnpm check-all
```

Parla is built with the help of AI coding tools.

## License

[MIT](./LICENSE)
