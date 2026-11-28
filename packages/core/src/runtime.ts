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

export type WrapRich<Node> = (parts: Array<Node | string>) => Node;

/** A message function beyond the built-in ones, declared in the config's `functions`. */
export type MessageFunction = (input: MessageFunctionInput) => string;

/** A call's value and options, `{$x :name opt=…}`, and its locale. */
export interface MessageFunctionInput {
  readonly value: unknown;
  readonly options: Readonly<Record<string, unknown>>;
  readonly locale: string;
  /** `locale` then its fallbacks: pass it to `Intl`, which may lack `locale`. */
  readonly locales: ReadonlyArray<string>;
}

/** Renders markup that a call does not pass a callback for, declared in the config's `markup`. */
type MarkupRenderer = (children: unknown) => unknown;

export interface RuntimeOptions {
  readonly wrapRich?: WrapRich<unknown> | undefined;
  readonly functions?: Readonly<Record<string, MessageFunction>> | undefined;
  readonly markup?: Readonly<Record<string, MarkupRenderer>> | undefined;
  /** Locales `Intl` tries when it has no data for `locale`, such as `fur` in browsers. */
  readonly fallbacks?: ReadonlyArray<string> | undefined;
  /** Dates' zone unless a message sets its own; the host's when omitted. */
  readonly timeZone?: string | undefined;
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

const NUMBER_STYLE: Record<string, Intl.NumberFormatOptions> = {
  integer: { maximumFractionDigits: 0 },
  currency: { style: 'currency' },
  percent: { style: 'percent' },
  unit: { style: 'unit' },
};

function numberOptions(name: string, options: Record<string, unknown>): Intl.NumberFormatOptions {
  const { select: _select, offset: _offset, ...rest } = options;
  return { ...rest, ...NUMBER_STYLE[name] };
}

function dateOptions(
  name: string,
  options: Record<string, unknown>,
  zone: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormatOptions {
  const opts: Intl.DateTimeFormatOptions = { ...zone };
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

/**
 * Each key ranks exact match 0, plural category 1, catch-all 2, read as base-3 digits so the first
 * differing key decides; `Infinity` when a key does not match.
 */
function scoreOf(
  keys: ReadonlyArray<string | null>,
  selectors: ReadonlyArray<SelectorValue>,
): number {
  let score = 0;
  // Indexed loops: `entries()` measured 2–5× slower in this hot path.
  for (let j = 0; j < keys.length; j += 1) {
    const key = keys[j];
    const sel = selectors[j];
    let rank: number;
    if (key === null) {
      rank = 2;
    } else if (!sel) {
      return Infinity;
    } else if ('s' in sel) {
      if (key !== sel.s) {
        return Infinity;
      }
      rank = 0;
    } else if (key === sel.cat) {
      rank = 1;
      // A letter starts a category, never a number: parsing costs more than the rest of `pick`.
    } else if ((key?.codePointAt(0) ?? 65) < 65 && Number(key) === sel.n) {
      rank = 0;
    } else {
      return Infinity;
    }
    score = score * 3 + rank;
  }
  return score;
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(value as string | number);
}

const NO_OPTIONS: Readonly<Record<string, unknown>> = Object.freeze({});

type IntlName = 'NumberFormat' | 'DateTimeFormat' | 'PluralRules';

/** Hermes (React Native) lacks `PluralRules`: name the polyfill, not "not a constructor". */
function intl<K extends IntlName>(name: K): (typeof Intl)[K] {
  const ctor = typeof Intl === 'undefined' ? undefined : Intl[name];
  if (typeof ctor !== 'function') {
    const pkg = `@formatjs/intl-${name.toLowerCase()}`;
    throw new Error(`[parla] Intl.${name} is missing: import a polyfill such as ${pkg} first`);
  }
  return ctor;
}

type Format = (value: number | bigint) => string;

/** Formatters kept per constructor. A catalog's constant options need far fewer. */
const CACHE_SIZE = 256;
/** Results kept per formatter: a re-render formats the same counts and dates again. */
const MEMO_SIZE = 128;

function memo(format: Format): Format {
  const seen = new Map<number | bigint, string>();
  return (value) => {
    // -0 formats as "-0", but a `Map` keys it as 0.
    if (Object.is(value, -0)) {
      return format(value);
    }
    let out = seen.get(value);
    if (out === undefined) {
      out = format(value);
      if (seen.size < MEMO_SIZE) {
        seen.set(value, out);
      }
    }
    return out;
  };
}

// Shared by every runtime, as a server's instance per request would build its own; by constructor,
// so a polyfill installed later gets its own.
const formats = new WeakMap<object, Map<string, Format>>();

type Formatter = Intl.NumberFormat | Intl.DateTimeFormat | Intl.PluralRules;

function shared<K extends IntlName>(
  name: K,
  key: string,
  make: (ctor: (typeof Intl)[K]) => Formatter,
): Format {
  const ctor = intl(name);
  let cache = formats.get(ctor);
  if (!cache) {
    cache = new Map();
    formats.set(ctor, cache);
  }
  let hit = cache.get(key);
  if (!hit) {
    // Options bound to params (`minimumFractionDigits=$d`) make new keys: drop the oldest.
    const [oldest] = cache.keys();
    if (cache.size >= CACHE_SIZE && oldest !== undefined) {
      cache.delete(oldest);
    }
    const made = make(ctor);
    hit = memo((v) => ('select' in made ? made.select(v as number) : made.format(v as number)));
    cache.set(key, hit);
  }
  return hit;
}

const asParts: WrapRich<unknown> = (parts) => parts;

export function createRuntime(
  locale: string,
  { wrapRich = asParts, fallbacks = [], timeZone, ...extensions }: RuntimeOptions = {},
): MessageRuntime {
  const tags = [locale, ...fallbacks];
  const zone: Intl.DateTimeFormatOptions = timeZone === undefined ? {} : { timeZone };
  const scope = `${tags.join(',')}\u0000${timeZone ?? ''}\u0000`;
  const functions = new Map(Object.entries(extensions.functions ?? {}));
  const markup = new Map(Object.entries(extensions.markup ?? {}));

  // Hoisted constant options and `NO_OPTIONS` are one object each: found by identity, no key built.
  const byOptions = new WeakMap<object, Map<string, Format>>();
  const formatter = <K extends IntlName>(
    ctor: K,
    name: string,
    options: Readonly<Record<string, unknown>>,
    make: (ctor: (typeof Intl)[K]) => Formatter,
  ): Format => {
    let named = byOptions.get(options);
    let hit = named?.get(name);
    if (!hit) {
      hit = shared(ctor, scope + name + JSON.stringify(options), make);
      if (!named) {
        named = new Map();
        byOptions.set(options, named);
      }
      named.set(name, hit);
    }
    return hit;
  };
  const numbers = (name: string, options: Readonly<Record<string, unknown>>): Format =>
    formatter('NumberFormat', name, options, (NF) => new NF(tags, numberOptions(name, options)));

  const rt: MessageRuntime = {
    locale,
    str(value) {
      if (typeof value === 'number' || typeof value === 'bigint') {
        const nf = numbers('number', NO_OPTIONS);
        if (typeof value === 'number') {
          return nf(value);
        }
        try {
          return nf(value);
        } catch {
          // Hermes formats numbers only: plain digits beat a rounded number.
          return value.toString();
        }
      }
      if (value instanceof Date) {
        return formatter(
          'DateTimeFormat',
          '',
          NO_OPTIONS,
          (DTF) => new DTF(tags, zone),
        )(value.getTime());
      }
      return text(value);
    },
    f(name, value, options = NO_OPTIONS) {
      if (NUMBER_FNS.has(name)) {
        return numbers(name, options)(Number(value) - Number(options['offset'] ?? 0));
      }
      if (DATE_FNS.has(name)) {
        return formatter(
          'DateTimeFormat',
          name,
          options,
          (DTF) => new DTF(tags, dateOptions(name, options, zone)),
        )(toDate(value).getTime());
      }
      if (name === 'string') {
        return text(value);
      }
      const custom = functions.get(name);
      if (custom) {
        return custom({ value, options, locale, locales: tags });
      }
      throw new Error(`[parla] unknown message function :${name}`);
    },
    sn(value, options = NO_OPTIONS) {
      const n = Number(value);
      if (options['select'] === 'exact') {
        return { n, cat: '' };
      }
      const type = options['select'] === 'ordinal' ? 'ordinal' : 'cardinal';
      const rules = formatter('PluralRules', type, NO_OPTIONS, (PR) => new PR(tags, { type }));
      return { n, cat: rules(n - Number(options['offset'] ?? 0)) };
    },
    ss(value) {
      return { s: text(value) };
    },
    pick(selectors, variants) {
      let best = variants.length - 1;
      let bestScore = Infinity;
      for (let i = 0; i < variants.length; i += 1) {
        const score = scoreOf(variants[i] ?? [], selectors);
        if (score < bestScore) {
          best = i;
          bestScore = score;
        }
      }
      return best;
    },
    tag(params, name, children) {
      const own = params[name];
      const cb = typeof own === 'function' ? (own as MarkupRenderer) : markup.get(name);
      const inner = rt.rich(children);
      return cb ? cb(inner) : inner;
    },
    rich(parts) {
      let joined = '';
      for (const part of parts) {
        if (typeof part !== 'string') {
          return wrapRich(parts);
        }
        joined += part;
      }
      return joined;
    },
  };
  return rt;
}
