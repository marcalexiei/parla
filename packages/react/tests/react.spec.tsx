import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { Component, StrictMode, Suspense } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createParla, ParlaProvider, useLocale, useParla, useSuspenseParla } from '../src/index.ts';
import type { Catalog, Parla } from '../src/index.ts';

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
  const { t } = useSuspenseParla(['shop']);
  const [locale, setLocale] = useLocale();
  return (
    <div>
      <h1>{t.shop.title()}</h1>
      <p>{t.shop.terms({ link })}</p>
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

function Greeting(): ReactNode {
  const { t, ready } = useParla(['shop', 'extra']);
  if (!ready) {
    return <span>not ready</span>;
  }
  return (
    <h1>
      {t.extra.hello()} {t.shop.title()}
    </h1>
  );
}

function Offline(): ReactNode {
  const { ready } = useParla(['broken']);
  return <span>{ready ? 'ready' : 'not ready'}</span>;
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

function Broken(): ReactNode {
  useSuspenseParla(['shop']);
  return null;
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

  it('loads several namespaces at once, keyed by namespace, with a `t` that keeps its identity', async () => {
    const parla = createParla({ catalog });
    const load = vi.spyOn(parla, 'load');
    const hook = await act(async () => {
      const rendered = renderHook(() => useSuspenseParla(['shop', 'extra']), {
        wrapper: wrapperFor(parla),
      });
      await parla.preload(['shop', 'extra']);
      return rendered;
    });
    const { result, rerender } = hook;
    // Both downloads start before the first one suspends; one by one would load `shop` twice first.
    expect(load.mock.calls.slice(0, 2).map(([ns]) => ns)).toStrictEqual(['shop', 'extra']);
    const { t } = result.current;
    expect([t.shop.title(), t.extra.hello()]).toStrictEqual(['Shop', 'Hello']);
    rerender();
    expect(result.current.t).toBe(t);
    expect(result.current.parla).toBe(parla);
  });

  it('renders without suspending until ready, then re-renders, and is ready at once when loaded', async () => {
    const parla = createParla({ catalog });
    act(() => {
      render(
        <ParlaProvider parla={parla}>
          <Suspense fallback={<span>loading</span>}>
            <Greeting />
          </Suspense>
        </ParlaProvider>,
      );
    });
    expect(screen.getByText('not ready')).toBeDefined();
    expect(screen.queryByText('loading')).toBeNull();

    await act(async () => {
      await parla.preload(['shop', 'extra']);
    });
    expect(screen.getByRole('heading').textContent).toBe('Hello Shop');

    const { result } = renderHook(() => useParla(['extra']), { wrapper: wrapperFor(parla) });
    expect(result.current.ready && result.current.t.extra.hello()).toBe('Hello');
  });

  it('hands a failed download to the error boundary', async () => {
    vi.spyOn(console, 'error').mockReturnValue();
    const parla = createParla({ catalog });
    await act(async () => {
      render(
        <ParlaProvider parla={parla}>
          <Boundary>
            <Offline />
          </Boundary>
        </ParlaProvider>,
      );
      await expect(parla.load('broken')).rejects.toThrow('offline');
    });
    await expect(screen.findByText('offline')).resolves.toBeDefined();
  });

  it('ignores a load that settles after unmounting', async () => {
    const consoleError = vi.spyOn(console, 'error');
    const parla = createParla({ catalog });
    const { unmount } = render(
      <ParlaProvider parla={parla}>
        <Greeting />
        <Offline />
      </ParlaProvider>,
    );
    unmount();
    await act(async () => {
      await parla.preload(['shop', 'extra']);
      await expect(parla.load('broken')).rejects.toThrow('offline');
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('explains a missing provider', () => {
    expect(() => render(<Broken />)).toThrow(/ParlaProvider/);
  });
});
