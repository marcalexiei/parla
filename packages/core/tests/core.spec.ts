import { describe, expect, it, vi } from 'vitest';

import { createParla, matchLocale } from '../src/index.ts';
import type { Catalog, Loader, MessageModule } from '../src/index.ts';

interface Common {
  nav: { home: () => string };
}

const chunk = (messages: Record<string, string>): MessageModule => ({
  default: Object.fromEntries(Object.entries(messages).map(([k, v]) => [k, () => v])),
});

function makeCatalog(): { catalog: Catalog; calls: Array<string> } {
  const calls: Array<string> = [];
  const loader =
    (locale: string, ns: string, messages: Record<string, string>): Loader =>
    async () => {
      calls.push(`${locale}/${ns}`);
      return Promise.resolve(chunk(messages));
    };
  const catalog: Catalog = {
    locales: ['en', 'it'],
    sourceLocale: 'en',
    namespaces: {
      common: {
        en: loader('en', 'common', { 'nav.home': 'Home' }),
        it: loader('it', 'common', { 'nav.home': 'Inizio' }),
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
  it('loads a namespace once and exposes nested accessors', async () => {
    const { catalog, calls } = makeCatalog();
    const parla = createParla({ catalog });
    expect(parla.getT('common')).toBeUndefined();
    const [a, b] = (await Promise.all([
      parla.load('common'),
      parla.load('common'),
    ])) as Array<Common>;
    expect(a).toBe(b);
    expect(a?.nav.home()).toBe('Home');
    expect(parla.getT('common')).toBe(a);
    expect(calls).toStrictEqual(['en/common']);
  });

  it('preloads the namespaces in use before switching locale', async () => {
    const { catalog, calls } = makeCatalog();
    const parla = createParla({ catalog });
    await parla.load('common');
    const listener = vi.fn<() => void>();
    parla.subscribe(listener);
    await parla.setLocale('it');
    expect(calls).toStrictEqual(['en/common', 'it/common']);
    expect(listener).toHaveBeenCalledTimes(1);
    expect((parla.getT('common') as Common | undefined)?.nav.home()).toBe('Inizio');
    expect(parla.getSnapshot().locale).toBe('it');
  });

  it('keeps the last of several concurrent switches', async () => {
    const { catalog } = makeCatalog();
    const parla = createParla({ catalog });
    await Promise.all([parla.setLocale('it'), parla.setLocale('en')]);
    expect(parla.locale).toBe('en');
  });

  it('rejects unknown locales and namespaces', async () => {
    const { catalog } = makeCatalog();
    expect(() => createParla({ catalog, locale: 'fr' })).toThrow(/unknown locale "fr"/);
    await expect(createParla({ catalog }).load('nope' as never)).rejects.toThrow(
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
