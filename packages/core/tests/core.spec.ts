import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { createParla, matchLocale } from '../src/index.ts';
import type { Catalog, Loader, MessageModule, Namespace } from '../src/index.ts';

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

const catalog: Catalog = { locales: ['en', 'it'], sourceLocale: 'en' };

function makeNamespaces(): {
  common: Namespace;
  checkout: Namespace;
  calls: Array<string>;
} {
  const calls: Array<string> = [];
  const loader =
    (locale: string, ns: string, messages: Messages): Loader =>
    async () => {
      calls.push(`${locale}/${ns}`);
      return Promise.resolve(chunk(messages));
    };
  const common = {
    name: 'common',
    load: {
      en: loader('en', 'common', { nav: { home: 'Home' } }),
      it: loader('it', 'common', { nav: { home: 'Inizio' } }),
    },
  };
  const checkout = {
    name: 'checkout',
    load: {
      en: loader('en', 'checkout', { title: 'Checkout' }),
      it: loader('it', 'checkout', { title: 'Cassa' }),
    },
  };
  return { common, checkout, calls };
}

describe(createParla, () => {
  it('loads each namespace once and returns messages keyed by name', async () => {
    const { common, checkout, calls } = makeNamespaces();
    const parla = createParla({ catalog });
    const [a, b] = await Promise.all([
      parla.load([common, checkout]),
      parla.load([checkout, common, common]),
    ]);
    // The same set of namespaces is one cached object, whatever the order.
    expect(a).toBe(b);
    expect((a['common'] as Common).nav.home()).toBe('Home');
    const single = await parla.load([common]);
    expect(single['common']).toBe(a['common']);
    expect(calls).toStrictEqual(['en/checkout', 'en/common']);
  });

  it('loads the namespaces loaded so far before switching locale, then never suspends', async () => {
    const { common, calls } = makeNamespaces();
    const parla = createParla({ catalog });
    await parla.load([common]);
    const listener = vi.fn<() => void>();
    parla.subscribe(listener);
    await parla.setLocale('it');
    expect(calls).toStrictEqual(['en/common', 'it/common']);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(parla.locale).toBe('it');
    const promise = parla.load([common]);
    expect(promise).toMatchObject({ status: 'fulfilled' });
    const t = await promise;
    expect((t['common'] as Common).nav.home()).toBe('Inizio');
  });

  it('also loads, before switching, a namespace first loaded during the switch', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { common, checkout } = makeNamespaces();
    const slow = {
      ...common,
      load: {
        ...common.load,
        it: async (): Promise<MessageModule> => {
          await held;
          return (common.load['it'] as Loader)();
        },
      },
    };
    const parla = createParla({ catalog });
    await parla.load([slow]);
    const switching = parla.setLocale('it');
    // a component mounting while `common` downloads for `it`
    await parla.load([checkout]);
    release();
    await switching;
    expect(parla.locale).toBe('it');
    expect(parla.load([checkout])).toHaveProperty('status', 'fulfilled');
  });

  it('keeps the last of several concurrent switches', async () => {
    const parla = createParla({ catalog });
    await Promise.all([parla.setLocale('it'), parla.setLocale('en')]);
    expect(parla.locale).toBe('en');
  });

  it('marks settled promises for React and retries a failed download a second later', async () => {
    const failure = new Error('offline');
    let attempts = 0;
    const flaky = {
      name: 'flaky',
      load: {
        en: async (): Promise<MessageModule> => {
          attempts += 1;
          if (attempts === 1) {
            throw failure;
          }
          return Promise.resolve(chunk({ ok: 'yes' }));
        },
        it: async (): Promise<MessageModule> => Promise.resolve(chunk({ ok: 'sì' })),
      },
    };
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const parla = createParla({ catalog });
    const first = parla.load([flaky]);
    expect(parla.load([flaky])).toBe(first);
    await expect(first).rejects.toBe(failure);
    expect(first).toMatchObject({ status: 'rejected', reason: failure });

    expect(parla.load([flaky])).toBe(first);
    vi.advanceTimersByTime(1000);
    const second = parla.load([flaky]);
    expect(second).not.toBe(first);
    const t = await second;
    expect(second).toMatchObject({ status: 'fulfilled', value: t });
    expect(attempts).toBe(2);
  });

  it('rejects an unknown locale', () => {
    expect(() => createParla({ catalog, locale: 'fr' })).toThrow(/unknown locale "fr"/);
  });
});

describe('namespace objects', () => {
  it('throw at once when built without one of the locales', () => {
    const { common } = makeNamespaces();
    const german = { name: 'german', load: { en: common.load['en'] as Loader } };
    expect(() => {
      void createParla({ catalog }).load([german]);
    }).toThrow('[parla] namespace "german" was built for en, not it');
  });

  it('point a string at the generated objects', () => {
    expect(() => {
      void createParla({ catalog }).load(['common' as never]);
    }).toThrow(/load takes namespace objects, not "common"/);
  });

  it('dedupe a second object of one name, keeping the first and warning once', async () => {
    const first = makeNamespaces();
    const second = makeNamespaces();
    const warn = vi.spyOn(console, 'warn').mockReturnValue();
    onTestFinished(() => {
      warn.mockRestore();
    });
    const parla = createParla({ catalog });
    const t = await parla.load([first.common, second.common]);
    await parla.load([second.common, second.checkout]);
    expect(Object.keys(t)).toStrictEqual(['common']);
    expect(first.calls).toStrictEqual(['en/common']);
    expect(second.calls).toStrictEqual(['en/checkout']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/two namespace objects are named "common"/),
    );
  });
});

describe(matchLocale, () => {
  it('matches exact tags, then base languages', () => {
    expect(matchLocale(['it-IT', 'en'], ['en', 'it'], 'en')).toBe('it');
    expect(matchLocale(['pt-BR'], ['en', 'pt-BR'], 'en')).toBe('pt-BR');
    expect(matchLocale(['fr'], ['en', 'it'], 'en')).toBe('en');
  });

  it('prefers the same script, then the same region, among tags of one language', () => {
    expect(matchLocale(['zh-Hant-TW'], ['zh-CN', 'zh-TW'], 'en')).toBe('zh-TW');
    expect(matchLocale(['zh-HK'], ['zh-CN', 'zh-TW'], 'en')).toBe('zh-TW');
    expect(matchLocale(['sr-Latn-RS'], ['sr', 'sr-Latn'], 'en')).toBe('sr-Latn');
    expect(matchLocale(['en'], ['en-GB', 'en-US'], 'en-GB')).toBe('en-US');
    expect(matchLocale(['pt-PT'], ['en', 'pt-BR'], 'en')).toBe('pt-BR');
    expect(matchLocale(['not a tag', 'it'], ['en', 'it'], 'en')).toBe('it');
    // a later, worse candidate keeps the better one; an invalid supported tag is skipped
    expect(matchLocale(['zh-HK'], ['zh-TW', 'zh-CN', 'not a tag'], 'en')).toBe('zh-TW');
  });
});
