import { createParla as createCoreParla } from '@parlajs/core';
import type { Locale, Namespace, Namespaces, Parla, ParlaOptions } from '@parlajs/core';
import {
  createContext,
  createElement,
  Fragment,
  use,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
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

interface ParlaContextValue {
  readonly parla: Parla;
}

const ParlaContext = createContext<ParlaContextValue | null>(null);
ParlaContext.displayName = 'ParlaContext';

export function ParlaProvider({
  parla,
  children,
}: {
  parla: Parla;
  children?: ReactNode;
}): ReactNode {
  const value = useMemo(() => ({ parla }), [parla]);
  return createElement(ParlaContext.Provider, { value }, children);
}

function useParlaContext(): ParlaContextValue {
  const value = useContext(ParlaContext);
  if (!value) {
    throw new Error('[parla] wrap your app in <ParlaProvider parla={…}>');
  }
  return value;
}

/** One namespace, or several. */
export type NamespaceInput = Namespace | ReadonlyArray<Namespace>;

/** One namespace's accessor, or an object of accessors keyed by namespace. */
export type Translations<NS extends NamespaceInput> =
  NS extends ReadonlyArray<Namespace>
    ? { readonly [K in NS[number]]: Namespaces[K] }
    : NS extends Namespace
      ? Namespaces[NS]
      : never;

export interface SuspenseParlaResult<NS extends NamespaceInput> {
  readonly parla: Parla;
  readonly t: Translations<NS>;
}

/** `t` exists only once `ready` is checked. */
export type ParlaResult<NS extends NamespaceInput> =
  | { readonly ready: true; readonly parla: Parla; readonly t: Translations<NS> }
  | { readonly ready: false; readonly parla: Parla; readonly t: undefined };

const toList = (namespaces: NamespaceInput): ReadonlyArray<Namespace> =>
  typeof namespaces === 'string' ? [namespaces] : namespaces;

// Keyed objects are cached so `t` keeps its identity across renders, as a single accessor does.
const keyedCache = new WeakMap<Parla, Map<string, object>>();

function shape(
  parla: Parla,
  locale: Locale,
  namespaces: NamespaceInput,
  accessors: ReadonlyArray<unknown>,
): unknown {
  if (typeof namespaces === 'string') {
    return accessors[0];
  }
  const list = toList(namespaces);
  const key = `${locale}\u0000${list.join('\u0000')}`;
  let byKey = keyedCache.get(parla);
  if (!byKey) {
    byKey = new Map();
    keyedCache.set(parla, byKey);
  }
  let keyed = byKey.get(key);
  if (!keyed) {
    keyed = Object.fromEntries(list.map((ns, i) => [ns, accessors[i]]));
    byKey.set(key, keyed);
  }
  return keyed;
}

/**
 * Typed messages for one namespace or several, suspending until they load for the current
 * locale. Switching locale does not suspend: `setLocale` loads first.
 */
export function useSuspenseParla<const NS extends NamespaceInput>(
  namespaces: NS,
): SuspenseParlaResult<NS> {
  const { parla } = useParlaContext();
  const { locale } = useSyncExternalStore(parla.subscribe, parla.getSnapshot, parla.getSnapshot);
  // Every load starts before the first `use()` can suspend, so they download in parallel.
  // A loop, not an `async` callback: `use()` needs Parla's cached promise itself.
  const pending: Array<Promise<unknown>> = [];
  for (const ns of toList(namespaces)) {
    pending.push(parla.load(ns, locale));
  }
  const accessors: Array<unknown> = [];
  for (const promise of pending) {
    // Called on every render: React forbids skipping a `use()` that suspended before.
    accessors.push(use(promise));
  }
  return { parla, t: shape(parla, locale, namespaces, accessors) as Translations<NS> };
}

/**
 * Typed messages for one namespace or several, without suspending: `ready` is false until they
 * load for the current locale, then the component re-renders. Loaded ones are ready at once.
 */
export function useParla<const NS extends NamespaceInput>(namespaces: NS): ParlaResult<NS> {
  const { parla } = useParlaContext();
  const { locale } = useSyncExternalStore(parla.subscribe, parla.getSnapshot, parla.getSnapshot);
  const list = toList(namespaces);
  const key = list.join('\u0000');
  const accessors = list.map((ns) => parla.getT(ns));
  const ready = accessors.every((accessor) => accessor !== undefined);
  const [failure, setFailure] = useState<{ readonly error: unknown }>();
  const [, loaded] = useReducer((count: number) => count + 1, 0);

  useEffect(() => {
    let live = true;
    const load = async (): Promise<void> => {
      try {
        await parla.preload(key.split('\u0000') as Array<Namespace>, locale);
        if (live) {
          loaded();
        }
      } catch (error) {
        if (live) {
          setFailure({ error });
        }
      }
    };
    if (!ready) {
      void load();
    }
    return (): void => {
      live = false;
    };
  }, [parla, locale, key, ready]);

  if (failure) {
    throw failure.error;
  }
  if (!ready) {
    return { ready, parla, t: undefined };
  }
  return { ready, parla, t: shape(parla, locale, namespaces, accessors) as Translations<NS> };
}

/** Current locale and a setter that loads the namespaces in use before switching. */
export function useLocale(): [Locale, (locale: Locale) => Promise<void>] {
  const { parla } = useParlaContext();
  const { locale } = useSyncExternalStore(parla.subscribe, parla.getSnapshot, parla.getSnapshot);
  return [locale, parla.setLocale];
}
