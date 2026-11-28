# @parlajs/core

[Parla](https://github.com/marcalexiei/parla)'s framework-agnostic runtime. Apps usually use it
through an adapter such as [`@parlajs/react`](../react), which re-exports it.

```ts
import { createParla, matchLocale } from '@parlajs/core';

import { catalog } from './parla/catalog.js'; // written by `parla build`
import { checkout } from './parla/namespaces/checkout.js';

const parla = createParla({
  catalog,
  locale: matchLocale(navigator.languages, catalog.locales, catalog.sourceLocale),
});

const t = await parla.load([checkout]);
t.checkout.cart.items({ count: 3 }); // "3 items"

await parla.setLocale('it'); // loads what's loaded so far, then switches
```

| API                         |                                                                      |
| --------------------------- | -------------------------------------------------------------------- |
| `parla.load(ns[])`          | `t` keyed by name; the same list, the same promise                   |
| `parla.loaded(ns[])`        | `t` if loaded for the current locale, else `undefined`; never loads  |
| `parla.setLocale(locale)`   | Loads first, then notifies; rejects, unswitched, if a download fails |
| `parla.subscribe(listener)` | Called after each switch                                             |
| `Translations<typeof a>`    | The type of `t` for those namespaces                                 |
| `Text`                      | A message without params or markup: `() => string`                   |
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

`timeZone` formats dates in an IANA zone instead of the host's, unless a message sets its own:
a server's zone is rarely the reader's.

Rich text is a `string` here and a `ReactNode` through `@parlajs/react`, so one namespace serves
both, e.g. emails beside the app. Another adapter passes `wrapRich` and types `Parla<Node>`.

## License

[MIT](./LICENSE)
