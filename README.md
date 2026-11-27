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

```sh
pnpm add @parlajs/react && pnpm add -D @parlajs/compiler
```

- [Documentation](https://marcalexiei.github.io/parla/)
- [Getting started](https://marcalexiei.github.io/parla/getting-started)
- [Why Parla](https://marcalexiei.github.io/parla/why)
- [Playground](https://github.com/marcalexiei/parla-playground)
- [Benchmarks](https://github.com/marcalexiei/parla-benchmark)

Parla is built with the help of AI coding tools.

## License

[MIT](./LICENSE)
