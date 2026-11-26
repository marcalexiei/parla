import { createRuntime } from './runtime.ts';
import type { MessageFunction, MessageRuntime, WrapRich } from './runtime.ts';

export {
  createRuntime,
  type MessageFunction,
  type MessageRuntime,
  type RuntimeExtensions,
  type SelectorValue,
  type WrapRich,
} from './runtime.ts';

/*
 * Augmented by generated code, one member per name. Several generated files (a package's
 * `parla types`, the app's `parla build`) add to the same registry instead of replacing it.
 * Do not augment them by hand.
 */
// oxlint-disable-next-line typescript/no-empty-object-type -- the augmentation target
export interface LocaleRegistry {}
// Ambient, so `noUnusedLocals` allows `Node`, which only augmentations use.
// oxlint-disable-next-line typescript/no-empty-object-type, no-unused-vars -- the augmentation target
export declare interface NamespaceRegistry<Node> {}
// oxlint-disable-next-line typescript/no-empty-object-type -- the augmentation target
export interface FunctionRegistry {}
// oxlint-disable-next-line typescript/no-empty-object-type -- the augmentation target
export interface MarkupRegistry {}

/** Every locale a generated catalog declares; `string` before any is registered. */
export type Locale = [keyof LocaleRegistry] extends [never]
  ? string
  : Extract<keyof LocaleRegistry, string>;
/* oxlint-disable typescript/no-generated-empty-object-type -- empty until generated types augment it */
/** `Node`: what a message with markup returns, `ReactNode` with `@parlajs/react`. */
export type Namespaces<Node = string> = [keyof NamespaceRegistry<Node>] extends [never]
  ? Record<string, object>
  : NamespaceRegistry<Node>;
/* oxlint-enable typescript/no-generated-empty-object-type */
export type Namespace = keyof Namespaces;
/** The config's `functions`: each needs an implementation in `createParla({ functions })`. */
export type FunctionName = Extract<keyof FunctionRegistry, string>;
/** The config's `markup`: each needs a renderer in `createParla({ markup })`. */
export type MarkupName = Extract<keyof MarkupRegistry, string>;

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

/** A catalog, or the locales of the catalogs `register` adds later. */
type CatalogOptions =
  | { catalog: Catalog }
  | { catalog?: undefined; locales: ReadonlyArray<Locale>; sourceLocale: Locale };

interface BaseOptions<Node> {
  /** Initial locale. Defaults to the source locale. */
  locale?: Locale;
  /** Turns message parts with markup into one node. Set by framework adapters. */
  wrapRich?: WrapRich<Node>;
}

/** Required, with every declared name, once the config declares any. */
type Declared<K extends string, Name extends string, V> = [Name] extends [never]
  ? Partial<Record<K, undefined>>
  : Record<K, Readonly<Record<Name, V>>>;

// `Node` is inferred from `wrapRich` alone, so a renderer returning another type is an error.
export type ParlaOptions<Node = string> = CatalogOptions &
  BaseOptions<Node> &
  Declared<'functions', FunctionName, MessageFunction> &
  Declared<'markup', MarkupName, (children: NoInfer<Node>) => NoInfer<Node>>;

/** Messages keyed by namespace: `t.checkout.title()`. Holding one proves its namespaces loaded. */
export type Translations<NS extends Namespace, Node = string> = {
  readonly [K in NS]: Namespaces<Node>[K];
};

