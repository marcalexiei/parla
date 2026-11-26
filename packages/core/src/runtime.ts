/** Selector value computed at runtime: numeric (exact + plural category) or string. */
export type SelectorValue = { n: number; cat: string } | { s: string };

/** Helpers compiled messages call. One instance per locale. */
export interface MessageRuntime {
  readonly locale: string;
  /** Formats a value with no function annotation. */
  readonly str: (value: unknown) => string;
  /** Formats `value` with a message function (`number`, `date`, …). */
  readonly f: (name: string, value: unknown, options?: Record<string, unknown>) => string;
  /** Numeric selector. */
  readonly sn: (value: unknown, options?: Record<string, unknown>) => SelectorValue;
  /** String selector. */
  readonly ss: (value: unknown) => SelectorValue;
  /** Index of the best matching variant; `null` keys are catch-alls. */
  readonly pick: (
    selectors: Array<SelectorValue>,
    variants: ReadonlyArray<ReadonlyArray<string | null>>,
  ) => number;
  /** Calls the markup callback `name` from params with its children. */
  readonly tag: (
    params: Record<string, unknown>,
    name: string,
    children: Array<unknown>,
  ) => unknown;
  /** Joins message parts: a string when every part is text, otherwise the adapter's rich node. */
  readonly rich: (parts: Array<unknown>) => unknown;
}

export type WrapRich = (parts: Array<unknown>) => unknown;

/** A message function beyond the built-in ones, declared in the config's `functions`. */
export type MessageFunction = (
  value: unknown,
  options: Readonly<Record<string, unknown>>,
  locale: string,
) => string;

/** Renders markup that a call does not pass a callback for, declared in the config's `markup`. */
type MarkupRenderer = (children: unknown) => unknown;

export interface RuntimeExtensions {
  readonly functions?: Readonly<Record<string, MessageFunction>> | undefined;
  readonly markup?: Readonly<Record<string, MarkupRenderer>> | undefined;
}

const NUMBER_FNS = new Set(['number', 'integer', 'currency', 'percent', 'unit']);
const DATE_FNS = new Set(['date', 'time', 'datetime']);
const DATE_FIELDS = [
  'weekday',
  'era',
  'year',
  'month',
  'day',
  'hour',
  'minute',
  'second',
  'fractionalSecondDigits',
  'timeZoneName',
  'timeZone',
  'hour12',
  'hourCycle',
  'calendar',
  'numberingSystem',
] as const;
const TIME_PRECISION: Record<string, Intl.DateTimeFormatOptions> = {
  hour: { hour: 'numeric' },
  minute: { timeStyle: 'short' },
  second: { timeStyle: 'medium' },
};

function numberOptions(name: string, options: Record<string, unknown>): Intl.NumberFormatOptions {
  const { select: _select, offset: _offset, ...rest } = options;
  const opts = rest as Intl.NumberFormatOptions;
  if (name === 'integer') {
    return { ...opts, maximumFractionDigits: 0 };
  }
  if (name === 'currency') {
    return { ...opts, style: 'currency' };
  }
  if (name === 'percent') {
    return { ...opts, style: 'percent' };
  }
  if (name === 'unit') {
    return { ...opts, style: 'unit' };
  }
  return opts;
}

function dateOptions(name: string, options: Record<string, unknown>): Intl.DateTimeFormatOptions {
  const opts: Intl.DateTimeFormatOptions = {};
  for (const k of DATE_FIELDS) {
    if (options[k] !== undefined) {
      (opts as Record<string, unknown>)[k] = options[k];
    }
  }
  const hasFields = DATE_FIELDS.some(
    (k) =>
      k !== 'timeZone' && k !== 'calendar' && k !== 'numberingSystem' && options[k] !== undefined,
  );
  if (hasFields) {
    return opts;
  }
  const style = (options['style'] ?? options['length']) as Intl.DateTimeFormatOptions['dateStyle'];
  if (name === 'date') {
    return { ...opts, dateStyle: style ?? 'medium' };
  }
  if (name === 'time') {
    if (typeof options['precision'] === 'string' && TIME_PRECISION[options['precision']]) {
      return { ...opts, ...TIME_PRECISION[options['precision']] };
    }
    return { ...opts, timeStyle: style ?? 'short' };
  }
  return {
    ...opts,
    dateStyle: (options['dateStyle'] ??
      options['dateLength'] ??
      style ??
      'medium') as Intl.DateTimeFormatOptions['dateStyle'],
    timeStyle: (options['timeStyle'] ?? 'short') as Intl.DateTimeFormatOptions['timeStyle'],
  };
}

