import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  FinderContext,
  LocaleFinder,
  PlaceholderSyntax,
  ScanContext,
  Scanner,
} from '@x18n/core';
import { beforeAll, describe, expect, it } from 'vitest';

import { parla } from '../src/index.ts';
import type { ParlaOptions } from '../src/index.ts';

const root = fileURLToPath(new URL('../../../.tmp/x18n-test', import.meta.url));

function only<T>(items: ReadonlyArray<T> | undefined): T {
  const [item] = items ?? [];
  if (item === undefined || items?.length !== 1) {
    throw new Error('expected exactly one');
  }
  return item;
}

const scanner = (options?: ParlaOptions): Scanner => only(parla(options).scanners);
const { find: placeholders, validate }: PlaceholderSyntax = only(parla().placeholders);
const names = (value: string): Array<string> =>
  placeholders(value)
    .map((placeholder) => placeholder.name)
    .toSorted();

const finder = (options?: ParlaOptions): LocaleFinder => only(parla(options).localeFinders);
const finderContext = (globbed: Array<string>): FinderContext =>
  ({ host: { root, glob: async () => Promise.resolve(globbed) } }) as unknown as FinderContext;

// The scanner reads only the file; x18n's context carries config it does not need.
const context = {} as ScanContext;

async function usages(
  text: string,
  options?: ParlaOptions,
): Promise<
  Array<{ raw: string; namespace: string | undefined; params: ReadonlyArray<string> | undefined }>
> {
  const result = await scanner(options).scan({ path: 'app.tsx', text } as never, context);
  return result.usages.map(({ raw, namespace, params }) => ({ raw, namespace, params }));
}

const header = `import { checkout } from './parla/namespaces/checkout.js';
import { common as shared } from '@acme/ui/namespaces/common.js';
`;

describe('scanner', () => {
  it('reads t.ns.key() calls on a t from useParla, keyed by namespace', async () => {
    await expect(
      usages(`${header}
function Cart() {
  const { t } = useParla([checkout, shared]);
  t.checkout.cart.items({ count: 3, ...rest });
  t.common.title();
  t.checkout.total({ amount });
}`),
    ).resolves.toStrictEqual([
      { raw: 'cart.items', namespace: 'checkout', params: undefined },
      { raw: 'title', namespace: 'common', params: [] },
      { raw: 'total', namespace: 'checkout', params: ['amount'] },
    ]);
  });

  it('skips calls outside the hook, on namespaces it did not load, or on another t', async () => {
    await expect(
      usages(`${header}
t.checkout.title();
function A() {
  const { t } = useParla([checkout]);
  t.common.title();
  t.checkout[key]();
  other.checkout.title();
}
function B() {
  t.checkout.title();
  const { t: alias } = useLoader([checkout]);
  alias.checkout.title();
}`),
    ).resolves.toStrictEqual([]);
  });

  it('follows an alias and a custom hook, and the innermost binding', async () => {
    await expect(
      usages(
        `${header}
function A() {
  const { t: tr } = useLoader([checkout]);
  function B() {
    const { t: tr } = useLoader([shared]);
    tr.common.title();
    tr.checkout.title();
  }
  tr.checkout.title();
}`,
        { callees: ['useLoader'] },
      ),
    ).resolves.toStrictEqual([
      { raw: 'title', namespace: 'common', params: [] },
      { raw: 'title', namespace: 'checkout', params: [] },
    ]);
  });

  it('needs every listed namespace to be an imported namespace object', async () => {
    await expect(
      usages(`${header}
function A() {
  const { t } = useParla([checkout, 'common']);
  t.checkout.title();
}`),
    ).resolves.toStrictEqual([]);
  });
});

describe('placeholders', () => {
  it('names the params and tags of ICU and MF2 messages', () => {
    expect(names('{name} has {count, plural, one {# item} other {# items}}')).toStrictEqual([
      'count',
      'name',
    ]);
    expect(names('Accept the <link>terms</link>')).toStrictEqual(['link']);
    expect(names('Hello {$name}, see {#link}terms{/link}')).toStrictEqual(['link', 'name']);
    expect(names('{broken')).toStrictEqual([]);
  });

  it('reports invalid syntax, and accepts what either format parses', () => {
    expect(validate?.('{name}')).toStrictEqual([]);
    expect(validate?.('.input {$n :number}\n.match $n\n* {{n}}')).toStrictEqual([]);
    expect(validate?.('{$name')).toHaveLength(1);
  });
});

describe('catalogs', () => {
  beforeAll(() => {
    rmSync(root, { recursive: true, force: true });
    const config = {
      locales: ['en', 'it'],
      namespaces: {
        common: { format: 'icu', path: 'locales/{locale}/common.json' },
        scopeAudit: { format: 'mf2', path: 'locales/{locale}/scope_audit.json' },
      },
    };
    const file = join(root, 'app/parla.config.ts');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `export default ${JSON.stringify(config)};\n`);
  });

  it('names each catalog file by the namespace its config gives it', async () => {
    const { find } = finder();
    const found = await find(finderContext(['app/parla.config.ts']));
    expect(found.map((c) => `${c.locale} ${c.namespace} ${c.path}`).toSorted()).toStrictEqual([
      'en common app/locales/en/common.json',
      'en scopeAudit app/locales/en/scope_audit.json',
      'it common app/locales/it/common.json',
      'it scopeAudit app/locales/it/scope_audit.json',
    ]);
  });

  it('reads the configs it is given instead of globbing, and places a new catalog', async () => {
    const { find, resolveNew } = finder({ configs: ['app/parla.config.ts'] });
    const host = finderContext([]);
    await expect(find(host)).resolves.toHaveLength(4);
    const place = (locale: string, namespace: string): string | undefined =>
      resolveNew?.({ locale, namespace, model: undefined }, host);
    expect(place('it', 'scopeAudit')).toBe('app/locales/it/scope_audit.json');
    expect(place('de', 'common')).toBeUndefined();
    expect(place('en', 'nope')).toBeUndefined();
  });
});
