import { createParla as createCoreParla } from '@parlajs/core';
import type { Locale, Namespace, Parla, ParlaOptions, Translations } from '@parlajs/core';
import {
  createContext,
  createElement,
  Fragment,
  use,
  useContext,
  useSyncExternalStore,
} from 'react';
import type { ReactNode } from 'react';

// Named rather than `export *`, which would clash with this module's `createParla`.
export {
  createRuntime,
  matchLocale,
  type Catalog,
  type Loader,
  type Locale,
  type MessageFactory,
  type MessageModule,
  type MessageRuntime,
  type Namespace,
  type Namespaces,
  type Parla,
  type ParlaOptions,
  type Register,
  type RichNode,
  type SelectorValue,
  type Translations,
  type WrapRich,
} from '@parlajs/core';

declare module '@parlajs/core' {
  interface Register {
    richNode: ReactNode;
  }
}

/** Children passed as arguments, so React does not ask for keys. */
const wrapRich = (parts: Array<unknown>): ReactNode =>
  createElement(Fragment, null, ...(parts as Array<ReactNode>));

/** `createParla` from `@parlajs/core`, with rich text rendered as React nodes. */
export function createParla(options: ParlaOptions): Parla {
  return createCoreParla({ wrapRich, ...options });
}

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

/** The current locale, the supported ones, and a setter that loads before switching. */
export function useLocale(): {
  readonly locale: Locale;
  readonly locales: ReadonlyArray<Locale>;
  readonly setLocale: (locale: Locale) => Promise<void>;
} {
  const { locale, locales, setLocale } = useParlaInstance();
  return { locale, locales, setLocale };
}
