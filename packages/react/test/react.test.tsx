// @vitest-environment happy-dom
import { act, render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import { describe, expect, it } from 'vitest';
import { createParla, ParlaProvider, useLocale, useT, type Catalog } from '../src/index.js';

const catalog: Catalog = {
  locales: ['en', 'it'],
  sourceLocale: 'en',
  namespaces: {
    shop: {
      en: async () => ({
        default: {
          title: () => 'Shop',
          terms: (p, $) => $.rich(['Read the ', $.tag(p, 'link', ['terms'])]),
        },
      }),
      it: async () => ({
        default: {
          title: () => 'Negozio',
          terms: (p, $) => $.rich(['Leggi i ', $.tag(p, 'link', ['termini'])]),
        },
      }),
    },
  },
};

function Shop() {
  const t = useT('shop') as any;
  const [locale, setLocale] = useLocale();
  return (
    <div>
      <h1>{t.title()}</h1>
      <p>{t.terms({ link: (children: React.ReactNode) => <a href="/terms">{children}</a> })}</p>
      <button type="button" onClick={() => setLocale(locale === 'en' ? 'it' : 'en')}>
        {locale}
      </button>
    </div>
  );
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
    });
    expect(screen.getByRole('heading').textContent).toBe('Shop');
    expect(screen.getByRole('link').textContent).toBe('terms');
    expect(screen.getByRole('link').getAttribute('href')).toBe('/terms');

    await act(async () => {
      screen.getByRole('button').click();
    });
    expect(screen.queryByText('loading')).toBeNull();
    expect(screen.getByRole('heading').textContent).toBe('Negozio');
    expect(screen.getByRole('link').textContent).toBe('termini');
    expect(screen.getByRole('button').textContent).toBe('it');
  });

  it('explains a missing provider', () => {
    const Broken = () => {
      useT('shop');
      return null;
    };
    expect(() => render(<Broken />)).toThrow(/ParlaProvider/);
  });
});
