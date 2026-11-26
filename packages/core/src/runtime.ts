/** Selector value computed at runtime: numeric (exact + plural category) or string. */
export type SelectorValue = { n: number; cat: string } | { s: string };

/** Helpers compiled messages call. One instance per locale. */
export interface MessageRuntime {
  readonly locale: string;
  /** Formats a value with no function annotation. */
  str(value: unknown): string;
  /** Formats `value` with a message function (`number`, `date`, …). */
  f(name: string, value: unknown, options?: Record<string, unknown>): string;
  /** Numeric selector. */
  sn(value: unknown, options?: Record<string, unknown>): SelectorValue;
  /** String selector. */
  ss(value: unknown): SelectorValue;
  /** Index of the best matching variant; `null` keys are catch-alls. */
  pick(selectors: SelectorValue[], variants: ReadonlyArray<ReadonlyArray<string | null>>): number;
  /** Calls the markup callback `name` from params with its children. */
  tag(params: Record<string, unknown>, name: string, children: unknown[]): unknown;
  /** Joins message parts: a string when every part is text, otherwise the adapter's rich node. */
  rich(parts: unknown[]): unknown;
}

export type WrapRich = (parts: unknown[]) => unknown;

const NUMBER_FNS = new Set(['number', 'integer', 'currency', 'percent', 'unit']);
const DATE_FNS = new Set(['date', 'time', 'datetime']);
const DATE_FIELDS = [
  'weekday', 'era', 'year', 'month', 'day', 'hour', 'minute', 'second',
  'fractionalSecondDigits', 'timeZoneName', 'timeZone', 'hour12', 'hourCycle', 'calendar', 'numberingSystem',
] as const;
const TIME_PRECISION: Record<string, Intl.DateTimeFormatOptions> = {
  hour: { hour: 'numeric' },
  minute: { timeStyle: 'short' },
  second: { timeStyle: 'medium' },
};

function numberOptions(name: string, o: Record<string, unknown>): Intl.NumberFormatOptions {
  const { select: _s, offset: _o, ...rest } = o;
  const opts = rest as Intl.NumberFormatOptions;
  if (name === 'integer') return { ...opts, maximumFractionDigits: 0 };
  if (name === 'currency') return { ...opts, style: 'currency' };
  if (name === 'percent') return { ...opts, style: 'percent' };
  if (name === 'unit') return { ...opts, style: 'unit' };
  return opts;
}

function dateOptions(name: string, o: Record<string, unknown>): Intl.DateTimeFormatOptions {
  const opts: Intl.DateTimeFormatOptions = {};
  for (const k of DATE_FIELDS) if (o[k] !== undefined) (opts as Record<string, unknown>)[k] = o[k];
  const hasFields = DATE_FIELDS.some((k) => k !== 'timeZone' && k !== 'calendar' && k !== 'numberingSystem' && o[k] !== undefined);
  if (hasFields) return opts;
  const style = (o.style ?? o.length) as Intl.DateTimeFormatOptions['dateStyle'];
  if (name === 'date') return { ...opts, dateStyle: style ?? 'medium' };
  if (name === 'time') {
    if (typeof o.precision === 'string' && TIME_PRECISION[o.precision]) return { ...opts, ...TIME_PRECISION[o.precision] };
    return { ...opts, timeStyle: style ?? 'short' };
  }
  return {
    ...opts,
    dateStyle: (o.dateStyle ?? o.dateLength ?? style ?? 'medium') as Intl.DateTimeFormatOptions['dateStyle'],
    timeStyle: (o.timeStyle ?? 'short') as Intl.DateTimeFormatOptions['timeStyle'],
  };
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(value as string | number);
}

export function createRuntime(locale: string, wrapRich: WrapRich = (parts) => parts): MessageRuntime {
  const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat | Intl.PluralRules>();
  const cached = <T extends Intl.NumberFormat | Intl.DateTimeFormat | Intl.PluralRules>(key: string, make: () => T): T => {
    let hit = cache.get(key) as T | undefined;
    if (!hit) cache.set(key, (hit = make()));
    return hit;
  };
  const defaultNumber = new Intl.NumberFormat(locale);
  const defaultDate = new Intl.DateTimeFormat(locale);

  const rt: MessageRuntime = {
    locale,
    str(value) {
      if (typeof value === 'number' || typeof value === 'bigint') return defaultNumber.format(value);
      if (value instanceof Date) return defaultDate.format(value);
      return value == null ? '' : String(value);
    },
    f(name, value, options = {}) {
      const key = name + JSON.stringify(options);
      if (NUMBER_FNS.has(name)) {
        const n = Number(value) - Number(options.offset ?? 0);
        return cached(key, () => new Intl.NumberFormat(locale, numberOptions(name, options))).format(n);
      }
      if (DATE_FNS.has(name)) {
        return (cached(key, () => new Intl.DateTimeFormat(locale, dateOptions(name, options))) as Intl.DateTimeFormat).format(toDate(value));
      }
      if (name === 'string') return value == null ? '' : String(value);
      throw new Error(`[parla] unknown message function :${name}`);
    },
    sn(value, options = {}) {
      const n = Number(value);
      if (options.select === 'exact') return { n, cat: '' };
      const type = options.select === 'ordinal' ? 'ordinal' : 'cardinal';
      const rules = cached(`plural:${type}`, () => new Intl.PluralRules(locale, { type })) as Intl.PluralRules;
      return { n, cat: rules.select(n - Number(options.offset ?? 0)) };
    },
    ss(value) {
      return { s: value == null ? '' : String(value) };
    },
    pick(selectors, variants) {
      let best = -1;
      let bestRank: number[] | undefined;
      variants.forEach((keys, i) => {
        const rank: number[] = [];
        for (let j = 0; j < keys.length; j++) {
          const key = keys[j];
          const sel = selectors[j]!;
          if (key === null) rank.push(2);
          else if ('s' in sel) {
            if (key !== sel.s) return;
            rank.push(0);
          } else if (key !== '' && !Number.isNaN(Number(key)) && Number(key) === sel.n) rank.push(0);
          else if (key === sel.cat) rank.push(1);
          else return;
        }
        if (!bestRank || rank.some((r, k) => r !== bestRank![k] && r < bestRank![k]! && rank.slice(0, k).every((x, y) => x === bestRank![y]))) {
          best = i;
          bestRank = rank;
        }
      });
      return best === -1 ? variants.length - 1 : best;
    },
    tag(params, name, children) {
      const cb = params[name];
      const inner = rt.rich(children);
      return typeof cb === 'function' ? cb(inner) : inner;
    },
    rich(parts) {
      return parts.every((p) => typeof p === 'string') ? parts.join('') : wrapRich(parts);
    },
  };
  return rt;
}
