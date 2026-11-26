import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { Component, StrictMode, Suspense } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createParla, ParlaProvider, useLocale, useParla } from '../src/index.ts';
import type { Catalog, Parla, Translations } from '../src/index.ts';

// What `parla build` would generate for this catalog.
declare module '@parlajs/core' {
  interface Register {
    namespaces: {
      shop: {
        title: () => string;
        terms: (params: { link: (children: ReactNode) => ReactNode }) => ReactNode;
      };
      extra: {
        hello: () => string;
      };
      broken: {
        never: () => string;
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
          default: ($) => ({
            title: () => 'Shop',
            terms: (p: Record<string, unknown>) =>
              $.rich(['Read the ', $.tag(p, 'link', ['terms'])]),
          }),
        };
      },
      it: async () => {
        await nextTask();
        return {
          default: ($) => ({
            title: () => 'Negozio',
            terms: (p: Record<string, unknown>) =>
              $.rich(['Leggi i ', $.tag(p, 'link', ['termini'])]),
          }),
        };
      },
    },
    extra: {
      en: async () => {
        await nextTask();
        return { default: () => ({ hello: () => 'Hello' }) };
      },
      it: async () => {
        await nextTask();
        return { default: () => ({ hello: () => 'Ciao' }) };
      },
    },
    broken: {
      en: async () => {
        await nextTask();
        throw new Error('offline');
      },
      it: async () => {
        await nextTask();
        throw new Error('offline');
      },
    },
  },
};

const link = (children: ReactNode): ReactNode => <a href="/terms">{children}</a>;

function Shop(): ReactNode {
  const { t } = useParla(['shop']);
  const { locale, locales, setLocale } = useLocale();
  return (
    <div>
      <h1>{t.shop.title()}</h1>
      <p>{t.shop.terms({ link })}</p>
      <button
        type="button"
        onClick={() => {
          void setLocale(locales.find((l) => l !== locale) ?? locale);
        }}>
        {locale}
      </button>
    </div>
  );
}

// A child demands the namespaces it reads; a parent's wider `t` satisfies it.
function Hello({ t }: { t: Translations<'extra'> }): ReactNode {
  return <span>{t.extra.hello()}</span>;
}

function Greeting(): ReactNode {
  const { t } = useParla(['shop', 'extra']);
  return (
    <h1>
      <Hello t={t} /> {t.shop.title()}
    </h1>
  );
}

function Offline(): ReactNode {
  useParla(['broken']);
  return <span>ready</span>;
}

class Boundary extends Component<{ children: ReactNode }, { error?: Error }> {
  override state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  override render(): ReactNode {
    return this.state.error ? <span>{this.state.error.message}</span> : this.props.children;
  }
}

function wrapperFor(parla: Parla): (props: { children: ReactNode }) => ReactNode {
  return function Wrapper({ children }) {
    return <ParlaProvider parla={parla}>{children}</ParlaProvider>;
  };
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
      await parla.load(['shop']);
    });
    expect(screen.getByRole('heading').textContent).toBe('Shop');
    expect(screen.getByRole('link').textContent).toBe('terms');
    expect(screen.getByRole('link').getAttribute('href')).toBe('/terms');

    await act(async () => {
      screen.getByRole('button').click();
      await vi.waitFor(() => {
        expect(parla.locale).toBe('it');
      });
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

  it('loads several namespaces at once, keyed by namespace, with a `t` that keeps its identity', async () => {
    const parla = createParla({ catalog });
    const hook = await act(async () => {
      const rendered = renderHook(() => useParla(['shop', 'extra']), {
        wrapper: wrapperFor(parla),
      });
      await parla.load(['shop', 'extra']);
      return rendered;
    });
    const { result, rerender } = hook;
    const { t } = result.current;
    expect([t.shop.title(), t.extra.hello()]).toStrictEqual(['Shop', 'Hello']);
    rerender();
    expect(result.current.t).toBe(t);
  });

  it('never suspends for namespaces loaded ahead, and passes `t` down typed', async () => {
    const parla = createParla({ catalog });
    await parla.load(['shop', 'extra']);
    act(() => {
      render(
        <ParlaProvider parla={parla}>
          <Suspense fallback={<span>loading</span>}>
            <Greeting />
          </Suspense>
        </ParlaProvider>,
      );
    });
    expect(screen.queryByText('loading')).toBeNull();
    expect(screen.getByRole('heading').textContent).toBe('Hello Shop');
  });

  it('hands a failed download to the error boundary', async () => {
    vi.spyOn(console, 'error').mockReturnValue();
    const parla = createParla({ catalog });
    await act(async () => {
      render(
        <ParlaProvider parla={parla}>
          <Boundary>
            <Suspense fallback={<span>loading</span>}>
              <Offline />
            </Suspense>
          </Boundary>
        </ParlaProvider>,
      );
      await expect(parla.load(['broken'])).rejects.toThrow('offline');
    });
    await expect(screen.findByText('offline')).resolves.toBeDefined();
  });

  it('explains a missing provider', () => {
    vi.spyOn(console, 'error').mockReturnValue();
    expect(() => render(<Offline />)).toThrow(/ParlaProvider/);
  });
});
