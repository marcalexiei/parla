# @parlajs/react

React bindings for [Parla](https://github.com/marcalexiei/parla). Re-exports
[`@parlajs/core`](../core), with rich text rendered as React nodes.

```tsx
import { createParla, ParlaProvider, useLocale, useT } from '@parlajs/react';

import { catalog } from './parla/catalog.js'; // written by `parla build`

const parla = createParla({ catalog });

function Cart({ count }: { count: number }) {
  const t = useT('checkout'); // suspends until the chunk for the current locale loads
  const [locale, setLocale] = useLocale();
  return (
    <>
      <p>{t.cart.items({ count })}</p>
      <p>{t.terms({ link: (children) => <a href="/terms">{children}</a> })}</p>
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

Requires React 19.

## License

[MIT](./LICENSE)
