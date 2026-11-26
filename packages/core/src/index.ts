import { createRuntime } from './runtime.ts';
import type { MessageRuntime, WrapRich } from './runtime.ts';

export {
  createRuntime,
  type MessageRuntime,
  type SelectorValue,
  type WrapRich,
} from './runtime.ts';

/**
 * Augmented by generated code (`locale`, `namespaces`) and by framework adapters (`richNode`).
 * Do not augment it by hand.
 */
// oxlint-disable-next-line typescript/no-empty-object-type -- the augmentation target
export interface Register {}

type Registered<K extends string, Fallback> = Register extends Record<K, infer V> ? V : Fallback;

export type Locale = Registered<'locale', string>;
export type Namespaces = Registered<'namespaces', Record<string, object>>;
export type Namespace = keyof Namespaces;
/** What a message with markup returns: `ReactNode` with `@parlajs/react`. */
export type RichNode = Registered<'richNode', unknown>;

/** A compiled chunk: called once per locale with its runtime, it returns the namespace's accessor. */
export type MessageFactory = (rt: MessageRuntime) => unknown;
export interface MessageModule {
  default: MessageFactory;
}
export type Loader = () => Promise<MessageModule>;

/** Emitted by `parla build` as `catalog.js`. */
export interface Catalog {
  readonly locales: ReadonlyArray<Locale>;
  readonly sourceLocale: Locale;
  readonly namespaces: Readonly<Record<string, Readonly<Record<string, Loader>>>>;
}

export interface ParlaOptions {
  catalog: Catalog;
  /** Initial locale. Defaults to the catalog's source locale. */
  locale?: Locale;
  /** Turns message parts with markup into one node. Set by framework adapters. */
  wrapRich?: WrapRich;
}

export interface Snapshot {
  readonly locale: Locale;
}

export interface Parla {
  readonly locale: Locale;
  readonly locales: ReadonlyArray<Locale>;
  /** Loads every namespace in use for `locale`, then switches, so nothing suspends. */
  readonly setLocale: (locale: Locale) => Promise<void>;
  /**
   * Loads a namespace once per locale. Returns the same promise on every call, carrying
   * `status` and `value` once settled, which React's `use()` reads without suspending.
   */
  readonly load: <N extends Namespace>(namespace: N, locale?: Locale) => Promise<Namespaces[N]>;
  /** The accessor if the namespace is loaded for the current locale. */
  readonly getT: <N extends Namespace>(namespace: N) => Namespaces[N] | undefined;
  /** Loads namespaces ahead of render, e.g. on the server or before hydration. */
  readonly preload: (namespaces: ReadonlyArray<Namespace>, locale?: Locale) => Promise<void>;
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => Snapshot;
}

const INSTANCE = Symbol.for('parlajs.core');
const marker = {};
const g = globalThis as { [INSTANCE]?: object };
if (g[INSTANCE] && g[INSTANCE] !== marker) {
  // oxlint-disable-next-line no-console -- two instances split locale state with no error
  console.warn(
    '[parla] Several copies of @parlajs/core are loaded. Make it a peerDependency so adapters share one instance.',
  );
}
g[INSTANCE] = marker;

export function createParla(options: ParlaOptions): Parla {
  const { catalog, wrapRich } = options;
  const { locales } = catalog;
  let snapshot: Snapshot = { locale: options.locale ?? catalog.sourceLocale };
  const listeners = new Set<() => void>();
  const runtimes = new Map<string, MessageRuntime>();
  const promises = new Map<string, Promise<unknown>>();
  const accessors = new Map<string, unknown>();
  const used = new Set<Namespace>();
  let switchToken = 0;

  const assertLocale = (locale: Locale): void => {
    if (!locales.includes(locale)) {
      throw new Error(`[parla] unknown locale "${locale}". Known: ${locales.join(', ')}`);
    }
  };
  assertLocale(snapshot.locale);

  const runtime = (locale: string): MessageRuntime => {
    let rt = runtimes.get(locale);
    if (!rt) {
      rt = createRuntime(locale, wrapRich);
      runtimes.set(locale, rt);
    }
    return rt;
  };

  // Set before the promise settles, so a `use()` in the render it wakes reads it synchronously.
  const settle = (key: string, state: object): void => {
    const promise = promises.get(key);
    if (promise) {
      Object.assign(promise as object, state);
    }
  };

  const fetchAccessor = async (
    namespace: string,
    locale: string,
    key: string,
  ): Promise<unknown> => {
    const loader = catalog.namespaces[namespace]?.[locale];
    if (!loader) {
      throw new Error(`[parla] unknown namespace "${namespace}" for locale "${locale}"`);
    }
    try {
      const mod = await loader();
      const accessor = mod.default(runtime(locale));
      accessors.set(key, accessor);
      settle(key, { status: 'fulfilled', value: accessor });
      return accessor;
    } catch (error) {
      settle(key, { status: 'rejected', reason: error });
      // A failed download is retried on the next call.
      promises.delete(key);
      throw error;
    }
  };

  const parla: Parla = {
    get locale() {
      return snapshot.locale;
    },
    locales,
    // oxlint-disable-next-line typescript/promise-function-async -- `use()` needs the cached promise itself
    load(namespace, locale = snapshot.locale) {
      const key = `${locale}\u0000${namespace}`;
      used.add(namespace);
      let promise = promises.get(key);
      if (!promise) {
        promise = fetchAccessor(namespace, locale, key);
        promises.set(key, promise);
      }
      return promise as Promise<Namespaces[typeof namespace]>;
    },
    getT(namespace) {
      used.add(namespace);
      return accessors.get(`${snapshot.locale}\u0000${namespace}`) as
        | Namespaces[typeof namespace]
        | undefined;
    },
    async preload(namespaces, locale = snapshot.locale) {
      await Promise.all(namespaces.map(async (ns) => parla.load(ns, locale)));
    },
    async setLocale(locale) {
      assertLocale(locale);
      switchToken += 1;
      const token = switchToken;
      await parla.preload([...used], locale);
      if (token !== switchToken || locale === snapshot.locale) {
        return;
      }
      snapshot = { locale };
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
  };
  return parla;
}

/** Picks the best supported locale from a preference list such as `navigator.languages`. */
export function matchLocale<L extends string>(
  requested: ReadonlyArray<string>,
  supported: ReadonlyArray<L>,
  fallback: L,
): L {
  for (const req of requested) {
    const lower = req.toLowerCase();
    const [base] = lower.split('-');
    const match =
      supported.find((l) => l.toLowerCase() === lower) ??
      supported.find((l) => l.toLowerCase().split('-')[0] === base);
    if (match !== undefined) {
      return match;
    }
  }
  return fallback;
}
