import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { createRuntime } from '../src/runtime.ts';

const rt = createRuntime('en');
/** 21 × 21 distinct, valid number options */
const numberOptions = (n: number): Record<string, number> => ({
  minimumIntegerDigits: (n % 21) + 1,
  maximumFractionDigits: Math.floor(n / 21),
});
const when = new Date(Date.UTC(2026, 0, 15, 9, 30, 45));
const intl = (options: Intl.DateTimeFormatOptions): string =>
  new Intl.DateTimeFormat('en', options).format(when);

/** Stands in for an engine such as Hermes, where `Intl` lacks members. */
function stubIntl(members: Record<string, unknown>): void {
  const props = Object.fromEntries(Object.entries(members).map(([k, value]) => [k, { value }]));
  vi.stubGlobal('Intl', Object.create(Intl, props));
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });
}

/** Hermes' `NumberFormat`, which formats numbers only. Called with `new`. */
function HermesNumberFormat(): { format: (value: unknown) => string } {
  return {
    format: (value) => {
      if (typeof value === 'bigint') {
        throw new TypeError('Cannot convert BigInt to number');
      }
      return `#${String(value)}`;
    },
  };
}

describe(createRuntime, () => {
  it('formats unannotated values by type', () => {
    expect(rt.str('text')).toBe('text');
    expect(rt.str(1234.5)).toBe('1,234.5');
    expect(rt.str(12n)).toBe('12');
    expect(rt.str(when)).toBe(intl({}));
    expect(rt.str(null)).toBe('');
    expect(rt.str(undefined)).toBe('');
  });

  it('formats numbers with each number function', () => {
    expect(rt.f('integer', 2.4)).toBe('2');
    expect(rt.f('unit', 5, { unit: 'kilometer' })).toBe('5 km');
    expect(rt.f('number', 5, { offset: 1 })).toBe('4');
  });

  it('keeps a formatter per name and options, and a plural rule per type', () => {
    const fresh = createRuntime('en');
    expect(fresh.f('number', 1.5)).toBe('1.5');
    expect(fresh.f('number', 1.5, { maximumFractionDigits: 0 })).toBe('2');
    expect(fresh.f('integer', 1.5)).toBe('2');
    // the compiler hoists one object for every message with the same options
    const shared = { currency: 'EUR' };
    expect(fresh.f('currency', 1, shared)).toBe('€1.00');
    expect(fresh.f('number', 1, shared)).toBe('1');
    expect(fresh.sn(2, { select: 'ordinal' })).toStrictEqual({ n: 2, cat: 'two' });
    expect(fresh.sn(2)).toStrictEqual({ n: 2, cat: 'other' });
  });

  it('formats dates, honouring explicit fields over a style', () => {
    expect(rt.f('date', when, { year: 'numeric', style: 'full' })).toBe(intl({ year: 'numeric' }));
    expect(rt.f('time', when, { precision: 'second' })).toBe(intl({ timeStyle: 'medium' }));
    expect(rt.f('time', when, { style: 'medium' })).toBe(intl({ timeStyle: 'medium' }));
    expect(rt.f('datetime', when.getTime())).toBe(
      intl({ dateStyle: 'medium', timeStyle: 'short' }),
    );
    expect(rt.f('datetime', when, { dateLength: 'short', timeStyle: 'medium' })).toBe(
      intl({ dateStyle: 'short', timeStyle: 'medium' }),
    );
  });

  it('formats dates in its time zone unless a message sets its own', () => {
    // Nov 28 in Rome, still Nov 27 in Los Angeles
    const late = new Date(Date.UTC(2026, 10, 28, 3));
    const rome = createRuntime('en', { timeZone: 'Europe/Rome' });
    const inZone = (timeZone: string, options: Intl.DateTimeFormatOptions = {}): string =>
      new Intl.DateTimeFormat('en', { ...options, timeZone }).format(late);
    expect(rome.f('date', late)).toBe(inZone('Europe/Rome', { dateStyle: 'medium' }));
    expect(rome.f('date', late)).toContain('28');
    expect(rome.f('date', late, { timeZone: 'America/Los_Angeles' })).toContain('27');
    expect(rome.f('time', late, { hour: 'numeric' })).toBe(
      inZone('Europe/Rome', { hour: 'numeric' }),
    );
    expect(rome.str(late)).toBe(inZone('Europe/Rome'));
  });

  it('formats strings and rejects unknown functions', () => {
    expect(rt.f('string', true)).toBe('true');
    expect(rt.f('string', { a: 1 })).toBe('');
    expect(() => rt.f('sparkle', 1)).toThrow(/unknown message function :sparkle/);
  });

  it('picks exact matches over categories, and the last variant when nothing matches', () => {
    const variants = [['1'], ['one'], [null]];
    expect(rt.pick([rt.sn(1)], variants)).toBe(0);
    expect(rt.pick([rt.sn(1, { select: 'exact' })], [['one'], [null]])).toBe(1);
    expect(rt.pick([rt.ss('x')], [['a'], ['b']])).toBe(1);
    expect(rt.pick([], [['a']])).toBe(0);
  });

  it('lets the first differing key decide between variants, then the earlier variant', () => {
    const variants = [
      ['one', null],
      [null, 'x'],
      [null, null],
      ['one', null],
    ];
    expect(rt.pick([rt.sn(1), rt.ss('x')], variants)).toBe(0);
    expect(rt.pick([rt.sn(2), rt.ss('x')], variants)).toBe(1);
  });

  it('keeps a bounded formatter cache, dropping the oldest', () => {
    const fresh = createRuntime('en');
    const made = vi.spyOn(Intl, 'NumberFormat');
    onTestFinished(() => {
      made.mockRestore();
    });
    fresh.f('number', 1, numberOptions(0));
    fresh.f('number', 1, numberOptions(0));
    expect(made).toHaveBeenCalledTimes(1);
    for (let n = 1; n <= 300; n += 1) {
      fresh.f('number', 1, numberOptions(n));
    }
    made.mockClear();
    fresh.f('number', 1, numberOptions(0));
    expect(made).toHaveBeenCalledTimes(1);
  });

  it('shares formatters between runtimes of one locale, fallbacks and zone', () => {
    const numbers = vi.spyOn(Intl, 'NumberFormat');
    const dates = vi.spyOn(Intl, 'DateTimeFormat');
    onTestFinished(() => {
      numbers.mockRestore();
      dates.mockRestore();
    });
    createRuntime('en').str(1.5);
    createRuntime('en').f('number', 2.5);
    expect(numbers).toHaveBeenCalledTimes(1);
    expect(createRuntime('qaa', { fallbacks: ['it'] }).str(1.5)).toBe('1,5');
    expect(createRuntime('qaa').str(1.5)).not.toBe('1,5');
    expect(numbers).toHaveBeenCalledTimes(3);

    // Nov 28 in Rome, still Nov 27 in Los Angeles
    const late = new Date(Date.UTC(2026, 10, 28, 3));
    expect(createRuntime('en', { timeZone: 'Europe/Rome' }).f('date', late)).toContain('28');
    expect(createRuntime('en', { timeZone: 'America/Los_Angeles' }).f('date', late)).toContain(
      '27',
    );
    createRuntime('en', { timeZone: 'Europe/Rome' }).f('date', late);
    expect(dates).toHaveBeenCalledTimes(2);
  });

  it('formats a repeated value once per formatter, keeping a bounded number of them', () => {
    let calls = 0;
    function CountingNumberFormat(): { format: (value: unknown) => string } {
      return {
        format: (value) => {
          calls += 1;
          return `#${String(value)}`;
        },
      };
    }
    stubIntl({ NumberFormat: CountingNumberFormat });
    const counted = createRuntime('en');
    expect([counted.str(1), counted.str(1), counted.f('number', 1)]).toStrictEqual([
      '#1',
      '#1',
      '#1',
    ]);
    expect(calls).toBe(1);
    for (let n = 2; n <= 200; n += 1) {
      counted.str(n);
    }
    calls = 0;
    counted.str(1);
    counted.str(200);
    counted.str(200);
    expect(calls).toBe(2);
  });

  it('formats -0 apart from 0, which a Map keys alike', () => {
    expect(rt.f('number', 0)).toBe('0');
    expect(rt.f('number', -0)).toBe('-0');
    expect(rt.f('number', 0)).toBe('0');
  });

  it('joins text parts, and wraps every part once one is not text', () => {
    const node = { node: true };
    const wrapped = createRuntime('en', { wrapRich: (parts) => ({ wrapped: parts }) });
    expect(wrapped.rich(['a', 'b'])).toBe('ab');
    expect(wrapped.rich(['a ', node, ' b'])).toStrictEqual({ wrapped: ['a ', node, ' b'] });
  });

  it('keeps markup children when no callback is passed', () => {
    expect(rt.tag({}, 'b', ['bold'])).toBe('bold');
  });

  it('calls custom functions after the built-in ones, with the options and locale', () => {
    const ext = createRuntime('it', {
      functions: {
        shout: ({ value, options, locale }) =>
          `${String(value).toUpperCase()}${typeof options['mark'] === 'string' ? options['mark'] : ''}@${locale}`,
        number: () => 'never',
      },
    });
    expect(ext.f('shout', 'ciao', { mark: '!' })).toBe('CIAO!@it');
    expect(ext.f('number', 2)).toBe('2');
    expect(() => ext.f('toString', 1)).toThrow(/unknown message function/);
  });

  it('formats with the first fallback Intl has data for', () => {
    // `qaa` is a private-use code: no engine has data for it.
    const fur = createRuntime('qaa', { fallbacks: ['it', 'en'] });
    expect(fur.str(12_345.5)).toBe('12.345,5');
    expect(fur.f('currency', 2, { currency: 'EUR' })).toBe('2,00\u00A0€');
    expect(fur.sn(1_000_000)).toStrictEqual({ n: 1_000_000, cat: 'many' });
  });

  it('passes custom functions the fallback chain', () => {
    const ext = createRuntime('qaa', {
      functions: {
        ago: ({ value, locales }) =>
          new Intl.RelativeTimeFormat(locales).format(Number(value), 'day'),
      },
      fallbacks: ['it', 'en'],
    });
    expect(ext.f('ago', -1)).toBe('1 giorno fa');
  });

  it('renders default markup unless the call passes its own', () => {
    const ext = createRuntime('en', { markup: { b: (c) => `*${String(c)}*` } });
    expect(ext.tag({}, 'b', ['bold'])).toBe('*bold*');
    expect(ext.tag({ b: (c: unknown) => `_${String(c)}_` }, 'b', ['bold'])).toBe('_bold_');
    expect(ext.tag({}, 'i', ['plain'])).toBe('plain');
  });
});