export interface Parla<Node = string> {
  readonly locale: Locale;
  readonly locales: ReadonlyArray<Locale>;
  /** Loads every namespace loaded so far for `locale`, then switches, so nothing suspends. */
  readonly setLocale: (locale: Locale) => Promise<void>;
  /**
   * Loads the namespaces for the current locale. The same list returns the same promise, carrying
   * `status` and `value` once settled, which React's `use()` reads without suspending. A failure
   * is returned for a second, then retried.
   */
  readonly load: <NS extends Namespace>(
    namespaces: ReadonlyArray<NS>,
  ) => Promise<Translations<NS, Node>>;
  /** Called after each locale switch. */
  readonly subscribe: (listener: () => void) => () => void;
  /** Adds a catalog's namespaces; one already registered keeps its loaders. Same locales only. */
  readonly register: (catalog: Catalog) => void;
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

/** Rich text is a `string` unless `wrapRich` says otherwise: every part is then text. */
export function createParla<Node = string>(options: ParlaOptions<Node>): Parla<Node> {
  const { wrapRich } = options;
  const { locales, sourceLocale } = options.catalog ?? options;
  const extensions = {
    functions: options.functions as Readonly<Record<string, MessageFunction>> | undefined,
    markup: options.markup as Readonly<Record<string, (children: unknown) => unknown>> | undefined,
  };
  const registered = new Map<string, Readonly<Record<string, Loader>>>();
  let current: Locale = options.locale ?? sourceLocale;
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
      rt = createRuntime(locale, wrapRich as WrapRich<unknown> | undefined, extensions);
      runtimes.set(locale, rt);
    }
    return rt;
  };

  const fetchAccessor = async (
    namespace: string,
    locale: string,
    key: string,
  ): Promise<unknown> => {
    const loader = registered.get(namespace)?.[locale];
    if (!loader) {
      throw new Error(`[parla] unknown namespace "${namespace}" for locale "${locale}"`);
    }
    const mod = await loader();
    const value = mod.default(runtime(locale));
    settled.set(key, value);
    return value;
  };

  // After `set`: a failed download, or a namespace not registered yet, is retried on the next call.
  const forgetOnFailure = async (promise: Promise<unknown>, key: string): Promise<void> => {
    try {
      await promise;
    } catch {
      accessors.delete(key);
    }
  };

  // oxlint-disable-next-line typescript/promise-function-async -- the promise is cached
  const accessor = (namespace: string, locale: string): Promise<unknown> => {
    const key = `${locale}\u0000${namespace}`;
    let promise = accessors.get(key);
    if (!promise) {
      promise = fetchAccessor(namespace, locale, key);
      accessors.set(key, promise);
      void forgetOnFailure(promise, key);
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

  // Every namespace loaded so far, again until none is missing: one first loaded meanwhile is ready too.
  const loadAll = async (locale: Locale): Promise<void> => {
    const missing = [...loaded].filter((ns) => !settled.has(`${locale}\u0000${ns}`));
    if (missing.length === 0) {
      return;
    }
    await Promise.all(missing.map(async (ns) => accessor(ns, locale)));
    await loadAll(locale);
  };

  const register = (catalog: Catalog): void => {
    const same =
      catalog.sourceLocale === sourceLocale &&
      catalog.locales.length === locales.length &&
      catalog.locales.every((l) => locales.includes(l));
    if (!same) {
      throw new Error(
        `[parla] the catalog's locales ${catalog.locales.join(', ')} (source ${catalog.sourceLocale}) differ from ${locales.join(', ')} (source ${sourceLocale})`,
      );
    }
    for (const [ns, loaders] of Object.entries(catalog.namespaces)) {
      if (!registered.has(ns)) {
        registered.set(ns, loaders);
      }
    }
  };
  if (options.catalog) {
    register(options.catalog);
  }

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
      await loadAll(locale);
      if (token !== switchToken || locale === current) {
        return;
      }
      current = locale;
      for (const listener of listeners) {
        listener();
      }
    },
    register,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** `zh-TW` → `zh-Hant-TW`: the likely script and region, to compare tags that omit them. */
function maximize(tag: string): Intl.Locale | undefined {
  try {
    return new Intl.Locale(tag).maximize();
  } catch {
    return undefined;
  }
}

/** Picks the best supported locale from a preference list such as `navigator.languages`. */
export function matchLocale<L extends string>(
  requested: ReadonlyArray<string>,
  supported: ReadonlyArray<L>,
  fallback: L,
): L {
  const candidates = supported.map((tag) => ({ tag, locale: maximize(tag) }));
  for (const req of requested) {
    const exact = supported.find((l) => l.toLowerCase() === req.toLowerCase());
    if (exact !== undefined) {
      return exact;
    }
    const want = maximize(req);
    if (!want) {
      continue;
    }
    // Same language; then the same script (zh-Hant ≠ zh-Hans) outranks the same region.
    let best: { tag: L; score: number } | undefined;
    for (const { tag, locale } of candidates) {
      if (locale?.language === want.language) {
        const score =
          (locale.script === want.script ? 2 : 0) + (locale.region === want.region ? 1 : 0);
        if (!best || score > best.score) {
          best = { tag, score };
        }
      }
    }
    if (best) {
      return best.tag;
    }
  }
  return fallback;
}
