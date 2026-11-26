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

/** Messages keyed by namespace: `t.checkout.title()`. Holding one proves its namespaces loaded. */
export type Translations<NS extends Namespace> = { readonly [K in NS]: Namespaces[K] };

export interface Parla {
  readonly locale: Locale;
  readonly locales: ReadonlyArray<Locale>;
  /** Loads every namespace loaded so far for `locale`, then switches, so nothing suspends. */
  readonly setLocale: (locale: Locale) => Promise<void>;
  /**
   * Loads the namespaces for the current locale. The same list returns the same promise, carrying
   * `status` and `value` once settled, which React's `use()` reads without suspending. A failure
   * is returned for a second, then retried.
   */
  readonly load: <NS extends Namespace>(namespaces: ReadonlyArray<NS>) => Promise<Translations<NS>>;
  /** Called after each locale switch. */
  readonly subscribe: (listener: () => void) => () => void;
}

// Marks the promise as React's `use()` reads it; awaited first, so set before `use()` wakes.
async function track(promise: Promise<unknown>): Promise<void> {
  try {
    const value = await promise;
    void Object.assign(promise, { status: 'fulfilled', value });
  } catch (error) {
    void Object.assign(promise, { status: 'rejected', reason: error });
  }
}

const RETRY_AFTER_MS = 1000;

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
  let current: Locale = options.locale ?? catalog.sourceLocale;
  const listeners = new Set<() => void>();
  const runtimes = new Map<string, MessageRuntime>();
  const accessors = new Map<string, Promise<unknown>>();
  const settled = new Map<string, unknown>();
  const translations = new Map<string, Promise<object>>();
  const loaded = new Set<Namespace>();
  let switchToken = 0;

  const assertLocale = (locale: Locale): void => {
    if (!locales.includes(locale)) {
      throw new Error(`[parla] unknown locale "${locale}". Known: ${locales.join(', ')}`);
    }
  };
  assertLocale(current);

  const runtime = (locale: string): MessageRuntime => {
    let rt = runtimes.get(locale);
    if (!rt) {
      rt = createRuntime(locale, wrapRich);
      runtimes.set(locale, rt);
    }
    return rt;
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
      const value = mod.default(runtime(locale));
      settled.set(key, value);
      return value;
    } catch (error) {
      // A failed download is retried on the next call.
      accessors.delete(key);
      throw error;
    }
  };

  // oxlint-disable-next-line typescript/promise-function-async -- the promise is cached
  const accessor = (namespace: string, locale: string): Promise<unknown> => {
    const key = `${locale}\u0000${namespace}`;
    let promise = accessors.get(key);
    if (!promise) {
      promise = fetchAccessor(namespace, locale, key);
      accessors.set(key, promise);
    }
    return promise;
  };

  const fetchTranslations = async (
    list: ReadonlyArray<string>,
    locale: string,
    key: string,
  ): Promise<object> => {
    try {
      const values = await Promise.all(list.map(async (ns) => accessor(ns, locale)));
      return Object.fromEntries(list.map((ns, i) => [ns, values[i]]));
    } catch (error) {
      // Kept a while so React's retry render reads the error instead of loading again.
      setTimeout(() => {
        translations.delete(key);
      }, RETRY_AFTER_MS);
      throw error;
    }
  };

  // oxlint-disable-next-line typescript/promise-function-async -- `use()` needs the cached promise itself
  const load = (namespaces: ReadonlyArray<Namespace>, locale: Locale): Promise<object> => {
    const list = [...new Set(namespaces)].toSorted();
    const key = `${locale}\u0000${list.join('\u0000')}`;
    let promise = translations.get(key);
    if (!promise) {
      for (const ns of list) {
        loaded.add(ns);
      }
      const keys = list.map((ns) => [ns, `${locale}\u0000${ns}`] as const);
      if (keys.every(([, k]) => settled.has(k))) {
        // Loaded already, e.g. by `setLocale`: fulfilled from the start, so a switch never suspends.
        const value = Object.fromEntries(keys.map(([ns, k]) => [ns, settled.get(k)]));
        promise = Object.assign(Promise.resolve(value), { status: 'fulfilled', value });
      } else {
        promise = fetchTranslations(list, locale, key);
        void track(promise);
      }
      translations.set(key, promise);
    }
    return promise;
  };

  return {
    get locale() {
      return current;
    },
    locales,
    load: (namespaces) => load(namespaces, current) as never,
    async setLocale(locale) {
      assertLocale(locale);
      switchToken += 1;
      const token = switchToken;
      await Promise.all([...loaded].map(async (ns) => accessor(ns, locale)));
      if (token !== switchToken || locale === current) {
        return;
      }
      current = locale;
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
  };
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
