import { createRuntime } from '@parlajs/core';
import { icu } from '@parlajs/format-icu';
import { mf2 } from '@parlajs/format-mf2';
import type { Model } from 'messageformat';
import { describe, expect, it } from 'vitest';

import { compileMessage, ModuleScope } from '../src/compile.ts';
import type { CustomFunctions, MessageInfo } from '../src/compile.ts';
import { signature } from '../src/types.ts';

const adapters = { icu, mf2 };

type Message = (p: object, rt: unknown) => unknown;

function compile(
  format: keyof typeof adapters,
  source: string,
  custom: CustomFunctions = {},
): { fn: Message; info: MessageInfo; sig: string } {
  const scope = new ModuleScope();
  const { body, info } = compileMessage(adapters[format].parse(source), scope, custom);
  // oxlint-disable-next-line no-new-func, typescript/no-implied-eval -- evaluates the generated chunk code
  const factory = new Function(
    `${scope.consts.join('\n')}\nreturn (p, $) => ${body};`,
  ) as () => Message;
  return { fn: factory(), info, sig: signature(info) };
}

const link = (children: unknown): object => ({ link: children });

function run(
  format: keyof typeof adapters,
  source: string,
  params: object = {},
  locale = 'en',
): unknown {
  return compile(format, source).fn(params, createRuntime(locale));
}

describe('ICU', () => {
  it('interpolates', () => {
    expect(run('icu', 'Hello {name}!', { name: 'Ada' })).toBe('Hello Ada!');
    expect(run('icu', 'Hi {n}', { n: 12_345 })).toBe('Hi 12,345');
  });

  it('selects plural forms, exact matches first', () => {
    const src = '{count, plural, =0 {No items} one {# item} other {# items}}';
    expect(run('icu', src, { count: 0 })).toBe('No items');
    expect(run('icu', src, { count: 1 })).toBe('1 item');
    expect(run('icu', src, { count: 1200 })).toBe('1,200 items');
    expect(
      run('icu', '{count, plural, one {# articolo} other {# articoli}}', { count: 1 }, 'it'),
    ).toBe('1 articolo');
    expect(
      run('icu', '{count, plural, one {# articolo} other {# articoli}}', { count: 3 }, 'it'),
    ).toBe('3 articoli');
  });

  it('supports offset plurals', () => {
    const src =
      '{n, plural, offset:1 =0 {nobody} =1 {only you} one {you and # other} other {you and # others}}';
    expect(run('icu', src, { n: 0 })).toBe('nobody');
    expect(run('icu', src, { n: 1 })).toBe('only you');
    expect(run('icu', src, { n: 2 })).toBe('you and 1 other');
    expect(run('icu', src, { n: 5 })).toBe('you and 4 others');
  });

  it('selects ordinals and strings', () => {
    const ord = '{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}';
    expect([1, 2, 3, 4, 11, 22].map((n) => run('icu', ord, { n }))).toStrictEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '22nd',
    ]);
    const sel = '{g, select, female {She} male {He} other {They}} replied';
    expect(run('icu', sel, { g: 'female' })).toBe('She replied');
    expect(run('icu', sel, { g: 'x' })).toBe('They replied');
  });

  it('formats numbers and dates with Intl', () => {
    expect(run('icu', '{a, number, ::currency/EUR}', { a: 9.5 })).toBe('€9.50');
    expect(run('icu', '{a, number, ::currency/EUR}', { a: 9.5 }, 'it')).toBe('9,50 €');
    expect(run('icu', '{p, number, percent}', { p: 0.25 })).toBe('25%');
    const d = new Date(Date.UTC(2026, 0, 15, 12));
    expect(run('icu', '{d, date, short}', { d }, 'en')).toBe(
      new Intl.DateTimeFormat('en', { dateStyle: 'short' }).format(d),
    );
  });

  it('turns tags into markup callbacks', () => {
    expect(
      run('icu', 'Accept the <link>terms of {site}</link>.', { site: 'Parla', link }),
    ).toStrictEqual(['Accept the ', { link: 'terms of Parla' }, '.']);
    // All-text results collapse to a string.
    expect(run('icu', 'Accept the <link>terms</link>.', { link: (c: string) => `[${c}]` })).toBe(
      'Accept the [terms].',
    );
  });

  it('infers parameter types', () => {
    expect(compile('icu', '{count, plural, one {# item} other {# items}}').sig).toBe(
      '(params: { count: number }): string',
    );
    expect(compile('icu', '{g, select, a {A} b {B} other {C}}').sig).toBe(
      '(params: { g: "a" | "b" | (string & {}) }): string',
    );
    expect(compile('icu', 'On {d, date, short}').sig).toBe(
      '(params: { d: Date | number }): string',
    );
    expect(compile('icu', 'Hi {name}').sig).toBe('(params: { name: string | number }): string');
    expect(compile('icu', 'Plain').sig).toBe(': Text');
    expect(compile('icu', 'See <b>this</b>').sig).toBe('(params: { b: Markup<Node> }): Node');
  });

  it('reports syntax errors', () => {
    expect(() => icu.parse('{count, plural, one {x}')).toThrow(/ICU/);
  });

  it("keeps a '<' quote as text, braces inside included", () => {
    expect(run('icu', "Pick an '<option>' for {name}", { name: 'Ada' })).toBe(
      'Pick an <option> for Ada',
    );
    expect(run('icu', "'<b>{x}</b>' and <b>{x}</b>", { x: 1, b: link })).toStrictEqual([
      '<b>{x}</b> and ',
      { link: '1' },
    ]);
    expect(compile('icu', "'<head>' only").sig).toBe(': Text');
    // `''` is an escaped apostrophe: the tag after it stays markup
    expect(run('icu', "Say ''<b>hi</b>''", { b: link })).toStrictEqual([
      "Say '",
      { link: 'hi' },
      "'",
    ]);
  });

  it('compiles custom functions declared in the config, typed by their kind', () => {
    const custom = { capitalize: 'string', ago: 'date' } as const;
    expect(compile('icu', 'By {name, capitalize}', custom).sig).toBe(
      '(params: { name: string }): string',
    );
    expect(compile('icu', '{d, ago}', custom).sig).toBe('(params: { d: Date | number }): string');
    expect(() => compile('icu', 'By {name, capitalize}')).toThrow(/unknown function :capitalize/);
  });
});

