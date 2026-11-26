# @parlajs/core

[Parla](https://github.com/marcalexiei/parla)'s framework-agnostic runtime. Apps usually use it
through an adapter such as [`@parlajs/react`](../react), which re-exports it.

```ts
import { createParla, matchLocale } from '@parlajs/core';

import { catalog } from './parla/catalog.js'; // written by `parla build`

const parla = createParla({
  catalog,
  locale: matchLocale(navigator.languages, catalog.locales, catalog.sourceLocale),
});

const t = await parla.load(['checkout']);
t.checkout.cart.items({ count: 3 }); // "3 items"

await parla.setLocale('it'); // loads what's loaded so far, then switches
```

| API                         |                                                                      |
| --------------------------- | -------------------------------------------------------------------- |
| `parla.load(ns[])`          | `t` keyed by namespace; the same list, the same promise              |
| `parla.setLocale(locale)`   | Loads first, then notifies; rejects, unswitched, if a download fails |
| `parla.subscribe(listener)` | Called after each switch                                             |
| `Translations<'a' \| 'b'>`  | The type of `t` for those namespaces                                 |
| `matchLocale(req, sup, fb)` | Best supported locale from a preference list                         |

`createParla` also takes `functions` and `markup`, required with every name the config's
`functions` and `markup` declare:

```ts
createParla({
  catalog,
  functions: { capitalize: (value, options, locale) => String(value).toLocaleUpperCase(locale) },
  markup: { strong: (children) => `**${children}**` }, // a call's own `strong` wins
});
```

## License

[MIT](./LICENSE)
