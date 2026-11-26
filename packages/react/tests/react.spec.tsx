import { act, render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { createParla, ParlaProvider, useLocale, useT } from '../src/index.ts';
import type { Catalog } from '../src/index.ts';

// What `parla build` would generate for this catalog.
declare module '@parlajs/core' {
  interface Register {
    namespaces: {
      shop: {
        title: () => string;
        terms: (params: { link: (children: ReactNode) => ReactNode }) => ReactNode;
      };
    };
  }
}

const catalog: Catalog = {
  locales: ['en', 'it'],
  sourceLocale: 'en',
  namespaces: {
    shop: {
      en: async () =>
        Promise.resolve({
          default: {
            title: () => 'Shop',
            terms: (p, $) => $.rich(['Read the ', $.tag(p, 'link', ['terms'])]),
          },
        }),
      it: async () =>
        Promise.resolve({
          default: {
            title: () => 'Negozio',
            terms: (p, $) => $.rich(['Leggi i ', $.tag(p, 'link', ['termini'])]),
          },
        }),
    },
  },
};

const link = (children: ReactNode): ReactNode => <a href="/terms">{children}</a>;

function Shop(): ReactNode {
  const t = useT('shop');
  const [locale, setLocale] = useLocale();
  return (
    <div>
      <h1>{t.title()}</h1>
      <p>{t.terms({ link })}</p>
      <button
        type="button"
        onClick={() => {
          void setLocale(locale === 'en' ? 'it' : 'en');
        }}>
        {locale}
      </button>
    </div>
  );
}

function Broken(): ReactNode {
  useT('shop');
  return null;
}

describe('@parlajs/react', () => {
  it('suspends until the namespace loads, renders rich text and switches locale without suspending', async () => {
    const parla = createParla({ catalog });
    await act(async () => {
      render(
        <ParlaProvider parla={parla}>
          <Suspense fallback={<span>loading</span>}>
            <Shop />
          </Suspense>
        </ParlaProvider>,
      );
      await parla.load('shop');
    });
    expect(screen.getByRole('heading').textContent).toBe('Shop');
    expect(screen.getByRole('link').textContent).toBe('terms');
    expect(screen.getByRole('link').getAttribute('href')).toBe('/terms');

    await act(async () => {
      screen.getByRole('button').click();
      await parla.preload(['shop'], 'it');
    });
    expect(screen.getByRole('heading').textContent).toBe('Negozio');
    expect(screen.queryByText('loading')).toBeNull();
    expect(screen.getByRole('link').textContent).toBe('termini');
    expect(screen.getByRole('button').textContent).toBe('it');
  });

  it('explains a missing provider', () => {
    expect(() => render(<Broken />)).toThrow(/ParlaProvider/);
  });
});
