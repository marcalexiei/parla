import { createParla as createCoreParla } from '@parlajs/core';
import type { Locale, Namespace, Namespaces, Parla, ParlaOptions } from '@parlajs/core';
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
  type CompiledMessage,
  type Loader,
  type Locale,
  type MessageModule,
  type MessageRuntime,
  type Namespace,
  type Namespaces,
  type Parla,
  type ParlaOptions,
  type Register,
  type RichNode,
  type SelectorValue,
  type Snapshot,
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

export function useParla(): Parla {
  const parla = useContext(ParlaContext);
  if (!parla) {
    throw new Error('[parla] wrap your app in <ParlaProvider parla={…}>');
  }
  return parla;
}

/** Typed accessor for `namespace`. Suspends while its chunk for the current locale loads. */
export function useT<N extends Namespace>(namespace: N): Namespaces[N] {
  const parla = useParla();
  useSyncExternalStore(parla.subscribe, parla.getSnapshot, parla.getSnapshot);
  return parla.getT(namespace) ?? use(parla.load(namespace));
}

/** Current locale and a setter that loads the namespaces in use before switching. */
export function useLocale(): [Locale, (locale: Locale) => Promise<void>] {
  const parla = useParla();
  const { locale } = useSyncExternalStore(parla.subscribe, parla.getSnapshot, parla.getSnapshot);
  return [locale, parla.setLocale];
}