describe(signature, () => {
  it('quotes a param that is no identifier, and types a select without keys as a string', () => {
    expect(compile('mf2', '{$my-name}').sig).toBe(
      '(params: { "my-name": string | number }): string',
    );
    expect(
      compile('mf2', '.input {$x :string}\n.input {$y :string}\n.match $x $y\n* * {{a}}').sig,
    ).toBe('(params: { x: (string & {}); y: (string & {}) }): string');
  });

  it('makes default markup optional, and the params too when nothing else is needed', () => {
    const { info } = compile('icu', 'See <b>this</b>');
    expect(signature(info, new Set(['b']))).toBe('(params?: { b?: Markup<Node> }): Node');
    const { info: named } = compile('icu', 'See <b>{name}</b>');
    expect(signature(named, new Set(['b']))).toBe(
      '(params: { name: string | number; b?: Markup<Node> }): Node',
    );
  });

  it("types a select's params per branch, and once when every branch needs the same", () => {
    expect(
      compile('icu', '{context, select, part_one {Part one} other {Part {part} / {title}}}').sig,
    ).toBe(
      '(params: { context: "part_one" } | { context: string; part: string | number; title: string | number }): string',
    );
    expect(compile('icu', '{g, select, a {A {n}} other {B {n}}}').sig).toBe(
      '(params: { g: "a" | (string & {}); n: string | number }): string',
    );
    // A nested plural is a second selector: the outer key still decides alone. A plain string needs every param.
    expect(
      compile(
        'icu',
        '{g, select, male {{n, plural, one {# {x}} other {#}}} other {{n, number} {y}}}',
      ).sig,
    ).toBe(
      '(params: { g: "male"; n: number; x: string | number } | { g: string; n: number; x: string | number; y: string | number }): string',
    );
    // Not first, so `a` may fall through to `*` for some `n`.
    const later =
      '.input {$n :number}\n.input {$g :string}\n.match $n $g\none a {{{$x}}}\n* * {{{$y}}}';
    expect(compile('mf2', later).sig).toBe(
      '(params: { g: "a"; n: number; x: string | number; y: string | number } | { g: string; n: number; x: string | number; y: string | number }): string',
    );
  });
});

