# @parlajs/react

React bindings for [Parla](https://github.com/marcalexiei/parla). Re-exports
[`@parlajs/core`](../core), with rich text as React nodes. Requires React 19.

```tsx
import { createParla, ParlaProvider, useLocale, useParla } from '@parlajs/react';

import { catalog } from './parla/catalog.js'; // written by `parla build`

const parla = createParla({ catalog });

function Cart({ count }: { count: number }) {
  const { t } = useParla(['checkout']); // suspends until loaded
  const { locale, locales, setLocale } = useLocale();
  return (
    <>
      <p>{t.checkout.cart.items({ count })}</p>
      <p>{t.checkout.terms({ link: (c) => <a href="/terms">{c}</a> })}</p>
      {locales.map((l) => (
        <button key={l} disabled={l === locale} onClick={() => setLocale(l).catch(reportError)}>
          {l}
        </button>
      ))}
    </>
  );
}

createRoot(root).render(
  <ParlaProvider parla={parla}>
    <Suspense fallback={null}>
      <Cart count={3} />
    </Suspense>
  </ParlaProvider>,
);
```

- `useParla(['a', 'b'])` returns `{ t }`, keyed by namespace. Loaded namespaces never suspend:
  `await parla.load([...])` in a route loader to skip the fallback.
- A locale switch never suspends: `setLocale` loads first. If a download fails, it rejects and
  keeps the current locale: handle it (`.catch`), or it is an unhandled rejection.
- A failed download reaches the nearest error boundary.

## License

[MIT](./LICENSE)
