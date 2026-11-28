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
// Declared variance and no Readonly<Record> spare each program ~140 instantiations. `L` is not `in`:
// with no catalog, `Locale` is `string`, which any namespace's locales must still satisfy.
export interface Namespace<
  out Name extends string = string,
  out Kind extends NamespaceKind = NamespaceKind,
  L extends string = Locale,
> {
  readonly name: Name;
  /** One chunk loader per locale it was built for. */
  // oxlint-disable-next-line typescript/consistent-indexed-object-style -- Readonly<Record> costs ~50 more instantiations
  readonly load: { readonly [P in L]: Loader };
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
  /** Each locale's fallback chain, which `Intl` also follows where it lacks the locale's data. */
  readonly fallbacks?: Readonly<Partial<Record<string, ReadonlyArray<string>>>>;
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
  /**
   * IANA zone for `:date`, `:time` and `:datetime` unless a message sets `timeZone`. Defaults to the
   * host's, which on a server is rarely the reader's.
   */
  timeZone?: string;
  /** Turns message parts with markup into one node. Set by framework adapters. */
  wrapRich?: WrapRich<Node>;
} & Declared<'functions', FunctionName, MessageFunction> &
  Declared<'markup', MarkupName, (children: NoInfer<Node>) => NoInfer<Node>> &
  Escape<Node>;

// Only text output needs it: React escapes text itself, so escaping first would show `&lt;`.
type Escape<Node> = [Node] extends [string]
  ? {
      /** Escapes each param's text, e.g. `escapeHtml` in HTML emails; translations stay as written. */
      escape?: (text: string) => string;
    }
  : { escape?: never };

