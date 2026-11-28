import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { Component, StrictMode, Suspense } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createParla, ParlaProvider, useLocale, useParla, useParlaLoaded } from '../src/index.ts';
import type {
  Catalog,
  Loader,
  Namespace,
  NamespaceKind,
  Parla,
  Translations,
} from '../src/index.ts';

// What `parla build` would generate for these namespaces.
interface ShopMessages<Node> {
  title: () => string;
  terms: (params: { link: (children: Node) => Node }) => Node;
}
interface ShopKind extends NamespaceKind {
  readonly messages: ShopMessages<this['node']>;
}
interface ExtraKind extends NamespaceKind {
  readonly messages: { hello: () => string };
}
interface BrokenKind extends NamespaceKind {
  readonly messages: { never: () => string };
}

// Resolves after React yields, as `import()` does; a quicker one hides React's replay of a suspended render.
async function nextTask(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 10);
  });
}

const catalog: Catalog = { locales: ['en', 'it'], sourceLocale: 'en' };

const shop: Namespace<'shop', ShopKind, 'en' | 'it'> = {
  name: 'shop',
  load: {
    en: async () => {
      await nextTask();
      return {
        default: ($) => ({
          title: () => 'Shop',
          terms: (p: Record<string, unknown>) => $.rich(['Read the ', $.tag(p, 'link', ['terms'])]),
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
};

const extra: Namespace<'extra', ExtraKind, 'en' | 'it'> = {
  name: 'extra',
  load: {
    en: async () => {
      await nextTask();
      return { default: () => ({ hello: () => 'Hello' }) };
    },
    it: async () => {
      await nextTask();
      return { default: () => ({ hello: () => 'Ciao' }) };
    },
  },
};

const offline: Loader = async () => {
  await nextTask();
  throw new Error('offline');
};
const broken: Namespace<'broken', BrokenKind, 'en' | 'it'> = {
  name: 'broken',
  load: { en: offline, it: offline },
};
// Built for English only, in an app that also speaks Italian.
const english = { name: 'english', load: { en: offline } } as Namespace<'english', BrokenKind>;

const link = (children: ReactNode): ReactNode => <a href="/terms">{children}</a>;

function Shop(): ReactNode {
  const { t } = useParla([shop]);
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
function Hello({ t }: { t: Translations<typeof extra> }): ReactNode {
  return <span>{t.extra.hello()}</span>;
}

function Greeting(): ReactNode {
  const { t } = useParla([shop, extra]);
  return (
    <h1>
      <Hello t={t} /> {t.shop.title()}
    </h1>
  );
}

function Lazy(): ReactNode {
  const { t } = useParlaLoaded([shop]);
  const { locale, setLocale } = useLocale();
  return (
    <button
      type="button"
      onClick={() => {
        void setLocale(locale === 'en' ? 'it' : 'en');
      }}>
      {t ? t.shop.title() : 'loading'}
    </button>
  );
}

function LazyOffline(): ReactNode {
  const { t } = useParlaLoaded([broken]);
  return <span>{t ? 'ready' : 'loading'}</span>;
}

function Offline(): ReactNode {
  useParla([broken]);
  return <span>ready</span>;
}

function English(): ReactNode {
  useParla([english]);
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
      await parla.load([shop]);
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
      const rendered = renderHook(() => useParla([shop, extra]), {
        wrapper: wrapperFor(parla),
      });
      await parla.load([shop, extra]);
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
    await parla.load([shop, extra]);
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
      await expect(parla.load([broken])).rejects.toThrow('offline');
    });
    await expect(screen.findByText('offline')).resolves.toBeDefined();
  });

  it('hands a namespace built for other locales to the error boundary', () => {
    vi.spyOn(console, 'error').mockReturnValue();
    act(() => {
      render(
        <ParlaProvider parla={createParla({ catalog })}>
          <Boundary>
            <English />
          </Boundary>
        </ParlaProvider>,
      );
    });
    expect(screen.getByText(/namespace "english" was built for en, not it/)).toBeDefined();
  });

  it('useParlaLoaded renders without t until it loads, never suspending', async () => {
    const parla = createParla({ catalog });
    const suspended = vi.fn<() => ReactNode>(() => null);
    function Fallback(): ReactNode {
      return suspended();
    }
    act(() => {
      render(
        <ParlaProvider parla={parla}>
          <Suspense fallback={<Fallback />}>
            <Lazy />
          </Suspense>
        </ParlaProvider>,
      );
    });
    expect(screen.getByRole('button').textContent).toBe('loading');
    await act(async () => {
      await parla.load([shop]);
    });
    expect(screen.getByRole('button').textContent).toBe('Shop');
    await act(async () => {
      screen.getByRole('button').click();
      // The click's switch; a second to the same locale settles with it.
      await parla.setLocale('it');
    });
    expect(screen.getByRole('button').textContent).toBe('Negozio');
    expect(suspended).not.toHaveBeenCalled();
  });

  it('useParlaLoaded has t on the first render once loaded ahead', async () => {
    const parla = createParla({ catalog });
    await parla.load([shop]);
    act(() => {
      render(<Lazy />, { wrapper: wrapperFor(parla) });
    });
    expect(screen.getByRole('button').textContent).toBe('Shop');
  });

  it('useParlaLoaded hands a failed download to the error boundary', async () => {
    vi.spyOn(console, 'error').mockReturnValue();
    const parla = createParla({ catalog });
    await act(async () => {
      render(
        <ParlaProvider parla={parla}>
          <Boundary>
            <LazyOffline />
          </Boundary>
        </ParlaProvider>,
      );
      await expect(parla.load([broken])).rejects.toThrow('offline');
    });
    await expect(screen.findByText('offline')).resolves.toBeDefined();
  });

  it('explains a missing provider', () => {
    vi.spyOn(console, 'error').mockReturnValue();
    expect(() => render(<Offline />)).toThrow(/ParlaProvider/);
  });
});
