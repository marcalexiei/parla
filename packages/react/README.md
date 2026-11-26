# @parlajs/react

React bindings for [Parla](https://github.com/marcalexiei/parla). Re-exports
[`@parlajs/core`](../core), with rich text rendered as React nodes.

```tsx
import { createParla, ParlaProvider, useLocale, useSuspenseParla } from '@parlajs/react';

import { catalog } from './parla/catalog.js'; // written by `parla build`

const parla = createParla({ catalog });

function Cart({ count }: { count: number }) {
  const { t } = useSuspenseParla(['checkout']); // suspends until the chunk for the current locale loads
  const [locale, setLocale] = useLocale();
  return (
    <>
      <p>{t.checkout.cart.items({ count })}</p>
      <p>{t.checkout.terms({ link: (children) => <a href="/terms">{children}</a> })}</p>
      <button onClick={() => void setLocale(locale === 'en' ? 'it' : 'en')}>{locale}</button>
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

Switching locale never shows the Suspense fallback: `setLocale` loads first, then re-renders.

Both hooks take a list of namespaces, key `t` by namespace, and return `parla` alongside it:

- `useSuspenseParla(['checkout', 'common'])` suspends; `t.checkout.…`, `t.common.…`.
- `useParla(['checkout'])` never suspends: it returns `{ ready: false }` until the chunk loads, and
  `t` is typed as present only once `ready` is checked.

Requires React 19.

## License

[MIT](./LICENSE)