describe('MF2', () => {
  it('matches plurals with .input and .match', () => {
    const src =
      '.input {$count :number}\n.match $count\n0 {{No items}}\none {{{$count} item}}\n* {{{$count} items}}';
    expect(run('mf2', src, { count: 0 })).toBe('No items');
    expect(run('mf2', src, { count: 1 })).toBe('1 item');
    expect(run('mf2', src, { count: 7 })).toBe('7 items');
    expect(compile('mf2', src).sig).toBe('(params: { count: number }): string');
  });

  it('matches on several selectors', () => {
    const src =
      '.input {$n :integer}\n.input {$g :string}\n.match $n $g\none female {{She has one}}\none * {{One}}\n* female {{She has {$n}}}\n* * {{{$n}}}';
    expect(run('mf2', src, { n: 1, g: 'female' })).toBe('She has one');
    expect(run('mf2', src, { n: 1, g: 'x' })).toBe('One');
    expect(run('mf2', src, { n: 4, g: 'female' })).toBe('She has 4');
    expect(run('mf2', src, { n: 4, g: 'x' })).toBe('4');
  });

  it('formats with functions and local declarations', () => {
    expect(run('mf2', 'Total {$a :currency currency=EUR}', { a: 3 })).toBe('Total €3.00');
    expect(
      run('mf2', '.local $x = {$v :number minimumFractionDigits=2}\n{{Value {$x}}}', { v: 2 }),
    ).toBe('Value 2.00');
    expect(run('mf2', '{$n :integer}', { n: 2.7 })).toBe('3');
  });

  it('writes numeric options a module can parse', () => {
    const scope = new ModuleScope();
    compileMessage(mf2.parse('{$n :number minimumIntegerDigits=02}'), scope);
    expect(scope.consts).toStrictEqual(['const v0 = { "minimumIntegerDigits": 2 };']);
    expect(run('mf2', '{$n :number minimumIntegerDigits=02}', { n: 3 })).toBe('03');
  });

  it('renders markup', () => {
    const out = run('mf2', 'Read the {#link}guide{/link}{#br/}now', {
      link: (c: unknown) => ({ a: c }),
      br: () => ({ br: true }),
    });
    expect(out).toStrictEqual(['Read the ', { a: 'guide' }, { br: true }, 'now']);
  });

  it('takes literal operands and options, or none', () => {
    expect(run('mf2', '{$n :number useGrouping=false}', { n: 12_345 })).toBe('12345');
    expect(run('mf2', '{|hello| :string}')).toBe('hello');
    expect(compile('mf2', '{:number}').info.params.size).toBe(0);
  });

  it('rejects selectors that cannot select', () => {
    expect(() => compile('mf2', '.input {$d :datetime}\n.match $d\na {{A}}\n* {{B}}')).toThrow(
      ':datetime cannot be used as a selector',
    );
    // MF2 rejects it when parsing; a custom format may not
    const model: Model.SelectMessage = {
      type: 'select',
      declarations: [],
      selectors: [{ type: 'variable', name: 'x' }],
      variants: [{ keys: [{ type: '*' }], value: ['B'] }],
    };
    expect(() => compileMessage(model, new ModuleScope(), {})).toThrow(
      'selector $x needs an annotation such as :number or :string',
    );
  });

  it('rejects unknown functions and bad markup', () => {
    expect(() => compile('mf2', '{#b}x{/i}')).toThrow('closing markup {/i} has no matching open');
    expect(() => compile('mf2', '{$x :sparkle}')).toThrow(/unknown function :sparkle/);
    expect(() => compile('mf2', '{#b}never closed')).toThrow(/never closed/);
    expect(() => mf2.parse('{{unclosed')).toThrow('MF2 missing-syntax at 10');
    expect(() => mf2.parse('.input {$x :number}\n.match $x\none {{a}}')).toThrow(
      'MF2 missing-fallback',
    );
  });
});
