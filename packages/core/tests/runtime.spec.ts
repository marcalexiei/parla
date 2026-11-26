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

  it('keeps markup children when no callback is passed', () => {
    expect(rt.tag({}, 'b', ['bold'])).toBe('bold');
  });

  it('calls custom functions after the built-in ones, with the options and locale', () => {
    const ext = createRuntime('it', undefined, {
      functions: {
        shout: (value, options, locale) =>
          `${String(value).toUpperCase()}${typeof options['mark'] === 'string' ? options['mark'] : ''}@${locale}`,
        number: () => 'never',
      },
    });
    expect(ext.f('shout', 'ciao', { mark: '!' })).toBe('CIAO!@it');
    expect(ext.f('number', 2)).toBe('2');
    expect(() => ext.f('toString', 1)).toThrow(/unknown message function/);
  });

  it('renders default markup unless the call passes its own', () => {
    const ext = createRuntime('en', undefined, { markup: { b: (c) => `*${String(c)}*` } });
    expect(ext.tag({}, 'b', ['bold'])).toBe('*bold*');
    expect(ext.tag({ b: (c: unknown) => `_${String(c)}_` }, 'b', ['bold'])).toBe('_bold_');
    expect(ext.tag({}, 'i', ['plain'])).toBe('plain');
  });
});