describe('an engine without full Intl', () => {
  it('names the polyfill for a missing PluralRules, and formats without it', () => {
    stubIntl({ PluralRules: undefined });
    const hermes = createRuntime('en');
    expect(() => hermes.sn(1)).toThrow(
      '[parla] Intl.PluralRules is missing: import a polyfill such as @formatjs/intl-pluralrules first',
    );
    expect(hermes.sn(1, { select: 'exact' })).toStrictEqual({ n: 1, cat: '' });
    expect(hermes.str(1234.5)).toBe('1,234.5');
  });

  it('names the polyfill for missing formatters, or a missing Intl', () => {
    stubIntl({ NumberFormat: undefined, DateTimeFormat: undefined });
    const bare = createRuntime('en');
    expect(() => bare.f('number', 1)).toThrow('@formatjs/intl-numberformat');
    expect(() => bare.str(12n)).toThrow('@formatjs/intl-numberformat');
    expect(() => bare.f('date', when)).toThrow('@formatjs/intl-datetimeformat');
    vi.stubGlobal('Intl', undefined);
    expect(() => createRuntime('en').str(when)).toThrow('[parla] Intl.DateTimeFormat is missing');
  });

  it('prints a bigint as digits where NumberFormat takes numbers only', () => {
    stubIntl({ NumberFormat: HermesNumberFormat });
    const hermes = createRuntime('en');
    expect(hermes.str(12_345_678_901_234_567_890n)).toBe('12345678901234567890');
    expect(hermes.str(5)).toBe('#5');
  });
});
