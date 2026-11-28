import type { Locale, Namespace } from '@parlajs/core';
import {
  createContext,
  createElement,
  use,
  useContext,
  useEffect,
  useReducer,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ReactNode } from 'react';

import type { Parla, Translations } from './server.ts';

// The server entry's exports, then the hooks it cannot have.
export * from './server.ts';

const ParlaContext = createContext<Parla | null>(null);
ParlaContext.displayName = 'ParlaContext';

export function ParlaProvider({
  parla,
  children,
}: {
  parla: Parla;
  children?: ReactNode;
}): ReactNode {
  return createElement(ParlaContext.Provider, { value: parla }, children);
}

/** The instance, re-rendering the component when the locale switches. */
function useParlaInstance(): Parla {
  const parla = useContext(ParlaContext);
  if (!parla) {
    throw new Error('[parla] wrap your app in <ParlaProvider parla={…}>');
  }
  const locale = (): Locale => parla.locale;
  useSyncExternalStore(parla.subscribe, locale, locale);
  return parla;
}

/**
 * Messages for the namespaces, keyed by namespace. Suspends until they load for the current
 * locale; loaded ones never suspend, and neither does a locale switch: `setLocale` loads first.
 */
export function useParla<NS extends Namespace>(
  namespaces: ReadonlyArray<NS>,
): { readonly t: Translations<NS> } {
  const parla = useParlaInstance();
  return { t: use(parla.load(namespaces)) };
}

/**
 * `{ t }` once the namespaces load for the current locale, `{ t: undefined }` until then: it never
 * suspends. A failed download reaches the error boundary, as with `useParla`.
 */
export function useParlaLoaded<NS extends Namespace>(
  namespaces: ReadonlyArray<NS>,
): { readonly t: Translations<NS> | undefined } {
  const parla = useParlaInstance();
  const t = parla.loaded(namespaces);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [failure, setFailure] = useState<{ readonly error: unknown }>();
  // No deps: `namespaces` is a new array each render, and `load` returns the cached promise.
  useEffect(() => {
    if (!t) {
      void (async (): Promise<void> => {
        try {
          await parla.load(namespaces);
          rerender();
        } catch (error) {
          setFailure({ error });
        }
      })();
    }
  });
  if (failure) {
    throw failure.error;
  }
  return { t };
}

/** The current locale, the supported ones, and a setter that loads before switching. */
export function useLocale(): {
  readonly locale: Locale;
  readonly locales: ReadonlyArray<Locale>;
  readonly setLocale: (locale: Locale) => Promise<void>;
} {
  const { locale, locales, setLocale } = useParlaInstance();
  return { locale, locales, setLocale };
}
