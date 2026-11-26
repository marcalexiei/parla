import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { createParla, matchLocale } from '../src/index.ts';
import type { Catalog, Loader, MessageModule } from '../src/index.ts';

interface Common {
  nav: { home: () => string };
}

interface Messages {
  [key: string]: string | Messages;
}

const accessorOf = (messages: Messages): object =>
  Object.fromEntries(
    Object.entries(messages).map(([k, v]) => [k, typeof v === 'string' ? () => v : accessorOf(v)]),
  );

// What `parla build` emits: one factory per chunk, returning the accessor tree.
const chunk = (messages: Messages): MessageModule => ({ default: () => accessorOf(messages) });

function makeCatalog(): { catalog: Catalog; calls: Array<string> } {
  const calls: Array<string> = [];
  const loader =
    (locale: string, ns: string, messages: Messages): Loader =>
    async () => {
      calls.push(`${locale}/${ns}`);
      return Promise.resolve(chunk(messages));
    };
  const catalog: Catalog = {
    locales: ['en', 'it'],
    sourceLocale: 'en',
    namespaces: {
      common: {
        en: loader('en', 'common', { nav: { home: 'Home' } }),
        it: loader('it', 'common', { nav: { home: 'Inizio' } }),
      },
      checkout: {
        en: loader('en', 'checkout', { title: 'Checkout' }),
        it: loader('it', 'checkout', { title: 'Cassa' }),
      },
    },
  };
  return { catalog, calls };
}

describe(createParla, () => {
  it('loads each namespace once and returns messages keyed by namespace', async () => {
    const { catalog, calls } = makeCatalog();
    const parla = createParla({ catalog });
    const [a, b] = await Promise.all([
      parla.load(['common', 'checkout']),
      parla.load(['checkout', 'common', 'common']),
    ]);
    // The same set of namespaces is one cached object, whatever the order.
    expect(a).toBe(b);
    expect((a['common'] as Common).nav.home()).toBe('Home');
    const single = await parla.load(['common']);
    expect(single['common']).toBe(a['common']);
    expect(calls).toStrictEqual(['en/checkout', 'en/common']);
  });

  it('loads the namespaces loaded so far before switching locale, then never suspends', async () => {
    const { catalog, calls } = makeCatalog();
    const parla = createParla({ catalog });
    await parla.load(['common']);
    const listener = vi.fn<() => void>();
    parla.subscribe(listener);
    await parla.setLocale('it');
    expect(calls).toStrictEqual(['en/common', 'it/common']);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(parla.locale).toBe('it');
    const promise = parla.load(['common']);
    expect(promise).toMatchObject({ status: 'fulfilled' });
    const t = await promise;
    expect((t['common'] as Common).nav.home()).toBe('Inizio');
  });

  it('also loads, before switching, a namespace first loaded during the switch', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { catalog } = makeCatalog();
    const italianCommon = catalog.namespaces['common']?.['it'];
    if (!italianCommon) {
      throw new Error('the fixture has an Italian `common`');
    }
    const slow: Catalog = {
      ...catalog,
      namespaces: {
        ...catalog.namespaces,
        common: {
          ...catalog.namespaces['common'],
          it: async () => {
            await held;
            return italianCommon();
          },
        },
      },
    };
    const parla = createParla({ catalog: slow });
    await parla.load(['common']);
    const switching = parla.setLocale('it');
    // a component mounting while `common` downloads for `it`
    await parla.load(['checkout']);
    release();
    await switching;
    expect(parla.locale).toBe('it');
    expect(parla.load(['checkout'])).toHaveProperty('status', 'fulfilled');
  });

  it('keeps the last of several concurrent switches', async () => {
    const { catalog } = makeCatalog();
    const parla = createParla({ catalog });
    await Promise.all([parla.setLocale('it'), parla.setLocale('en')]);
    expect(parla.locale).toBe('en');
  });

  it('marks settled promises for React and retries a failed download a second later', async () => {
    const { catalog } = makeCatalog();
    const failure = new Error('offline');
    let attempts = 0;
    const flaky: Catalog = {
      ...catalog,
      namespaces: {
        ...catalog.namespaces,
        flaky: {
          en: async () => {
            attempts += 1;
            if (attempts === 1) {
              throw failure;
            }
            return Promise.resolve(chunk({ ok: 'yes' }));
          },
        },
      },
    };
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const parla = createParla({ catalog: flaky });
    const first = parla.load(['flaky']);
    expect(parla.load(['flaky'])).toBe(first);
    await expect(first).rejects.toBe(failure);
    expect(first).toMatchObject({ status: 'rejected', reason: failure });

    expect(parla.load(['flaky'])).toBe(first);
    vi.advanceTimersByTime(1000);
    const second = parla.load(['flaky']);
    expect(second).not.toBe(first);
    const t = await second;
    expect(second).toMatchObject({ status: 'fulfilled', value: t });
    expect(attempts).toBe(2);
  });

  it('rejects unknown locales and namespaces', async () => {
    const { catalog } = makeCatalog();
    expect(() => createParla({ catalog, locale: 'fr' })).toThrow(/unknown locale "fr"/);
    await expect(createParla({ catalog }).load(['nope' as never])).rejects.toThrow(
      /unknown namespace/,
    );
  });
});

describe(matchLocale, () => {
  it('matches exact tags, then base languages', () => {
    expect(matchLocale(['it-IT', 'en'], ['en', 'it'], 'en')).toBe('it');
    expect(matchLocale(['pt-BR'], ['en', 'pt-BR'], 'en')).toBe('pt-BR');
    expect(matchLocale(['fr'], ['en', 'it'], 'en')).toBe('en');
  });
});
