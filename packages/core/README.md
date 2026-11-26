# @parlajs/core

The framework-agnostic runtime of [Parla](https://github.com/marcalexiei/parla): locale state,
per-locale lazy loading of compiled catalogs, `Intl` formatting and the type registry.

Most apps use it through an adapter such as [`@parlajs/react`](../react), which re-exports it.

```ts
import { createParla, matchLocale } from '@parlajs/core';

import { catalog } from './parla/catalog.js'; // written by `parla build`

const parla = createParla({
  catalog,
  locale: matchLocale(navigator.languages, catalog.locales, catalog.sourceLocale),
});

const t = await parla.load('checkout');
t.cart.items({ count: 3 }); // "3 items"

await parla.setLocale('it'); // loads every namespace in use, then switches
```

| API                         |                                                                |
| --------------------------- | -------------------------------------------------------------- |
| `createParla({ catalog })`  | One instance per app                                           |
| `parla.load(ns, locale?)`   | Loads a namespace once per locale; the same promise every call |
| `parla.getT(ns)`            | The accessor if already loaded for the current locale          |
| `parla.preload(ns[])`       | Loads ahead of render                                          |
| `parla.setLocale(locale)`   | Preloads the namespaces in use, then notifies subscribers      |
| `parla.subscribe(listener)` | For adapters; `getSnapshot()` returns `{ locale }`             |
| `matchLocale(req, sup, fb)` | Best supported locale from a preference list                   |

## License

[MIT](./LICENSE)