function text(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean' ||
    value instanceof Date
  ) {
    return value.toString();
  }
  return '';
}

/** Lexicographic: the first differing rank decides. */
function outranks(rank: ReadonlyArray<number>, best: ReadonlyArray<number>): boolean {
  for (const [k, r] of rank.entries()) {
    const b = best[k] ?? 2;
    if (r !== b) {
      return r < b;
    }
  }
  return false;
}

/** Exact match 0, plural category 1, catch-all 2; `undefined` when a key does not match. */
function rankOf(
  keys: ReadonlyArray<string | null>,
  selectors: ReadonlyArray<SelectorValue>,
): Array<number> | undefined {
  const rank: Array<number> = [];
  for (const [j, key] of keys.entries()) {
    const sel = selectors[j];
    if (key === null) {
      rank.push(2);
    } else if (!sel) {
      return undefined;
    } else if ('s' in sel) {
      if (key !== sel.s) {
        return undefined;
      }
      rank.push(0);
    } else if (key !== '' && Number(key) === sel.n) {
      rank.push(0);
    } else if (key === sel.cat) {
      rank.push(1);
    } else {
      return undefined;
    }
  }
  return rank;
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(value as string | number);
}

/** Formatters kept per locale. A catalog's constant options need far fewer. */
const CACHE_SIZE = 256;

export function createRuntime(
  locale: string,
  wrapRich: WrapRich = (parts) => parts,
  extensions: RuntimeExtensions = {},
): MessageRuntime {
  const { functions = {}, markup = {} } = extensions;
  const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat | Intl.PluralRules>();
  const cached = <T extends Intl.NumberFormat | Intl.DateTimeFormat | Intl.PluralRules>(
    key: string,
    make: () => T,
  ): T => {
    let hit = cache.get(key) as T | undefined;
    if (!hit) {
      // Options bound to params (`minimumFractionDigits=$d`) make new keys: drop the oldest.
      const [oldest] = cache.keys();
      if (cache.size >= CACHE_SIZE && oldest !== undefined) {
        cache.delete(oldest);
      }
      cache.set(key, (hit = make()));
    }
    return hit;
  };

  const rt: MessageRuntime = {
    locale,
    str(value) {
      if (typeof value === 'number' || typeof value === 'bigint') {
        return cached('n', () => new Intl.NumberFormat(locale)).format(value);
      }
      if (value instanceof Date) {
        return cached('d', () => new Intl.DateTimeFormat(locale)).format(value);
      }
      return text(value);
    },
    f(name, value, options = {}) {
      const key = name + JSON.stringify(options);
      if (NUMBER_FNS.has(name)) {
        const n = Number(value) - Number(options['offset'] ?? 0);
        return cached(
          key,
          () => new Intl.NumberFormat(locale, numberOptions(name, options)),
        ).format(n);
      }
      if (DATE_FNS.has(name)) {
        return cached(
          key,
          () => new Intl.DateTimeFormat(locale, dateOptions(name, options)),
        ).format(toDate(value));
      }
      if (name === 'string') {
        return text(value);
      }
      const custom = Object.hasOwn(functions, name) ? functions[name] : undefined;
      if (custom) {
        return custom(value, options, locale);
      }
      throw new Error(`[parla] unknown message function :${name}`);
    },
    sn(value, options = {}) {
      const n = Number(value);
      if (options['select'] === 'exact') {
        return { n, cat: '' };
      }
      const type = options['select'] === 'ordinal' ? 'ordinal' : 'cardinal';
      const rules = cached(`plural:${type}`, () => new Intl.PluralRules(locale, { type }));
      return { n, cat: rules.select(n - Number(options['offset'] ?? 0)) };
    },
    ss(value) {
      return { s: text(value) };
    },
    pick(selectors, variants) {
      let best = -1;
      let bestRank: Array<number> | undefined;
      for (const [i, keys] of variants.entries()) {
        const rank = rankOf(keys, selectors);
        if (rank && (!bestRank || outranks(rank, bestRank))) {
          best = i;
          bestRank = rank;
        }
      }
      return best === -1 ? variants.length - 1 : best;
    },
    tag(params, name, children) {
      const own = params[name];
      let cb = typeof own === 'function' ? (own as MarkupRenderer) : undefined;
      if (!cb && Object.hasOwn(markup, name)) {
        cb = markup[name];
      }
      const inner = rt.rich(children);
      return cb ? cb(inner) : inner;
    },
    rich(parts) {
      return parts.every((p) => typeof p === 'string') ? parts.join('') : wrapRich(parts);
    },
  };
  return rt;
}
