import { describe, expect, it } from 'vitest';

import { createRuntime } from '../src/runtime.ts';

const rt = createRuntime('en');
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

  it('keeps markup children when no callback is passed', () => {
    expect(rt.tag({}, 'b', ['bold'])).toBe('bold');
  });
});
