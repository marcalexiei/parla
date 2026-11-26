import { createRuntime, type MessageRuntime, type WrapRich } from './runtime.js';

export { createRuntime, type MessageRuntime, type SelectorValue, type WrapRich } from './runtime.js';

/**
 * Augmented by generated code (`locale`, `namespaces`) and by framework adapters (`richNode`).
 * Do not augment it by hand.
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmentation target
export interface Register {}

type Registered<K extends string, Fallback> = Register extends Record<K, infer V> ? V : Fallback;

export type Locale = Registered<'locale', string>;
export type Namespaces = Registered<'namespaces', Record<string, any>>;
export type Namespace = keyof Namespaces & string;
/** What a message with markup returns: `ReactNode` with `@parlajs/react`. */
export type RichNode = Registered<'richNode', unknown>;

export type CompiledMessage = (params: Record<string, unknown>, rt: MessageRuntime) => unknown;
export type MessageModule = { default: Record<string, CompiledMessage> };
export type Loader = () => Promise<MessageModule>;

/** Emitted by `parla build` as `catalog.js`. */
export interface Catalog {
  readonly locales: readonly string[];
  readonly sourceLocale: string;
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
  readonly locales: readonly Locale[];
  /** Loads every namespace in use for `locale`, then switches, so nothing suspends. */
  setLocale(locale: Locale): Promise<void>;
  /** Loads a namespace once per locale. Returns the same promise on every call. */
  load<N extends Namespace>(namespace: N, locale?: Locale): Promise<Namespaces[N]>;
  /** The accessor if the namespace is loaded for the current locale. */
  getT<N extends Namespace>(namespace: N): Namespaces[N] | undefined;
  /** Loads namespaces ahead of render, e.g. on the server or before hydration. */
  preload(namespaces: readonly Namespace[], locale?: Locale): Promise<void>;
  subscribe(listener: () => void): () => void;
  getSnapshot(): Snapshot;
}

const INSTANCE = Symbol.for('parlajs.core');
const marker = {};
const g = globalThis as { [INSTANCE]?: object };
if (g[INSTANCE] && g[INSTANCE] !== marker) {
  console.warn('[parla] Several copies of @parlajs/core are loaded. Make it a peerDependency so adapters share one instance.');
}
g[INSTANCE] = marker;

function buildAccessor(messages: Record<string, CompiledMessage>, rt: MessageRuntime): unknown {
  const root: Record<string, any> = {};
  for (const [key, fn] of Object.entries(messages)) {
    const path = key.split('.');
    let node = root;
    for (const segment of path.slice(0, -1)) node = node[segment] ??= {};
    node[path.at(-1)!] = (params?: Record<string, unknown>) => fn(params ?? {}, rt);
  }
  return root;
}

export function createParla(options: ParlaOptions): Parla {
  const { catalog, wrapRich } = options;
  const locales = catalog.locales as readonly Locale[];
  let snapshot: Snapshot = { locale: (options.locale ?? catalog.sourceLocale) as Locale };
  const listeners = new Set<() => void>();
  const runtimes = new Map<string, MessageRuntime>();
  const promises = new Map<string, Promise<unknown>>();
  const accessors = new Map<string, unknown>();
  const used = new Set<string>();
  let switchToken = 0;

  const assertLocale = (locale: string) => {
    if (!catalog.locales.includes(locale)) throw new Error(`[parla] unknown locale "${locale}". Known: ${catalog.locales.join(', ')}`);
  };
  assertLocale(snapshot.locale);

  const runtime = (locale: string) => {
    let rt = runtimes.get(locale);
    if (!rt) runtimes.set(locale, (rt = createRuntime(locale, wrapRich)));
    return rt;
  };

  const parla: Parla = {
    get locale() {
      return snapshot.locale;
    },
    locales,
    load(namespace, locale = snapshot.locale) {
      const key = `${locale}\u0000${namespace}`;
      used.add(namespace);
      let promise = promises.get(key);
      if (!promise) {
        const loader = catalog.namespaces[namespace]?.[locale];
        promise = loader
          ? loader().then((mod) => {
              const accessor = buildAccessor(mod.default, runtime(locale));
              accessors.set(key, accessor);
              return accessor;
            })
          : Promise.reject(new Error(`[parla] unknown namespace "${namespace}" for locale "${locale}"`));
        promise.catch(() => promises.delete(key));
        promises.set(key, promise);
      }
      return promise as Promise<any>;
    },
    getT(namespace) {
      used.add(namespace);
      return accessors.get(`${snapshot.locale}\u0000${namespace}`) as any;
    },
    async preload(namespaces, locale = snapshot.locale) {
      await Promise.all(namespaces.map((ns) => parla.load(ns, locale)));
    },
    async setLocale(locale) {
      assertLocale(locale);
      const token = ++switchToken;
      await parla.preload([...used] as Namespace[], locale);
      if (token !== switchToken || locale === snapshot.locale) return;
      snapshot = { locale };
      for (const l of listeners) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
  };
  return parla;
}

/** Picks the best supported locale from a preference list such as `navigator.languages`. */
export function matchLocale<L extends string>(requested: readonly string[], supported: readonly L[], fallback: L): L {
  const lower = supported.map((l) => l.toLowerCase());
  for (const req of requested) {
    const r = req.toLowerCase();
    const exact = lower.indexOf(r);
    if (exact !== -1) return supported[exact]!;
    const base = lower.findIndex((l) => l === r.split('-')[0] || l.split('-')[0] === r.split('-')[0]);
    if (base !== -1) return supported[base]!;
  }
  return fallback;
}
