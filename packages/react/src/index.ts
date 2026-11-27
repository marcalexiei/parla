import { createParla as createCoreParla } from '@parlajs/core';
import type {
  Locale,
  Namespace,
  Namespaces as CoreNamespaces,
  Parla as CoreParla,
  ParlaOptions as CoreParlaOptions,
  Translations as CoreTranslations,
  WrapRich as CoreWrapRich,
} from '@parlajs/core';
import {
  createContext,
  createElement,
  Fragment,
  use,
  useContext,
  useSyncExternalStore,
} from 'react';
import type { ReactNode } from 'react';

// Named rather than `export *`, which would clash with this module's own exports.
export {
  createRuntime,
  matchLocale,
  type Catalog,
  type FunctionName,
  type FunctionRegistry,
  type Loader,
  type Locale,
  type LocaleRegistry,
  type MarkupName,
  type MarkupRegistry,
  type MessageFactory,
  type MessageFunction,
  type MessageModule,
  type MessageRuntime,
  type Namespace,
  type NamespaceRegistry,
  type SelectorValue,
  type Text,
} from '@parlajs/core';

/* Core's types with rich text as a `ReactNode`. */
export type Namespaces = CoreNamespaces<ReactNode>;
export type Parla = CoreParla<ReactNode>;
export type ParlaOptions = CoreParlaOptions<ReactNode>;
export type Translations<NS extends Namespace> = CoreTranslations<NS, ReactNode>;
export type WrapRich = CoreWrapRich<ReactNode>;

/** Children passed as arguments, so React does not ask for keys. */
const wrapRich: WrapRich = (parts) => createElement(Fragment, null, ...parts);

/** `createParla` from `@parlajs/core`, with rich text rendered as React nodes. */
export function createParla(options: ParlaOptions): Parla {
  return createCoreParla<ReactNode>({ wrapRich, ...options });
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