const ENTITIES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** For `createParla({ escape })` in HTML: the five characters i18next escapes too. */
export function escapeHtml(text: string): string {
  return text.replaceAll(/[&<>"']/g, (c) => ENTITIES[c] ?? c);
}

// Every param becomes text through `str` or `f`; translations and markup output never do.
const escaping = (rt: MessageRuntime, escape: (text: string) => string): MessageRuntime => ({
  ...rt,
  str: (value) => escape(rt.str(value)),
  f: (name, value, options) => escape(rt.f(name, value, options)),
});

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
  /**
   * `t`, if the namespaces are loaded for the current locale; never downloads. Frameworks without
   * Suspense render from it, and `load` otherwise. The same list returns the same `t` as `load`.
   */
  readonly loaded: <NS extends Namespace>(
    namespaces: ReadonlyArray<NS>,
  ) => Translations<NS, Node> | undefined;
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
  const { wrapRich, timeZone, escape } = options;
  const { locales, sourceLocale, fallbacks = {} } = options.catalog;
  const extensions = {
    functions: options.functions as Readonly<Record<string, MessageFunction>> | undefined,
    markup: options.markup as Readonly<Record<string, (children: unknown) => unknown>> | undefined,
  };
  // By object, not name: two packages may each own a `common`, and each `t` gets its own.
  const ids = new WeakMap<Loadable, number>();
  const registered = new Map<number, Loadable>();
  let current: Locale = options.locale ?? sourceLocale;
  const listeners = new Set<() => void>();
  const runtimes = new Map<string, MessageRuntime>();
  const accessors = new Map<string, Promise<unknown>>();
  const settled = new Map<string, unknown>();
  const translations = new Map<string, Promise<object>>();
  const loaded = new Set<number>();
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
      rt = createRuntime(
        locale,
        wrapRich as WrapRich<unknown> | undefined,
        extensions,
        fallbacks[locale],
        timeZone,
      );
      if (escape) {
        rt = escaping(rt, escape);
      }
      runtimes.set(locale, rt);
    }
    return rt;
  };

  const fetchAccessor = async (id: number, locale: string, key: string): Promise<unknown> => {
    // `adopt` checked every locale, and only adopted objects reach here.
    const loader = registered.get(id)?.load[locale] as Loader;
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
  const accessor = (id: number, locale: string): Promise<unknown> => {
    const key = `${locale}\u0000${id}`;
    let promise = accessors.get(key);
    if (!promise) {
      promise = fetchAccessor(id, locale, key);
      accessors.set(key, promise);
      void forgetOnFailure(promise, key);
    }
    return promise;
  };

  const fetchTranslations = async (
    list: ReadonlyArray<readonly [name: string, id: number]>,
    locale: string,
    key: string,
  ): Promise<object> => {
    try {
      const values = await Promise.all(list.map(async ([, id]) => accessor(id, locale)));
      return Object.fromEntries(list.map(([name], i) => [name, values[i]]));
    } catch (error) {
      // Kept a while so React's retry render reads the error instead of loading again.
      setTimeout(() => {
        translations.delete(key);
      }, RETRY_AFTER_MS);
      throw error;
    }
  };

  const adopt = (ns: Loadable): number => {
    if (!isLoadable(ns)) {
      throw new TypeError(
        `[parla] load takes namespace objects, not ${describe(ns)}: import it from the generated namespaces/`,
      );
    }
    let id = ids.get(ns);
    if (id === undefined) {
      const missing = locales.filter((l) => !Object.hasOwn(ns.load, l));
      if (missing.length > 0) {
        throw new Error(
          `[parla] namespace "${ns.name}" was built for ${Object.keys(ns.load).join(', ') || 'no locale'}, not ${missing.join(', ')}`,
        );
      }
      id = registered.size;
      ids.set(ns, id);
      registered.set(id, ns);
    }
    return id;
  };

  /** `[name, id]` per namespace, sorted by name: one cache key for any order. */
  const resolve = (namespaces: ReadonlyArray<Loadable>): Array<[name: string, id: number]> => {
    const byName = new Map<string, number>();
    for (const ns of namespaces) {
      const id = adopt(ns);
      if ((byName.get(ns.name) ?? id) !== id) {
        throw new Error(
          `[parla] two namespaces named "${ns.name}" in one load: t holds one per name`,
        );
      }
      byName.set(ns.name, id);
    }
    // Not `toSorted`: Hermes (React Native) lacks it, and the spread is a copy already.
    return [...byName].sort(([a], [b]) => a.localeCompare(b));
  };

  // oxlint-disable-next-line typescript/promise-function-async -- `use()` needs the cached promise itself
  const load = (
    list: ReadonlyArray<[name: string, id: number]>,
    locale: Locale,
  ): Promise<object> => {
    const key = `${locale}\u0000${list.map(([, id]) => id).join('\u0000')}`;
    let promise = translations.get(key);
    if (!promise) {
      for (const [, id] of list) {
        loaded.add(id);
      }
      const keys = list.map(([name, id]) => [name, `${locale}\u0000${id}`] as const);
      if (keys.every(([, k]) => settled.has(k))) {
        // Loaded already, e.g. by `setLocale`: fulfilled from the start, so a switch never suspends.
        const value = Object.fromEntries(keys.map(([name, k]) => [name, settled.get(k)]));
        promise = Object.assign(Promise.resolve(value), { status: 'fulfilled', value });
      } else {
        promise = fetchTranslations(list, locale, key);
        void track(promise);
      }
      translations.set(key, promise);
    }
    return promise;
  };

  // Before the namespaces settle, `load` would download them; after, it builds `t` from what settled.
  const loadedOf = (
    list: ReadonlyArray<[name: string, id: number]>,
    locale: Locale,
  ): object | undefined =>
    list.every(([, id]) => settled.has(`${locale}\u0000${id}`))
      ? (load(list, locale) as Promise<object> & { value?: object }).value
      : undefined;

  // Every namespace loaded so far, again until none is missing: one first loaded meanwhile is ready too.
  const loadAll = async (locale: Locale): Promise<void> => {
    const missing = [...loaded].filter((id) => !settled.has(`${locale}\u0000${id}`));
    if (missing.length === 0) {
      return;
    }
    await Promise.all(missing.map(async (id) => accessor(id, locale)));
    await loadAll(locale);
  };

  return {
    get locale() {
      return current;
    },
    locales,
    load: (namespaces) => load(resolve(namespaces), current) as never,
    loaded: (namespaces) => loadedOf(resolve(namespaces), current) as never,
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

interface Subtags {
  readonly language: string;
  readonly script?: string | undefined;
  readonly region?: string | undefined;
}

/** Without `Intl.Locale` (Hermes), the tag's own subtags: `en-US` still matches `en`. */
function subtags(tag: string): Subtags | undefined {
  const [language = '', ...rest] = tag.toLowerCase().split('-');
  if (!/^[a-z]{2,8}$/.test(language)) {
    return undefined;
  }
  return {
    language,
    script: rest.find((s) => /^[a-z]{4}$/.test(s)),
    region: rest.find((s) => /^(?:[a-z]{2}|\d{3})$/.test(s)),
  };
}

/** `zh-TW` → `zh-Hant-TW`: the likely script and region, to compare tags that omit them. */
function maximize(tag: string): Subtags | undefined {
  // Android reports `it_IT`, which `Intl.Locale` rejects.
  const bcp47 = tag.replaceAll('_', '-');
  try {
    return typeof Intl.Locale === 'function' ? new Intl.Locale(bcp47).maximize() : subtags(bcp47);
  } catch {
    return undefined;
  }
}

/**
 * Picks the best supported locale from a preference list such as `navigator.languages` or, in
 * React Native, `getLocales().map((l) => l.languageTag)` from `expo-localization`.
 */
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

/** RFC 9110's qvalue; spaces around `=` are tolerated. */
const QVALUE = /^q\s*=\s*(?<q>0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/i;

/**
 * The tags of an `Accept-Language` header, most wanted first, for `matchLocale`. Drops `*`, `q=0`
 * and invalid weights such as `q=1.5`; equal weights keep the header's order.
 */
export function parseAcceptLanguage(header: string | null | undefined): Array<string> {
  const weighted: Array<{ tag: string; q: number }> = [];
  for (const part of (header ?? '').split(',')) {
    const [tag = '', ...params] = part.split(';').map((s) => s.trim());
    const quality = params.find((param) => /^q(?:\s|=|$)/i.test(param));
    const weight = quality === undefined ? 1 : Number(QVALUE.exec(quality)?.groups?.['q'] ?? 0);
    if (tag !== '' && tag !== '*' && weight > 0) {
      weighted.push({ tag, q: weight });
    }
  }
  return weighted.sort((a, b) => b.q - a.q).map(({ tag }) => tag);
}
