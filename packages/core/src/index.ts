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
 * Augmented by generated code, one member per name, so several generated files add up instead of
 * clashing. Do not augment them by hand.
 */
// oxlint-disable-next-line typescript/no-empty-object-type -- the augmentation target
export interface LocaleRegistry {}
// oxlint-disable-next-line typescript/no-empty-object-type -- the augmentation target
export interface FunctionRegistry {}
// oxlint-disable-next-line typescript/no-empty-object-type -- the augmentation target
export interface MarkupRegistry {}

/** Every locale a generated catalog declares; `string` before any is registered. */
export type Locale = [keyof LocaleRegistry] extends [never]
  ? string
  : Extract<keyof LocaleRegistry, string>;
/** The config's `functions`: each needs an implementation in `createParla({ functions })`. */
export type FunctionName = Extract<keyof FunctionRegistry, string>;
/** The config's `markup`: each needs a renderer in `createParla({ markup })`. */
export type MarkupName = Extract<keyof MarkupRegistry, string>;

/** A message without params or markup, shared so a catalog of them builds one type. */
export type Text = () => string;

/** A compiled chunk: called once per locale with its runtime, it returns the namespace's accessor. */
export type MessageFactory = (rt: MessageRuntime) => unknown;
export interface MessageModule {
  default: MessageFactory;
}
export type Loader = () => Promise<MessageModule>;

/**
 * A namespace's messages. A generated kind with markup reads `this['node']`, so one namespace types
 * a React and a string instance differently.
 */
export interface NamespaceKind {
  readonly node: unknown;
  readonly messages: unknown;
}

declare const kind: unique symbol;

/**
 * Emitted by `parla build` as `namespaces/<name>.js`: importing it is what makes it loadable. `L`
 * defaults to the app's locales, so `Namespace` is one built for at least those.
 */
export interface Namespace<
  Name extends string = string,
  Kind extends NamespaceKind = NamespaceKind,
  L extends string = Locale,
> {
  readonly name: Name;
  /** One chunk loader per locale it was built for. */
  readonly load: Readonly<Record<L, Loader>>;
  /** Types only, never set. */
  readonly [kind]?: Kind;
}

type MessagesOf<NS, Node> = NS extends { readonly [kind]?: infer K extends NamespaceKind }
  ? (K & { readonly node: Node })['messages']
  : never;

/** What the runtime reads of a namespace, whatever locales the app declares. */
interface Loadable {
  readonly name: string;
  readonly load: Readonly<Record<string, Loader>>;
}

// A missed lookup such as `{ checkout }[name]` passes `undefined`, which must fail before it is read.
const isLoadable = (value: unknown): value is Loadable => {
  const ns = value as { name?: unknown; load?: unknown } | null;
  return (
    typeof ns === 'object' &&
    ns !== null &&
    typeof ns.name === 'string' &&
    typeof ns.load === 'object' &&
    ns.load !== null
  );
};

const describe = (value: unknown): string => {
  if (typeof value === 'object' && value !== null) {
    return 'an object without name and load';
  }
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
};

/** Emitted by `parla build` as `catalog.js`. */
export interface Catalog {
  readonly locales: ReadonlyArray<Locale>;
  readonly sourceLocale: Locale;
}

/** Required, with every declared name, once the config declares any. */
type Declared<K extends string, Name extends string, V> = [Name] extends [never]
  ? Partial<Record<K, undefined>>
  : Record<K, Readonly<Record<Name, V>>>;

// `Node` is inferred from `wrapRich` alone, so a renderer returning another type is an error.
export type ParlaOptions<Node = string> = {
  catalog: Catalog;
  /** Initial locale. Defaults to the source locale. */
  locale?: Locale;
  /** Turns message parts with markup into one node. Set by framework adapters. */
  wrapRich?: WrapRich<Node>;
} & Declared<'functions', FunctionName, MessageFunction> &
  Declared<'markup', MarkupName, (children: NoInfer<Node>) => NoInfer<Node>>;

/**
 * Messages keyed by namespace name, `t.checkout.title()`: holding one proves its namespaces loaded.
 * `Node` is invariant because the kind hides it from TypeScript's variance check.
 */
export type Translations<NS extends Namespace, in out Node = string> = {
  readonly [N in NS as N['name']]: MessagesOf<N, Node>;
};

export interface Parla<Node = string> {
  readonly locale: Locale;
  readonly locales: ReadonlyArray<Locale>;
  /** Loads every namespace loaded so far for `locale`, then switches, so nothing suspends. */
  readonly setLocale: (locale: Locale) => Promise<void>;
  /**
   * Loads the namespaces for the current locale. The same list returns the same promise, carrying
   * `status` and `value` once settled, which React's `use()` reads without suspending. A failure
   * is returned for a second, then retried. Throws at once for a namespace missing a locale.
   */
  readonly load: <NS extends Namespace>(
    namespaces: ReadonlyArray<NS>,
  ) => Promise<Translations<NS, Node>>;
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

/** Rich text is a `string` unless `wrapRich` says otherwise: every part is then text. */
export function createParla<Node = string>(options: ParlaOptions<Node>): Parla<Node> {
  const { wrapRich } = options;
  const { locales, sourceLocale } = options.catalog;
  const extensions = {
    functions: options.functions as Readonly<Record<string, MessageFunction>> | undefined,
    markup: options.markup as Readonly<Record<string, (children: unknown) => unknown>> | undefined,
  };
  const registered = new Map<string, Loadable>();
  let current: Locale = options.locale ?? sourceLocale;
  const listeners = new Set<() => void>();
  const runtimes = new Map<string, MessageRuntime>();
  const accessors = new Map<string, Promise<unknown>>();
  const settled = new Map<string, unknown>();
  const translations = new Map<string, Promise<object>>();
  const loaded = new Set<string>();
  let switchToken = 0;
  const warned = new Set<string>();

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
    // `adopt` checked every locale, and only adopted names reach here.
    const loader = registered.get(namespace)?.load[locale] as Loader;
    const mod = await loader();
    const value = mod.default(runtime(locale));
    settled.set(key, value);
    return value;
  };

  // After `set`: a failed download is retried on the next call.
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

  // A second object of one name is a second copy of its package: the first one's loaders win.
  const adopt = (ns: Loadable): string => {
    if (!isLoadable(ns)) {
      throw new TypeError(
        `[parla] load takes namespace objects, not ${describe(ns)}: import it from the generated namespaces/`,
      );
    }
    const known = registered.get(ns.name);
    if (known === ns) {
      return ns.name;
    }
    if (known) {
      if (!warned.has(ns.name)) {
        warned.add(ns.name);
        // oxlint-disable-next-line no-console -- two copies may hold different messages
        console.warn(
          `[parla] two namespace objects are named "${ns.name}"; the first is used. Is its package bundled twice?`,
        );
      }
      return ns.name;
    }
    const missing = locales.filter((l) => !Object.hasOwn(ns.load, l));
    if (missing.length > 0) {
      throw new Error(
        `[parla] namespace "${ns.name}" was built for ${Object.keys(ns.load).join(', ') || 'no locale'}, not ${missing.join(', ')}`,
      );
    }
    registered.set(ns.name, ns);
    return ns.name;
  };

  // oxlint-disable-next-line typescript/promise-function-async -- `use()` needs the cached promise itself
  const load = (namespaces: ReadonlyArray<Loadable>, locale: Locale): Promise<object> => {
    const list = [...new Set(namespaces.map((ns) => adopt(ns)))].toSorted();
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
