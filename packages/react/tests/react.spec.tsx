import { act, cleanup, render, screen } from '@testing-library/react';
import { StrictMode, Suspense } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

// Resolves after React yields, as `import()` does; a quicker one hides React's replay of a suspended render.
async function nextTask(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 10);
  });
}

const catalog: Catalog = {
  locales: ['en', 'it'],
  sourceLocale: 'en',
  namespaces: {
    shop: {
      en: async () => {
        await nextTask();
        return {
          default: {
            title: () => 'Shop',
            terms: (p, $) => $.rich(['Read the ', $.tag(p, 'link', ['terms'])]),
          },
        };
      },
      it: async () => {
        await nextTask();
        return {
          default: {
            title: () => 'Negozio',
            terms: (p, $) => $.rich(['Leggi i ', $.tag(p, 'link', ['termini'])]),
          },
        };
      },
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
  // RTL cleans up on its own only with vitest globals.
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('suspends until the namespace loads, renders rich text and switches locale without suspending', async () => {
    const consoleError = vi.spyOn(console, 'error');
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
    // React reports a misused `use()` through console.error, not by throwing.
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('suspends and resumes outside act and in StrictMode, as in the browser, without misusing use()', async () => {
    const consoleError = vi.spyOn(console, 'error');
    const global = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    global.IS_REACT_ACT_ENVIRONMENT = false;
    // RTL's `render` always wraps in `act`, which retries a suspended tree differently.
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      root.render(
        <StrictMode>
          <ParlaProvider parla={createParla({ catalog })}>
            <Suspense fallback={<span>loading</span>}>
              <Shop />
            </Suspense>
          </ParlaProvider>
        </StrictMode>,
      );
      await vi.waitFor(() => {
        expect(screen.getByRole('heading').textContent).toBe('Shop');
      });
    } finally {
      root.unmount();
      global.IS_REACT_ACT_ENVIRONMENT = true;
    }
    // React reports a misused `use()` through console.error, not by throwing.
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('explains a missing provider', () => {
    expect(() => render(<Broken />)).toThrow(/ParlaProvider/);
  });
});
